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

// In-memory cache for all category playlists
let cachedCategories: LoadedCategoryEntry[] | null = null;

// In-memory cache for loaded partition JSONs (64 partitions total)
const partitionCache = new Map<string, Record<string, TrackItem>>();

// In-memory LRU-like cache for frequent recommendation requests
const recommendationCache = new Map<string, RecommendationResult>();
const MAX_RECOMMENDATION_CACHE = 500;

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
 * Loads a track partition file with in-memory caching.
 */
function getPartition(fullPath: string): Record<string, TrackItem> | null {
  const cached = partitionCache.get(fullPath);
  if (cached) return cached;
  try {
    const raw = readFileSync(fullPath, "utf-8");
    const partition: Record<string, TrackItem> = JSON.parse(raw);
    partitionCache.set(fullPath, partition);
    return partition;
  } catch {
    return null;
  }
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
              if (
                !item.thumbnailId ||
                item.thumbnailId.startsWith("http://") ||
                item.thumbnailId.startsWith("https://") ||
                item.thumbnailId.includes("/")
              ) {
                const firstTrackId = item.contents[0];
                if (firstTrackId) {
                  const meta = lookupTracks([firstTrackId]).get(firstTrackId);
                  item.thumbnailId = meta?.thumbnailId || firstTrackId;
                }
              }
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
 * Looks up track details from normalized/<hex>.json with partition caching.
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
    const partition = getPartition(fullPath);
    if (!partition) continue;
    for (const id of ids) {
      if (partition[id]) {
        map.set(id, partition[id]);
      }
    }
  }

  return map;
}

/**
 * Resolves a clean thumbnail ID for a playlist item.
 * Falls back to the first track's thumbnailId or 11-char video ID if invalid/missing.
 */
function resolveThumbnailId(
  item: PlaylistItem,
  trackMetadata?: Map<string, TrackItem>,
): string | undefined {
  if (
    item.thumbnailId &&
    !item.thumbnailId.startsWith("http://") &&
    !item.thumbnailId.startsWith("https://") &&
    !item.thumbnailId.includes("/")
  ) {
    return item.thumbnailId;
  }
  const firstTrackId = item.contents?.[0];
  if (!firstTrackId) return undefined;
  const meta =
    trackMetadata?.get(firstTrackId) ||
    lookupTracks([firstTrackId]).get(firstTrackId);
  if (meta?.thumbnailId) return meta.thumbnailId;
  return firstTrackId;
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

  // Canonical cache key using sorted track IDs, limit, and minScore
  const cacheKey = `${uniqueInputIds.slice().sort().join(",")}:${limit}:${minScore}`;
  const cachedResult = recommendationCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
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
      const thumbnailId = resolveThumbnailId(entry.item, trackMetadata);
      scored.push({
        id: playlistId,
        name: entry.item.name,
        thumbnailId,
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

  const result: RecommendationResult = {
    totalInputTracks: uniqueInputIds.length,
    recognizedInputTracks,
    recommendations: scored.slice(0, limit),
  };

  // Manage in-memory cache capacity
  if (recommendationCache.size >= MAX_RECOMMENDATION_CACHE) {
    const oldestKey = recommendationCache.keys().next().value;
    if (oldestKey) recommendationCache.delete(oldestKey);
  }
  recommendationCache.set(cacheKey, result);

  return result;
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

  const sendJson = (
    status: number,
    data: any,
    cacheControl?: string,
  ): Response | void => {
    const defaultCache =
      status === 200
        ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400"
        : status === 404
          ? "public, max-age=300, s-maxage=600, stale-while-revalidate=300"
          : "no-cache, no-store, must-revalidate";

    const selectedCache = cacheControl ?? defaultCache;

    if (res && typeof res.status === "function") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Cache-Control", selectedCache);
      res.setHeader("Vary", "Accept-Encoding");
      return res.status(status).json(data);
    }
    return Response.json(data, {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": selectedCache,
        "Vary": "Accept-Encoding",
      },
    });
  };

  if (method === "OPTIONS") {
    if (res && typeof res.status === "function") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
      return res.status(204).end();
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
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

      return sendJson(
        200,
        {
          name: "Moods & Genres Dataset Recommendation API",
          runtime,
          status: "online",
          usage: "GET /?ids=trackId1,trackId2&limit=10",
          example: "/?ids=yNa8jP4zoJo,f9fqe_VvWtU&limit=5",
        },
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      );
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
      return sendJson(
        404,
        {
          error:
            "No relevant playlists found for the provided listening history.",
          totalInputTracks: result.totalInputTracks,
          recognizedInputTracks: result.recognizedInputTracks,
        },
        "public, max-age=300, s-maxage=600, stale-while-revalidate=300",
      );
    }

    return sendJson(
      200,
      {
        success: true,
        count: result.recommendations.length,
        totalInputTracks: result.totalInputTracks,
        recognizedInputTracks: result.recognizedInputTracks,
        playlists: result.recommendations,
      },
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    );
  } catch (err: any) {
    console.error("[API Error] recommend function failure:", err);
    return sendJson(500, {
      error: "Internal server error while generating playlist recommendations.",
      message: err.message,
    });
  }
}
