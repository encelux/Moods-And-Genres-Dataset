import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import type {
  DatasetIndex,
  CategoryDetails,
  PlaylistItem,
  CategoryItem,
  TrackItem,
  NormalizedTracks,
} from "./types";

export * from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Converts a category title to a clean slug for JSON keys and filenames.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[\/\\?%*:|"<>]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Extracts a clean thumbnail ID or identifier from YouTube thumbnail URLs.
 */
export function extractThumbnailId(url: string | undefined): string {
  if (!url) return "";
  const googleMatch = url.match(
    /(?:googleusercontent\.com|ggpht\.com)\/([^=?/]+)/,
  );
  if (googleMatch?.[1]) return googleMatch[1];
  const ytMatch = url.match(/i\.ytimg\.com\/vi\/([^/?]+)/);
  if (ytMatch?.[1]) return ytMatch[1];
  return "";
}

/**
 * Converts a duration string (e.g. "4:45" or "1:02:15") into total seconds.
 */
export function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr
    .trim()
    .split(":")
    .map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  if (
    parts.length === 3 &&
    parts[0] !== undefined &&
    parts[1] !== undefined &&
    parts[2] !== undefined
  ) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1 && parts[0] !== undefined) {
    return parts[0];
  }
  return 0;
}

/**
 * Computes the 2-character lowercase hex code corresponding to the first
 * character of an ID (e.g. 'a' -> '61', 'A' -> '41', '-' -> '2d', '_' -> '5f').
 */
export function getTrackPartitionHex(trackId: string): string {
  if (!trackId || trackId.length === 0) return "00";
  return trackId.charCodeAt(0).toString(16).toLowerCase().padStart(2, "0");
}

/**
 * Returns the relative file path for a track's normalized partition file.
 */
export function getNormalizedTrackFilePath(trackId: string): string {
  return `normalized/${getTrackPartitionHex(trackId)}.json`;
}

/**
 * Fetches the YouTube Music Moods & Genres browse page HTML.
 */
export async function fetchMoodsAndGenresHtml(): Promise<string> {
  const url = "https://music.youtube.com/moods_and_genres";
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  return await response.text();
}

/**
 * Extracts Innertube API credentials and client version embedded in page scripts.
 */
export function extractInnertubeConfig(html: string): {
  apiKey: string;
  clientVersion: string;
} {
  const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const versionMatch = html.match(/"clientVersion":"([^"]+)"/);

  return {
    apiKey: keyMatch?.[1] || "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
    clientVersion: versionMatch?.[1] || "1.20260915.14.00",
  };
}

/**
 * Extracts the browse JSON payload from embedded scripts.
 */
export function extractBrowseData(html: string): any {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    if (!code) continue;
    if (code.includes("initialData.push") && code.includes("browse")) {
      try {
        const modified =
          code.replace(/const initialData = \[\];/, "initialData = [];") +
          "\nreturn initialData;";
        const fn = new Function("window", modified);
        const result = fn({});
        for (const item of result) {
          if (item.path?.includes("browse")) {
            return typeof item.data === "string"
              ? JSON.parse(item.data)
              : item.data;
          }
        }
      } catch {
        // Fall through to regex
      }

      const hexMatch = code.match(
        /path:\s*['"]\\\/browse['"][\s\S]*?data:\s*['"]([\s\S]*?)['"]\s*\}\s*\)/,
      );
      if (hexMatch?.[1]) {
        const decoded = hexMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        );
        return JSON.parse(decoded);
      }
    }
  }

  const ytInitialMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});/s);
  if (ytInitialMatch?.[1]) {
    return JSON.parse(ytInitialMatch[1]);
  }

  throw new Error(
    "Unable to locate browse initial data in YouTube Music page response",
  );
}

/**
 * Extracts category items (name, slug, and params ID) for moods and genres.
 */
export function extractCategories(browseData: any): {
  moods: CategoryItem[];
  genres: CategoryItem[];
} {
  const sections =
    browseData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents;

  if (!Array.isArray(sections)) {
    throw new Error("No sections found in browse contents");
  }

  const moods: CategoryItem[] = [];
  const genres: CategoryItem[] = [];

  for (const section of sections) {
    const grid = section.gridRenderer;
    const title =
      grid?.header?.gridHeaderRenderer?.title?.runs?.[0]?.text || "";
    const items = grid?.items;
    if (!Array.isArray(items)) continue;

    const isMood = /mood/i.test(title);
    const isGenre = /genre/i.test(title);

    for (const item of items) {
      const button = item.musicNavigationButtonRenderer;
      const name = button?.buttonText?.runs?.[0]?.text;
      const paramsId = button?.clickCommand?.browseEndpoint?.params;

      if (name && paramsId) {
        const categoryItem: CategoryItem = {
          name: name.trim(),
          slug: slugify(name),
          id: paramsId,
        };

        if (isMood) {
          moods.push(categoryItem);
        } else if (isGenre) {
          genres.push(categoryItem);
        }
      }
    }
  }

  return { moods, genres };
}

/**
 * Fetches the category payload for a specific mood or genre using the Innertube Browse API.
 */
export async function fetchCategoryData(
  apiKey: string,
  clientVersion: string,
  params: string,
): Promise<any> {
  const browseUrl = `https://music.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`;

  const response = await fetch(browseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/moods_and_genres",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB_REMIX",
          clientVersion,
          hl: "en",
          gl: "US",
        },
      },
      browseId: "FEmusic_moods_and_genres_category",
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch category data: HTTP ${response.status} ${response.statusText}`,
    );
  }

  return await response.json();
}

/**
 * Extracts an item details object { id, name, thumbnailId } from a category item.
 */
export function extractPlaylistItem(item: any): PlaylistItem | null {
  if (item.musicTwoRowItemRenderer) {
    const r = item.musicTwoRowItemRenderer;
    const name = r.title?.runs?.[0]?.text?.trim();
    const browseId =
      r.navigationEndpoint?.browseEndpoint?.browseId ||
      r.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    const playlistId =
      r.navigationEndpoint?.watchPlaylistEndpoint?.playlistId ||
      r.menu?.menuRenderer?.items?.find(
        (i: any) =>
          i?.menuNavigationItemRenderer?.navigationEndpoint
            ?.watchPlaylistEndpoint,
      )?.menuNavigationItemRenderer?.navigationEndpoint?.watchPlaylistEndpoint
        ?.playlistId;
    const videoId =
      r.navigationEndpoint?.watchEndpoint?.videoId ||
      r.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
        ?.videoId;

    const id = playlistId || (browseId ? browseId.replace(/^VL/, "") : videoId);

    const thumbnails =
      r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbUrl =
      thumbnails?.[thumbnails.length - 1]?.url || thumbnails?.[0]?.url;
    const thumbnailId = extractThumbnailId(thumbUrl);

    if (name && id) {
      return { id, name, thumbnailId };
    }
  }

  if (item.musicResponsiveListItemRenderer) {
    const r = item.musicResponsiveListItemRenderer;
    const firstCol =
      r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
        ?.runs?.[0];
    const name = firstCol?.text?.trim();
    const playlistId =
      firstCol?.navigationEndpoint?.watchPlaylistEndpoint?.playlistId;
    const browseId = firstCol?.navigationEndpoint?.browseEndpoint?.browseId;
    const videoId =
      firstCol?.navigationEndpoint?.watchEndpoint?.videoId ||
      r.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
        ?.videoId;

    const id = playlistId || (browseId ? browseId.replace(/^VL/, "") : videoId);

    const thumbnails =
      r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbUrl =
      thumbnails?.[thumbnails.length - 1]?.url || thumbnails?.[0]?.url;
    const thumbnailId = extractThumbnailId(thumbUrl);

    if (name && id) {
      return { id, name, thumbnailId };
    }
  }

  return null;
}

/**
 * Parses raw category response into structured { [sectionTitle]: PlaylistItem[] }.
 */
export function parseCategoryPayload(data: any): CategoryDetails {
  const sectionList =
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents;

  const result: CategoryDetails = {};
  if (!Array.isArray(sectionList)) {
    return result;
  }

  for (const section of sectionList) {
    const shelf = section.musicCarouselShelfRenderer || section.gridRenderer;
    const sectionTitle =
      shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]
        ?.text || shelf?.header?.gridHeaderRenderer?.title?.runs?.[0]?.text;

    if (!sectionTitle) continue;

    const items = shelf?.contents || shelf?.items || [];
    const playlistItems: PlaylistItem[] = [];

    for (const item of items) {
      const extracted = extractPlaylistItem(item);
      if (extracted) {
        playlistItems.push(extracted);
      }
    }

    if (playlistItems.length > 0) {
      result[sectionTitle] = playlistItems;
    }
  }

  return result;
}

/**
 * Extracts track fields { id, title, isSong, duration, durationStr, thumbnailId, author, authorId }
 * from a musicResponsiveListItemRenderer.
 */
export function extractTrackItem(renderer: any): TrackItem | null {
  const r = renderer?.musicResponsiveListItemRenderer;
  if (!r) return null;

  const videoId =
    r.playlistItemData?.videoId ||
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    r.navigationEndpoint?.watchEndpoint?.videoId;

  if (!videoId) return null;

  const title =
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim() ||
    "";

  // Extract artist / author runs
  const col1Runs: any[] =
    r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
    [];

  const artistRuns = col1Runs.filter(
    (x: any) =>
      x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC") ||
      x.navigationEndpoint?.browseEndpoint
        ?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType ===
        "MUSIC_PAGE_TYPE_ARTIST",
  );

  const author =
    artistRuns.length > 0
      ? artistRuns.map((x: any) => x.text).join(", ")
      : col1Runs[0]?.text?.trim() || "";

  const authorId =
    artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId || null;

  // Duration
  const durationStr =
    r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text?.trim() ||
    "";
  const duration = parseDuration(durationStr);

  // Thumbnail
  const thumbs =
    r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const thumbUrl = thumbs?.[thumbs.length - 1]?.url || thumbs?.[0]?.url;
  const rawThumbnailId = extractThumbnailId(thumbUrl) || videoId;

  // Is Song boolean
  const watchCfg =
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs?.[0]?.navigationEndpoint?.watchEndpoint
      ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig ||
    r.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
      ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig ||
    r.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig;
  const musicVideoType = watchCfg?.musicVideoType;
  const isSong = musicVideoType === "MUSIC_VIDEO_TYPE_ATV";

  const item: TrackItem = {
    id: videoId,
    title,
    isSong,
    duration,
    durationStr,
    author,
    authorId,
  };
  if (isSong) {
    item.thumbnailId = rawThumbnailId;
  }
  return item;
}

/**
 * Fetches tracks for a playlist, album, or mix using the Innertube Browse API.
 */
export async function fetchPlaylistTracks(
  apiKey: string,
  clientVersion: string,
  playlistId: string,
): Promise<TrackItem[]> {
  const browseId = playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
  const browseUrl = `https://music.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`;

  const response = await fetch(browseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB_REMIX",
          clientVersion,
          hl: "en",
          gl: "US",
        },
      },
      browseId,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const json: any = await response.json();
  const shelf =
    json?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents
      ?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer ||
    json?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents
      ?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer ||
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]
      ?.musicPlaylistShelfRenderer ||
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer;

  const rawContents = shelf?.contents || [];
  const tracks: TrackItem[] = [];

  for (const item of rawContents) {
    const track = extractTrackItem(item);
    if (track) {
      tracks.push(track);
    }
  }

  return tracks;
}

/**
 * Fetches playlist tracks with automatic retries on failure.
 */
export async function fetchPlaylistTracksWithRetry(
  apiKey: string,
  clientVersion: string,
  playlistId: string,
  retries = 2,
): Promise<TrackItem[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchPlaylistTracks(apiKey, clientVersion, playlistId);
    } catch (err: any) {
      if (attempt === retries) {
        console.warn(
          `  [Warn] Failed to fetch playlist ${playlistId}: ${err.message}`,
        );
        return [];
      }
      await Bun.sleep(attempt * 800);
    }
  }
  return [];
}

/**
 * Scrapes tracks for all playlists across moods and genres,
 * routes each track directly into its respective partition file normalized/<hex>.json,
 * and updates category files with the 'contents' track ID array.
 */
export async function scrapePlaylistTracks(
  apiKey: string,
  clientVersion: string,
  options: {
    concurrency?: number;
    delayBetweenBatchesMs?: number;
    saveEveryN?: number;
    limitPlaylists?: number;
  } = {},
): Promise<{ totalTracks: number; totalPlaylists: number }> {
  const concurrency = options.concurrency ?? 6;
  const delayMs = options.delayBetweenBatchesMs ?? 100;
  const saveEveryN = options.saveEveryN ?? 50;

  mkdirSync("normalized", { recursive: true });

  // In-memory cache of partition hex -> NormalizedTracks
  const partitionCache = new Map<string, NormalizedTracks>();
  const dirtyPartitions = new Set<string>();

  const getPartition = (hex: string): NormalizedTracks => {
    let part = partitionCache.get(hex);
    if (!part) {
      const filePath = `normalized/${hex}.json`;
      if (existsSync(filePath)) {
        try {
          part = JSON.parse(readFileSync(filePath, "utf-8"));
        } catch {
          part = {};
        }
      } else {
        part = {};
      }
      partitionCache.set(hex, part!);
    }
    return part!;
  };

  const addTrack = (track: TrackItem) => {
    const hex = getTrackPartitionHex(track.id);
    const part = getPartition(hex);
    if (!part[track.id]) {
      if (track.isSong) {
        part[track.id] = { ...track };
      } else {
        const { thumbnailId, ...rest } = track;
        part[track.id] = rest as TrackItem;
      }
      dirtyPartitions.add(hex);
    }
  };

  // 1. Read all mood and genre JSON files
  const moodsDir = "moods";
  const genresDir = "genres";

  const moodFiles = readdirSync(moodsDir).filter((f) => f.endsWith(".json"));
  const genreFiles = readdirSync(genresDir).filter((f) => f.endsWith(".json"));

  const moodsData: Record<string, CategoryDetails> = {};
  const genresData: Record<string, CategoryDetails> = {};

  // Map playlistId -> contents (string[])
  const playlistContentsMap = new Map<string, string[]>();
  const uniquePlaylistIds = new Set<string>();

  const processCategoryContent = (
    dataObj: Record<string, CategoryDetails>,
    dir: string,
    file: string,
  ) => {
    const slug = file.replace(/\.json$/, "");
    const content: CategoryDetails = JSON.parse(
      readFileSync(`${dir}/${file}`, "utf-8"),
    );
    dataObj[slug] = content;
    for (const section of Object.values(content)) {
      for (const item of section) {
        if (!item.id) continue;
        if (
          item.id.startsWith("RDCLAK") ||
          item.id.startsWith("PL") ||
          item.id.startsWith("OLAK") ||
          item.id.startsWith("MPREb") ||
          item.id.length > 15
        ) {
          uniquePlaylistIds.add(item.id);
          if (Array.isArray(item.contents) && item.contents.length > 0) {
            playlistContentsMap.set(item.id, item.contents);
          }
        } else if (item.id.length === 11) {
          // Single track entity
          item.contents = [item.id];
          addTrack({
            id: item.id,
            title: item.name,
            isSong: true,
            duration: 0,
            durationStr: "",
            thumbnailId: item.thumbnailId,
            author: "",
            authorId: null,
          });
          playlistContentsMap.set(item.id, [item.id]);
        }
      }
    }
  };

  for (const file of moodFiles) {
    processCategoryContent(moodsData, moodsDir, file);
  }
  for (const file of genreFiles) {
    processCategoryContent(genresData, genresDir, file);
  }

  const allIds = Array.from(uniquePlaylistIds);
  let toFetch = allIds.filter((id) => !playlistContentsMap.has(id));

  if (options.limitPlaylists && options.limitPlaylists > 0) {
    toFetch = toFetch.slice(0, options.limitPlaylists);
  }

  const alreadyCachedPlaylists = allIds.length - toFetch.length;
  console.log(
    `Found ${allIds.length} unique playlists across all moods and genres.`,
  );
  console.log(
    `Already cached: ${alreadyCachedPlaylists} | To fetch: ${toFetch.length}`,
  );

  const saveCurrentProgress = async () => {
    // Save dirty partition files in normalized/
    for (const hex of dirtyPartitions) {
      const part = partitionCache.get(hex);
      if (part) {
        await Bun.write(
          `normalized/${hex}.json`,
          JSON.stringify(part, null, 2) + "\n",
        );
      }
    }
    dirtyPartitions.clear();

    // Update moods files
    for (const [slug, content] of Object.entries(moodsData)) {
      for (const section of Object.values(content)) {
        for (const item of section) {
          if (playlistContentsMap.has(item.id)) {
            item.contents = playlistContentsMap.get(item.id);
          }
          if (
            !item.thumbnailId ||
            item.thumbnailId.startsWith("http") ||
            item.thumbnailId.includes("/")
          ) {
            const firstTrackId = item.contents?.[0];
            if (firstTrackId) {
              const hex = getTrackPartitionHex(firstTrackId);
              const part = getPartition(hex);
              item.thumbnailId = part[firstTrackId]?.thumbnailId || firstTrackId;
            }
          }
        }
      }
      await Bun.write(
        `moods/${slug}.json`,
        JSON.stringify(content, null, 2) + "\n",
      );
    }

    // Update genres files
    for (const [slug, content] of Object.entries(genresData)) {
      for (const section of Object.values(content)) {
        for (const item of section) {
          if (playlistContentsMap.has(item.id)) {
            item.contents = playlistContentsMap.get(item.id);
          }
          if (
            !item.thumbnailId ||
            item.thumbnailId.startsWith("http") ||
            item.thumbnailId.includes("/")
          ) {
            const firstTrackId = item.contents?.[0];
            if (firstTrackId) {
              const hex = getTrackPartitionHex(firstTrackId);
              const part = getPartition(hex);
              item.thumbnailId = part[firstTrackId]?.thumbnailId || firstTrackId;
            }
          }
        }
      }
      await Bun.write(
        `genres/${slug}.json`,
        JSON.stringify(content, null, 2) + "\n",
      );
    }
  };

  // Fetch playlists in concurrent batches
  let fetchedCount = 0;
  for (let i = 0; i < toFetch.length; i += concurrency) {
    const chunk = toFetch.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (playlistId) => {
        const rawTracks = await fetchPlaylistTracksWithRetry(
          apiKey,
          clientVersion,
          playlistId,
        );
        const trackIds: string[] = [];
        for (const t of rawTracks) {
          trackIds.push(t.id);
          addTrack(t);
        }
        playlistContentsMap.set(playlistId, trackIds);
        fetchedCount++;
      }),
    );

    if (delayMs > 0) {
      await Bun.sleep(delayMs);
    }

    const currentTotal = alreadyCachedPlaylists + fetchedCount;
    const percent =
      allIds.length > 0
        ? ((currentTotal / allIds.length) * 100).toFixed(1)
        : "100.0";
    console.log(
      `[Playlists Progress] ${currentTotal}/${allIds.length} (${percent}%) - Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(toFetch.length / concurrency)}`,
    );

    // Save periodically
    if (fetchedCount > 0 && fetchedCount % saveEveryN === 0) {
      await saveCurrentProgress();
      console.log(
        `  -> Periodic progress saved to normalized/ partition files`,
      );
    }
  }

  // Final save
  await saveCurrentProgress();
  console.log(
    `\nSuccessfully updated category files and saved partition files in normalized/!`,
  );

  // Calculate total tracks across all partitions in normalized/
  let totalTracks = 0;
  const normFiles = readdirSync("normalized").filter((f) =>
    f.endsWith(".json"),
  );
  for (const f of normFiles) {
    try {
      const p = JSON.parse(readFileSync(`normalized/${f}`, "utf-8"));
      totalTracks += Object.keys(p).length;
    } catch {}
  }

  return {
    totalTracks,
    totalPlaylists: playlistContentsMap.size,
  };
}

/**
 * Runs the full scrape:
 * 1. Fetches index of moods and genres, saving to data.json.
 * 2. Fetches and saves category details to ./moods/<slug>.json and ./genres/<slug>.json.
 * 3. Fetches playlist tracks and normalizes directly into normalized/<hex>.json and category contents.
 */
export async function scrapeAll(
  options: {
    categoriesOnly?: boolean;
    playlistsOnly?: boolean;
    limitPlaylists?: number;
  } = {},
): Promise<void> {
  console.log("Fetching moods and genres page...");
  const html = await fetchMoodsAndGenresHtml();
  const { apiKey, clientVersion } = extractInnertubeConfig(html);

  if (!options.playlistsOnly) {
    const browseData = extractBrowseData(html);
    const { moods, genres } = extractCategories(browseData);

    console.log(
      `Discovered ${moods.length} moods and ${genres.length} genres.`,
    );

    // 1. Build and save index to data.json
    const datasetIndex: DatasetIndex = {
      moods: {},
      genres: {},
    };

    for (const m of moods) {
      datasetIndex.moods[m.slug] = m.id;
    }
    for (const g of genres) {
      datasetIndex.genres[g.slug] = g.id;
    }

    await Bun.write("data.json", JSON.stringify(datasetIndex, null, 2) + "\n");
    console.log("Saved data.json successfully!");

    // 2. Ensure directories exist
    mkdirSync("moods", { recursive: true });
    mkdirSync("genres", { recursive: true });
    mkdirSync("normalized", { recursive: true });

    // 3. Scrape each mood
    console.log("\n--- Scraping Moods ---");
    let moodIndex = 1;
    for (const mood of moods) {
      const outPath = `moods/${mood.slug}.json`;
      console.log(
        `[${moodIndex++}/${moods.length}] Scraping mood "${mood.name}" (${mood.slug})...`,
      );
      try {
        const catData = await fetchCategoryData(apiKey, clientVersion, mood.id);
        const parsed = parseCategoryPayload(catData);
        await Bun.write(outPath, JSON.stringify(parsed, null, 2) + "\n");
        console.log(
          `  -> Saved ${outPath} (${Object.keys(parsed).length} sections)`,
        );
      } catch (err: any) {
        console.error(`  -> Failed to scrape mood ${mood.name}:`, err.message);
      }
      await Bun.sleep(150);
    }

    // 4. Scrape each genre
    console.log("\n--- Scraping Genres ---");
    let genreIndex = 1;
    for (const genre of genres) {
      const outPath = `genres/${genre.slug}.json`;
      console.log(
        `[${genreIndex++}/${genres.length}] Scraping genre "${genre.name}" (${genre.slug})...`,
      );
      try {
        const catData = await fetchCategoryData(
          apiKey,
          clientVersion,
          genre.id,
        );
        const parsed = parseCategoryPayload(catData);
        await Bun.write(outPath, JSON.stringify(parsed, null, 2) + "\n");
        console.log(
          `  -> Saved ${outPath} (${Object.keys(parsed).length} sections)`,
        );
      } catch (err: any) {
        console.error(
          `  -> Failed to scrape genre ${genre.name}:`,
          err.message,
        );
      }
      await Bun.sleep(150);
    }
  }

  if (!options.categoriesOnly) {
    console.log(
      "\n--- Scraping Playlist Tracks & Partitioning into normalized/ ---",
    );
    await scrapePlaylistTracks(apiKey, clientVersion, {
      limitPlaylists: options.limitPlaylists,
    });
  }

  console.log("\nAll scraping operations completed successfully!");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const categoriesOnly = args.includes("--categories-only");
  const playlistsOnly = args.includes("--playlists-only");

  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limitPlaylists = limitArg
    ? parseInt(limitArg.split("=")[1] || "", 10)
    : undefined;

  try {
    await scrapeAll({ categoriesOnly, playlistsOnly, limitPlaylists });
  } catch (error) {
    console.error("Fatal scraping error:", error);
    process.exit(1);
  }
}
