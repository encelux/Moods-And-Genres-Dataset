import { scrapeAll } from "./src/scraper";

export * from "./src/scraper";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const categoriesOnly = args.includes("--categories-only");
  const playlistsOnly = args.includes("--playlists-only");

  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitPlaylists = limitArg
    ? parseInt(limitArg.split("=")[1], 10)
    : undefined;

  await scrapeAll({ categoriesOnly, playlistsOnly, limitPlaylists });
}
