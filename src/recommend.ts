import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CategoryDetails, PlaylistItem, TrackItem } from "./types";
import { getNormalizedTrackFilePath } from "./scraper";

export interface PlaylistRecommendation {
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
  recommendations: PlaylistRecommendation[];
}

let cachedCategories:
  | {
      categoryType: "mood" | "genre";
      categorySlug: string;
      section: string;
      item: PlaylistItem;
      contentSet: Set<string>;
    }[]
  | null = null;

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
    const categoryDir = join(process.cwd(), dir);
    if (!existsSync(categoryDir)) continue;
    const files = readdirSync(categoryDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const slug = file.replace(/\.json$/, "");
      const fullPath = join(categoryDir, file);
      try {
        const data: CategoryDetails = JSON.parse(
          readFileSync(fullPath, "utf-8"),
        );
        for (const [section, items] of Object.entries(data)) {
          for (const item of items) {
            if (
              item.contents &&
              Array.isArray(item.contents) &&
              item.contents.length > 0
            ) {
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
    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) continue;
    try {
      const partition: Record<string, TrackItem> = JSON.parse(
        readFileSync(fullPath, "utf-8"),
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
      recommendations: [],
    };
  }

  const trackMetadata = lookupTracks(uniqueInputIds);
  const recognizedInputTracks = trackMetadata.size;

  // Build input artist set for artist affinity matching
  const inputArtists = new Set<string>();
  for (const track of trackMetadata.values()) {
    if (track.author && track.author.trim().length > 0) {
      inputArtists.add(track.author.toLowerCase());
    }
  }

  const allPlaylists = loadAllPlaylists();
  const scored: Array<PlaylistRecommendation> = [];
  const seenPlaylistIds = new Set<string>();

  for (const entry of allPlaylists) {
    const playlistId = entry.item.id;
    if (seenPlaylistIds.has(playlistId)) continue;

    // 1. Direct track matches
    const matchedTrackIds: string[] = [];
    for (const inputId of uniqueInputIds) {
      if (entry.contentSet.has(inputId)) {
        matchedTrackIds.push(inputId);
      }
    }

    if (matchedTrackIds.length === 0) {
      continue;
    }

    // Direct track matches award 10 points each
    let score = matchedTrackIds.length * 10;

    // 2. Artist overlap
    const matchedArtists: string[] = [];
    for (const trackId of matchedTrackIds) {
      const meta = trackMetadata.get(trackId);
      if (meta?.author && !matchedArtists.includes(meta.author)) {
        matchedArtists.push(meta.author);
      }
    }

    if (score >= minScore) {
      seenPlaylistIds.add(playlistId);
      scored.push({
        id: playlistId,
        name: entry.item.name,
        thumbnailId: entry.item.thumbnailId,
        categoryType: entry.categoryType,
        categorySlug: entry.categorySlug,
        section: entry.section,
        score,
        matchedTrackIds,
        matchedArtists,
        url: `https://music.youtube.com/playlist?list=${playlistId}`,
      });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return {
    totalInputTracks: uniqueInputIds.length,
    recognizedInputTracks,
    recommendations: scored.slice(0, limit),
  };
}
