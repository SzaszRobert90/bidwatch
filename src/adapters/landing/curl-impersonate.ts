import { spawn } from "node:child_process";
import { fetch as uFetch } from "undici";
import type { LandingTransport } from "./inspector.js";

export interface CurlImpersonateOptions {
  /** Path or name of the curl-impersonate binary, e.g. "curl_chrome116" or "curl-impersonate-chrome". */
  binary: string;
  timeoutMs?: number;
  /** Comma-separated proxy urls, round-robined. Empty = direct. */
  proxies?: string[];
}

interface RawResponse {
  status: number;
  location: string | null;
  body: string;
}

/**
 * Landing transport that speaks through a curl-impersonate binary (the same
 * impersonation tech as python's curl_cffi) so redirect chains keep a browser
 * TLS fingerprint. Falls back to undici when the binary is missing.
 */
export function createCurlImpersonateTransport(options: CurlImpersonateOptions): LandingTransport {
  const proxies = (options.proxies ?? []).filter((p) => p.trim().length > 0);
  let cursor = 0;
  return async (url, init) => {
    const proxy = proxies.length > 0 ? proxies[cursor++ % proxies.length] : undefined;
    const raw = await runCurl(options.binary, url, init.signal, options.timeoutMs ?? 15_000, proxy);
    if (raw === null) {
      return uFetch(url, { redirect: init.redirect, signal: init.signal, dispatcher: init.dispatcher });
    }
    return {
      status: raw.status,
      url,
      headers: { get: (name: string) => (name.toLowerCase() === "location" ? raw.location : null) },
      text: async () => raw.body,
    };
  };
}

async function runCurl(
  binary: string,
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
  proxy: string | undefined,
): Promise<RawResponse | null> {
  const metaTag = "\n---BIDWATCH-CURL-META---";
  const args = [
    "-sS",
    "--max-redirs",
    "0",
    ...(proxy !== undefined ? ["-x", proxy] : []),
    "-w",
    `${metaTag}%{http_code}\t%{redirect_url}`,
    url,
  ];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, args, { signal, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    const killTimer = setTimeout(() => child.kill(), timeoutMs);
    let stdout = "";
    let settled = false;
    const finish = (result: RawResponse | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => finish(null)); // binary not installed -> fall back
    child.on("close", (code) => {
      const idx = stdout.lastIndexOf(metaTag);
      if (code !== 0 && idx < 0) {
        finish(null);
        return;
      }
      const meta = stdout.slice(idx + metaTag.length);
      const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
      const [statusStr = "", redirectUrl = ""] = meta.split("\t");
      const status = Number(statusStr);
      finish({
        status: Number.isFinite(status) ? status : 0,
        location: redirectUrl.trim().length > 0 ? redirectUrl.trim() : null,
        body,
      });
    });
  });
}
