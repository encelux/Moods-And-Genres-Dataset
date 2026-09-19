import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CategoryDetails, PlaylistItem, TrackItem } from "./types";
import { getNormalizedTrackFilePath } from "./scraper";

export interface RecommendationMatch {
  id: string;
  name: string;
  thumbnailId?: string;
  categoryType: "mood" | "genre";
  categorySlug: string;
  section: string;
  score: number;
  matchedTrackIds: string[];
  matchedArtists: string[];
  url: string;
}

export interface RecommendationResult {
  totalInputTracks: number;
  recognizedInputTracks: number;
  totalPlaylistsEvaluated: number;
  recommendations: RecommendationMatch[];
}

// In-memory cache across invocations in serverless/warm runtimes
let cachedCategories: {
  categoryType: "mood" | "genre";
  categorySlug: string;
  section: string;
  item: PlaylistItem;
  contentSet: Set<string>;
}[] | null = null;

/**
 * Loads all playlists and their contents from moods/ and genres/.
 */
export function loadAllPlaylists(): {
  categoryType: "mood" | "genre";
  categorySlug: string;
  section: string;
  item: PlaylistItem;
  contentSet: Set<string>;
}[] {
  if (cachedCategories) return cachedCategories;

  const results: {
    categoryType: "mood" | "genre";
    categorySlug: string;
    section: string;
    item: PlaylistItem;
    contentSet: Set<string>;
  }[] = [];

  const categories: Array<{ dir: string; type: "mood" | "genre" }> = [
    { dir: "moods", type: "mood" },
    { dir: "genres", type: "genre" },
  ];

  for (const { dir, type } of categories) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const slug = file.replace(/\.json$/, "");
      const fullPath = join(dir, file);
      try {
        const data: CategoryDetails = JSON.parse(readFileSync(fullPath, "utf-8"));
        for (const [section, items] of Object.entries(data)) {
          for (const item of items) {
            if (item.contents && Array.isArray(item.contents) && item.contents.length > 0) {
              results.push({
                categoryType: type,
                categorySlug: slug,
                section,
                item,
                contentSet: new Set(item.contents),
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[Recommend] Failed to read ${fullPath}:`, err);
      }
    }
  }

  cachedCategories = results;
  return results;
}

/**
 * Looks up track details from normalized/<hex>.json for a list of track IDs.
 */
export function lookupTracks(trackIds: string[]): Map<string, TrackItem> {
  const map = new Map<string, TrackItem>();
  // Group IDs by their partition file to minimize disk reads
  const partitionMap = new Map<string, string[]>();

  for (const id of trackIds) {
    if (!id) continue;
    const path = getNormalizedTrackFilePath(id);
    const list = partitionMap.get(path) || [];
    list.push(id);
    partitionMap.set(path, list);
  }

  for (const [filePath, ids] of partitionMap.entries()) {
    if (!existsSync(filePath)) continue;
    try {
      const partition: Record<string, TrackItem> = JSON.parse(
        readFileSync(filePath, "utf-8"),
      );
      for (const id of ids) {
        if (partition[id]) {
          map.set(id, partition[id]);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return map;
}

/**
 * Recommends playlists based on user input track IDs.
 */
export function recommendPlaylists(
  inputTrackIds: string[],
  options: { limit?: number; minScore?: number } = {},
): RecommendationResult {
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 1;

  const uniqueInputIds = Array.from(new Set(inputTrackIds.filter(Boolean)));
  if (uniqueInputIds.length === 0) {
    return {
      totalInputTracks: 0,
      recognizedInputTracks: 0,
      totalPlaylistsEvaluated: 0,
      recommendations: [],
    };
  }

  // 1. Resolve tracks and user artist preferences
  const trackMap = lookupTracks(uniqueInputIds);
  const userAuthors = new Set<string>();
  const userAuthorIds = new Set<string>();

  for (const track of trackMap.values()) {
    if (track.author) userAuthors.add(track.author.toLowerCase());
    if (track.authorId) userAuthorIds.add(track.authorId);
  }

  // 2. Evaluate all playlists
  const allPlaylists = loadAllPlaylists();
  const playlistScores = new Map<
    string,
    {
      entry: (typeof allPlaylists)[0];
      score: number;
      matchedTrackIds: Set<string>;
      matchedArtists: Set<string>;
    }
  >();

  for (const entry of allPlaylists) {
    let score = 0;
    const matchedTrackIds = new Set<string>();
    const matchedArtists = new Set<string>();

    // Exact track overlap (High weight: +10 per track)
    for (const inputId of uniqueInputIds) {
      if (entry.contentSet.has(inputId)) {
        score += 10;
        matchedTrackIds.add(inputId);
        const track = trackMap.get(inputId);
        if (track?.author) {
          matchedArtists.add(track.author);
        }
      }
    }

    if (score >= minScore) {
      const existing = playlistScores.get(entry.item.id);
      if (!existing || existing.score < score) {
        playlistScores.set(entry.item.id, {
          entry,
          score,
          matchedTrackIds,
          matchedArtists,
        });
      }
    }
  }

  // 3. Sort by score descending
  const sorted = Array.from(playlistScores.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.matchedTrackIds.size - a.matchedTrackIds.size;
    })
    .slice(0, limit);

  const recommendations: RecommendationMatch[] = sorted.map((s) => ({
    id: s.entry.item.id,
    name: s.entry.item.name,
    thumbnailId: s.entry.item.thumbnailId,
    categoryType: s.entry.categoryType,
    categorySlug: s.entry.categorySlug,
    section: s.entry.section,
    score: s.score,
    matchedTrackIds: Array.from(s.matchedTrackIds),
    matchedArtists: Array.from(s.matchedArtists),
    url: `https://music.youtube.com/playlist?list=${s.entry.item.id}`,
  }));

  return {
    totalInputTracks: uniqueInputIds.length,
    recognizedInputTracks: trackMap.size,
    totalPlaylistsEvaluated: allPlaylists.length,
    recommendations,
  };
}

// Local testing runner
if (import.meta.main) {
  console.log("=== Playlist Recommendation Engine Local Test ===\n");

  // Sample track IDs from the dataset:
  // "yNa8jP4zoJo" (Madwoman - Laufey)
  // "ekAsG_p2jM4" (Look To Him - Laufey)
  // "f9fqe_VvWtU" (Sincerely - Haruomi Hosono)
  const sampleHistory = [
    "yNa8jP4zoJo",
    "ekAsG_p2jM4",
    "f9fqe_VvWtU",
    "PmSwUCdQQC4",
  ];

  console.log(`Input Listening History (${sampleHistory.length} tracks):`, sampleHistory);

  const start = performance.now();
  const result = recommendPlaylists(sampleHistory, { limit: 5 });
  const elapsed = (performance.now() - start).toFixed(2);

  console.log(`\nEvaluated in ${elapsed}ms:`);
  console.log(`- Recognized input tracks: ${result.recognizedInputTracks}/${result.totalInputTracks}`);
  console.log(`- Total playlists evaluated: ${result.totalPlaylistsEvaluated}`);
  console.log(`- Recommendations found: ${result.recommendations.length}\n`);

  if (result.recommendations.length === 0) {
    console.log("No matching recommendations found.");
  } else {
    for (let i = 0; i < result.recommendations.length; i++) {
      const rec = result.recommendations[i]!;
      console.log(`[#${i + 1}] Score: ${rec.score} | Playlist: "${rec.name}"`);
      console.log(`     Category: ${rec.categoryType} -> ${rec.categorySlug} (${rec.section})`);
      console.log(`     Matched Tracks: ${rec.matchedTrackIds.join(", ")}`);
      if (rec.matchedArtists.length > 0) {
        console.log(`     Artists: ${rec.matchedArtists.join(", ")}`);
      }
      console.log(`     URL: ${rec.url}`);
      console.log();
    }
  }
}
