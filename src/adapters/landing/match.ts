import type { MatchSource, SignatureDb, SignatureMatch } from "../../domain/types.js";
import { domainOf } from "../../domain/domain.js";

export interface MatchInput {
  /** URLs seen along the redirect chain, in order (final URL included). */
  urls: string[];
  /** Page body of the final landing, when readable. */
  body: string | null;
}

/** Pure signature matcher: no IO, fully table-driven from config/signatures.yaml. */
export function matchSignatures(db: SignatureDb, input: MatchInput): SignatureMatch[] {
  const matches: SignatureMatch[] = [];
  const seen = new Set<string>();
  const push = (m: SignatureMatch) => {
    const key = `${m.network}|${m.kind}|${m.evidence}`;
    if (!seen.has(key)) {
      seen.add(key);
      matches.push(m);
    }
  };

  const finalUrl = input.urls[input.urls.length - 1] ?? "";
  for (const net of db.networks) {
    for (const url of input.urls) {
      const source: MatchSource = url === finalUrl ? "final_url" : "chain";
      const host = domainOf(url);

      for (const d of net.domains) {
        const dl = d.toLowerCase();
        if (host === dl || host.endsWith(`.${dl}`)) {
          push({ network: net.network, kind: "domain", source, evidence: `via tracker domain ${host}` });
        }
      }

      let params: URLSearchParams;
      try {
        params = new URL(url).searchParams;
      } catch {
        continue;
      }
      for (const p of net.params) {
        const value = params.get(p.name) ?? params.get(p.name.toLowerCase());
        if (value === null) continue;
        if (p.valuePattern && !new RegExp(p.valuePattern).test(value)) continue;
        push({
          network: net.network,
          kind: "param",
          source,
          evidence: `query param ${p.name}=${value.slice(0, 64)}`,
        });
      }
      for (const [name, value] of params) {
        for (const pattern of net.valuePatterns) {
          if (new RegExp(pattern, "i").test(value)) {
            push({
              network: net.network,
              kind: "value",
              source,
              evidence: `param ${name}=${value.slice(0, 48)} matches /${pattern}/i`,
            });
          }
        }
      }
    }

    if (input.body !== null) {
      for (const pattern of net.disclosure) {
        const re = new RegExp(pattern, "i");
        const hit = re.exec(input.body);
        if (hit !== null) {
          push({
            network: net.network,
            kind: "disclosure",
            source: "body",
            evidence: `body matches /${hit[0].slice(0, 48)}/i`,
          });
        }
      }
    }
  }

  return matches;
}