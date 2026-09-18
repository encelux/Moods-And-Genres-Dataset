import fs from "node:fs";
import type { FullDataset, TrackItem, NormalizedTracks } from "./types";

/**
 * Normalizes all tracks across the dataset into normalized_tracks.json
 * and enriches playlist items with a 'contents' array containing track IDs.
 * Does not keep thumbnailId for non-song (isSong: false) items.
 */
export async function normalizeAndEnrichDataset(): Promise<{
  totalTracks: number;
  totalPlaylists: number;
}> {
  const fullDatasetFile = Bun.file("full_dataset.json");
  if (!(await fullDatasetFile.exists())) {
    return { totalTracks: 0, totalPlaylists: 0 };
  }

  const fullDataset: FullDataset = await fullDatasetFile.json();
  const normalizedTracks: NormalizedTracks = {};
  const playlistContentsMap = new Map<string, string[]>();

  for (const group of ["moods", "genres"] as const) {
    const categories = fullDataset[group] || {};
    for (const catKey of Object.keys(categories)) {
      const sections = categories[catKey] || {};
      for (const secKey of Object.keys(sections)) {
        for (const item of sections[secKey] || []) {
          if (Array.isArray(item.tracks) && item.tracks.length > 0) {
            const contents: string[] = [];
            for (const t of item.tracks) {
              contents.push(t.id);
              if (!normalizedTracks[t.id]) {
                if (t.isSong) {
                  normalizedTracks[t.id] = { ...t };
                } else {
                  const { thumbnailId, ...rest } = t;
                  normalizedTracks[t.id] = rest as TrackItem;
                }
              }
            }
            if (!playlistContentsMap.has(item.id)) {
              playlistContentsMap.set(item.id, contents);
            }
            item.contents = contents;
          }
        }
      }
    }
  }

  // Update moods files
  if (fs.existsSync("moods")) {
    for (const file of fs.readdirSync("moods")) {
      if (!file.endsWith(".json")) continue;
      const p = `moods/${file}`;
      const json = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const sec in json) {
        for (const item of json[sec]) {
          if (playlistContentsMap.has(item.id)) {
            item.contents = playlistContentsMap.get(item.id);
          }
        }
      }
      await Bun.write(p, JSON.stringify(json, null, 2) + "\n");
    }
  }

  // Update genres files
  if (fs.existsSync("genres")) {
    for (const file of fs.readdirSync("genres")) {
      if (!file.endsWith(".json")) continue;
      const p = `genres/${file}`;
      const json = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const sec in json) {
        for (const item of json[sec]) {
          if (playlistContentsMap.has(item.id)) {
            item.contents = playlistContentsMap.get(item.id);
          }
        }
      }
      await Bun.write(p, JSON.stringify(json, null, 2) + "\n");
    }
  }

  await Bun.write(
    "normalized_tracks.json",
    JSON.stringify(normalizedTracks, null, 2) + "\n",
  );
  await Bun.write(
    "full_dataset.json",
    JSON.stringify(fullDataset, null, 2) + "\n",
  );

  console.log(
    `Saved normalized_tracks.json (${Object.keys(normalizedTracks).length} tracks)`,
  );
  console.log(
    `Updated moods and genres with 'contents' arrays (${playlistContentsMap.size} playlists)`,
  );

  return {
    totalTracks: Object.keys(normalizedTracks).length,
    totalPlaylists: playlistContentsMap.size,
  };
}
