import { scrapeAll } from "./src/scraper";

export * from "./src/scraper";

if (import.meta.main) {
  await scrapeAll();
}
