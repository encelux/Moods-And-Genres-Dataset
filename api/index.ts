import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

function resolveDir(dirName: string): string {
  const candidates = [
    join(process.cwd(), dirName),
    join(process.cwd(), "api", dirName),
    join(__dirname, "..", dirName),
    join(__dirname, dirName),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return join(process.cwd(), dirName);
}

function getTrackPartitionHex(trackId: string): string {
  if (!trackId || trackId.length === 0) return "00";
  return trackId.charCodeAt(0).toString(16).toLowerCase().padStart(2, "0");
}

function resolveNormalizedFile(trackId: string): string | null {
  const hex = getTrackPartitionHex(trackId);
  const relPath = join("normalized", `${hex}.json`);
  const candidates = [
    join(process.cwd(), relPath),
    join(process.cwd(), "api", relPath),
    join(__dirname, "..", relPath),
    join(__dirname, relPath),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Loads all playlists and their contents from moods/ and genres/.
 */
function loadAllPlaylists(): LoadedCategoryEntry[] {
  if (cachedCategories) return cachedCategories;

  const results: LoadedCategoryEntry[] = [];
  const categories: Array<{ dir: string; type: "mood" | "genre" }> = [
    { dir: resolveDir("moods"), type: "mood" },
    { dir: resolveDir("genres"), type: "genre" },
  ];

  for (const { dir, type } of categories) {
    if (!existsSync(dir)) continue;

    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const file of files) {
      const slug = file.replace(/\.json$/, "");
      const fullPath = join(dir, file);

      try {
        const raw = readFileSync(fullPath, "utf-8");
        const data: CategoryDetails = JSON.parse(raw);
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
 * Looks up track details from normalized/<hex>.json.
 */
function lookupTracks(trackIds: string[]): Map<string, TrackItem> {
  const map = new Map<string, TrackItem>();
  const partitionMap = new Map<string, string[]>();

  for (const id of trackIds) {
    if (!id) continue;
    const path = resolveNormalizedFile(id);
    if (!path) continue;
    const list = partitionMap.get(path) || [];
    list.push(id);
    partitionMap.set(path, list);
  }

  for (const [fullPath, ids] of partitionMap.entries()) {
    try {
      const raw = readFileSync(fullPath, "utf-8");
      const partition: Record<string, TrackItem> = JSON.parse(raw);
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

  const allPlaylists = loadAllPlaylists();
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
 * Compatible with Bun Request/Response and Node.js (req, res).
 */
export default async function handler(
  req: any,
  res?: any,
): Promise<Response | void> {
  const method = (req.method || "GET").toUpperCase();

  const sendJson = (status: number, data: any): Response | void => {
    if (res && typeof res.status === "function") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(status).json(data);
    }
    return Response.json(data, {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  };

  if (method === "OPTIONS") {
    if (res && typeof res.status === "function") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (method !== "GET") {
    return sendJson(405, {
      error: `Method ${method} not allowed. Only GET is supported.`,
    });
  }

  try {
    const rawUrl = typeof req.url === "string" ? req.url : "/";
    const url = new URL(rawUrl, "http://localhost");
    const idsParam = url.searchParams.get("ids") || url.searchParams.get("id");

    // If accessed without query parameters, return API status & usage info
    if (!idsParam) {
      const runtime =
        typeof Bun !== "undefined"
          ? `Bun ${Bun.version}`
          : `Node.js ${process.version}`;

      return sendJson(200, {
        name: "Moods & Genres Dataset Recommendation API",
        runtime,
        status: "online",
        usage: "GET /?ids=trackId1,trackId2&limit=10",
        example: "/?ids=yNa8jP4zoJo,f9fqe_VvWtU&limit=5",
      });
    }

    const inputIds = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let limit = 10;
    const limitParam = url.searchParams.get("limit");
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 50);
      }
    }

    if (inputIds.length === 0) {
      return sendJson(400, {
        error: "No valid track IDs provided. Use ?ids=id1,id2 query parameter.",
      });
    }

    const result = recommendPlaylists(inputIds, { limit });

    if (result.recommendations.length === 0) {
      return sendJson(404, {
        error:
          "No relevant playlists found for the provided listening history.",
        totalInputTracks: result.totalInputTracks,
        recognizedInputTracks: result.recognizedInputTracks,
      });
    }

    return sendJson(200, {
      success: true,
      count: result.recommendations.length,
      totalInputTracks: result.totalInputTracks,
      recognizedInputTracks: result.recognizedInputTracks,
      playlists: result.recommendations,
    });
  } catch (err: any) {
    console.error("[API Error] recommend function failure:", err);
    return sendJson(500, {
      error: "Internal server error while generating playlist recommendations.",
      message: err.message,
    });
  }
}
