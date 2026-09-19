import { join } from "path";
import type { CategoryDetails, PlaylistItem, TrackItem } from "../src/types";

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

interface LoadedCategoryEntry {
  categoryType: "mood" | "genre";
  categorySlug: string;
  section: string;
  item: PlaylistItem;
  contentSet: Set<string>;
}

let cachedCategories: LoadedCategoryEntry[] | null = null;

function getTrackPartitionHex(trackId: string): string {
  if (!trackId || trackId.length === 0) return "00";
  return trackId.charCodeAt(0).toString(16).toLowerCase().padStart(2, "0");
}

function getNormalizedTrackFilePath(trackId: string): string {
  return `normalized/${getTrackPartitionHex(trackId)}.json`;
}

/**
 * Loads all playlists and their contents from moods/ and genres/ using Bun APIs.
 */
async function loadAllPlaylists(): Promise<LoadedCategoryEntry[]> {
  if (cachedCategories) return cachedCategories;

  const results: LoadedCategoryEntry[] = [];
  const categories: Array<{ dir: string; type: "mood" | "genre" }> = [
    { dir: "moods", type: "mood" },
    { dir: "genres", type: "genre" },
  ];

  const jsonGlob = new Bun.Glob("*.json");

  for (const { dir, type } of categories) {
    const categoryDir = join(process.cwd(), dir);
    let files: string[] = [];

    try {
      files = Array.from(jsonGlob.scanSync(categoryDir));
    } catch {
      continue;
    }

    for (const file of files) {
      const slug = file.replace(/\.json$/, "");
      const fullPath = join(categoryDir, file);
      const bunFile = Bun.file(fullPath);
      if (!(await bunFile.exists())) continue;

      try {
        const data: CategoryDetails = await bunFile.json();
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
 * Looks up track details from normalized/<hex>.json using Bun.file.
 */
async function lookupTracks(
  trackIds: string[],
): Promise<Map<string, TrackItem>> {
  const map = new Map<string, TrackItem>();
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
    const bunFile = Bun.file(fullPath);
    if (!(await bunFile.exists())) continue;

    try {
      const partition: Record<string, TrackItem> = await bunFile.json();
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
async function recommendPlaylists(
  inputTrackIds: string[],
  options: { limit?: number; minScore?: number } = {},
): Promise<RecommendationResult> {
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

  const trackMetadata = await lookupTracks(uniqueInputIds);
  const recognizedInputTracks = trackMetadata.size;

  const allPlaylists = await loadAllPlaylists();
  const scored: Array<PlaylistRecommendation> = [];
  const seenPlaylistIds = new Set<string>();

  for (const entry of allPlaylists) {
    const playlistId = entry.item.id;
    if (seenPlaylistIds.has(playlistId)) continue;

    const matchedTrackIds: string[] = [];
    for (const inputId of uniqueInputIds) {
      if (entry.contentSet.has(inputId)) {
        matchedTrackIds.push(inputId);
      }
    }

    if (matchedTrackIds.length === 0) continue;

    const score = matchedTrackIds.length * 10;

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

  scored.sort((a, b) => b.score - a.score);

  return {
    totalInputTracks: uniqueInputIds.length,
    recognizedInputTracks,
    recommendations: scored.slice(0, limit),
  };
}

/**
 * Single Vercel Serverless Function entrypoint.
 * Handles direct requests at / or /api/index with GET.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: `Method ${req.method} not allowed. Only GET is supported.`,
      }),
      {
        status: 405,
        headers: { Allow: "GET, OPTIONS" },
      },
    );
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const idsParam = url.searchParams.get("ids") || url.searchParams.get("id");

    // If root path is accessed without query parameters, return API status & usage info
    if (
      !idsParam &&
      (url.pathname === "/" ||
        url.pathname === "/api" ||
        url.pathname === "/api/index")
    ) {
      return new Response(
        JSON.stringify({
          name: "Moods & Genres Dataset Recommendation API",
          runtime: `Bun ${process.versions.bun || "latest"}`,
          status: "online",
          usage: "GET /?ids=trackId1,trackId2&limit=10",
          example: "/?ids=yNa8jP4zoJo,f9fqe_VvWtU&limit=5",
        }),
        { status: 200 },
      );
    }

    const inputIds = idsParam
      ? idsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    let limit = 10;
    const limitParam = url.searchParams.get("limit");
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 50);
      }
    }

    if (inputIds.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "No valid track IDs provided. Use ?ids=id1,id2 query parameter.",
        }),
        { status: 400 },
      );
    }

    const result = await recommendPlaylists(inputIds, { limit });

    if (result.recommendations.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "No relevant playlists found for the provided listening history.",
          totalInputTracks: result.totalInputTracks,
          recognizedInputTracks: result.recognizedInputTracks,
        }),
        { status: 404 },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: result.recommendations.length,
        totalInputTracks: result.totalInputTracks,
        recognizedInputTracks: result.recognizedInputTracks,
        playlists: result.recommendations,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[API Error] recommend function failure:", err);
    return new Response(
      JSON.stringify({
        error:
          "Internal server error while generating playlist recommendations.",
        message: err.message,
      }),
      { status: 500 },
    );
  }
}
