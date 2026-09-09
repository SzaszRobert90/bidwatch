import { loadBrands, loadEnv } from "../../config.js";

/**
 * v1.5 stub: will scrape public ShareASale/Awin/CJ/Impact advertiser catalogs
 * and propose candidate brands for config/brands.yaml (review-then-add).
 * The monitoring pipeline does not depend on it.
 */
export async function main(): Promise<void> {
  const env = loadEnv();
  const brands = loadBrands(env);
  console.log(`prospect-builder v1.5 — catalog scraper not implemented yet.`);
  console.log(`Current registry: ${brands.length} brands in config/brands.yaml.`);
  console.log(`Plan: scrape public affiliate-network advertiser catalogs, dedupe against`);
  console.log(`the registry, and propose additions for review-then-add.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
