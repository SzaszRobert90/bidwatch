/** Core domain types. Engines and geos are open strings so adapters can grow without schema churn. */

export type Engine = "bing";

export interface SerpQuery {
  /** Unique run id, also used as the storage partition key. */
  runId: string;
  brand: string;
  brandDomain: string;
  keyword: string;
  geo: string;
  engine: Engine;
  enqueuedAt: string;
}

export interface AdObservation {
  adIndex: number;
  title: string;
  description: string | null;
  /** Display URL as shown in the ad's cite line, e.g. "nordvpn.com/offer". */
  displayUrl: string;
  /** Host extracted from the display URL. */
  displayDomain: string;
  /** Actual href — usually an engine click-tracker URL. */
  clickUrl: string;
}

export interface SerpFetch {
  query: SerpQuery;
  fetchedAt: string;
  httpStatus: number;
  finalUrl: string;
  html: string;
  ads: AdObservation[];
  /** Adapter notes, e.g. "captcha suspected". */
  notice: string | null;
}

export type LandingClass =
  | "affiliate_violation"
  | "competitor_conquest"
  | "self_bid"
  | "unknown";

/** Shape of config/signatures.yaml — data, not code. */
export interface SignatureDb {
  networks: Array<{
    network: string;
    params: Array<{ name: string; valuePattern?: string }>;
    domains: string[];
    disclosure: string[];
  }>;
}

export interface Hop {
  url: string;
  status: number;
}

export type SignatureKind = "param" | "domain" | "disclosure";
export type MatchSource = "chain" | "final_url" | "body";

export interface SignatureMatch {
  network: string;
  kind: SignatureKind;
  source: MatchSource;
  /** Human-readable evidence, e.g. `query param sscid=abc123`. */
  evidence: string;
}

export interface LandingInspection {
  requestUrl: string;
  requestDomain: string;
  hops: Hop[];
  finalUrl: string;
  finalDomain: string;
  httpStatus: number;
  fetchedAt: string;
  matches: SignatureMatch[];
  /** Set when the landing could not be inspected (blocked, timeout, ...). */
  error: string | null;
}

/** One row of the curated landings layer: inspection joined with the ad it came from. */
export interface LandingRow {
  runId: string;
  brand: string;
  keyword: string;
  geo: string;
  engine: Engine;
  fetchedAt: string;
  adIndex: number;
  title: string;
  displayDomain: string;
  clickUrl: string;
  inspection: LandingInspection;
  classification: LandingClass;
  networks: string[];
}

/** One row of the curated observations layer: every ad seen on a SERP, classified cheaply. */
export interface ObservationRow {
  runId: string;
  brand: string;
  brandDomain: string;
  keyword: string;
  geo: string;
  engine: Engine;
  fetchedAt: string;
  adIndex: number;
  title: string;
  displayUrl: string;
  displayDomain: string;
  clickUrl: string;
  classification: LandingClass;
  inspected: boolean;
}
