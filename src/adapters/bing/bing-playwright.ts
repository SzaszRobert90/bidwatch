import { chromium, type BrowserContext, type Page } from "playwright";
import { parseBingAds, detectNotice } from "./parse.js";
import type { SerpProvider } from "../../domain/ports.js";
import type { SerpFetch, SerpQuery } from "../../domain/types.js";

export interface BingPlaywrightOptions {
  /** Persistent profile dir — cookies/history accumulate; ad serving needs a warm session. */
  profileDir: string;
  /** "chrome" | "msedge" use the locally installed browser (required for ad visibility); empty = bundled chromium. */
  channel?: string;
  /** Headless sessions get no ads (verified by probes); run headful under xvfb on servers. */
  headless?: boolean;
  navigationTimeoutMs?: number;
  /** How long to wait for ad elements to be injected before treating the page as ad-less. */
  adsWaitMs?: number;
}

/**
 * Bing only serves ads to trusted sessions: a real (non-headless) browser
 * binary with a warm profile, and a vanilla search URL — extra params such as
 * mkt/count read as automation and suppress ads entirely. All of this was
 * verified empirically (see scripts/probe-*.ts).
 */
export class BingPlaywrightProvider implements SerpProvider {
  private context: BrowserContext | null = null;
  private readonly profileDir: string;
  private readonly channel?: string;
  private readonly headless: boolean;
  private readonly navigationTimeoutMs: number;
  private readonly adsWaitMs: number;

  constructor(options: BingPlaywrightOptions) {
    this.profileDir = options.profileDir;
    this.channel = options.channel === "chromium" || options.channel === "" ? undefined : options.channel;
    this.headless = options.headless ?? false;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
    this.adsWaitMs = options.adsWaitMs ?? 8_000;
  }

  async fetchSerp(query: SerpQuery): Promise<SerpFetch> {
    const context = await this.ensureContext();
    const page = await context.newPage();
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query.keyword)}`;
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.navigationTimeoutMs,
      });
      await this.acceptConsentIfPresent(page);
      // A SERP with zero ads is a valid observation; this wait only gives
      // client-side ad injection a chance to land.
      await page.waitForSelector("li.b_ad", { timeout: this.adsWaitMs }).catch(() => {});
      const html = await page.content();
      const ads = parseBingAds(html);
      return {
        query,
        fetchedAt: new Date().toISOString(),
        httpStatus: response?.status() ?? 0,
        finalUrl: page.url(),
        html,
        ads,
        notice: detectNotice(html),
      };
    } finally {
      await page.close();
    }
  }

  async dispose(): Promise<void> {
    if (this.context !== null) {
      await this.context.close();
      this.context = null;
    }
  }

  /** EU vantage points get a consent banner; without accepting it Bing serves a reduced page. */
  private async acceptConsentIfPresent(page: Page): Promise<void> {
    const btn = page
      .locator("#bnp_btn_accept, #bnp_bt_accept, button[data-testid='accept-all']")
      .first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1_000);
    }
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context !== null) return this.context;
    const args = ["--window-size=1280,800", "--disable-blink-features=AutomationControlled"];
    if (process.env.BIDWATCH_NO_SANDBOX === "1") args.push("--no-sandbox");
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      channel: this.channel,
      headless: this.headless,
      locale: "en-US",
      viewport: null,
      args,
    });
    return this.context;
  }
}
