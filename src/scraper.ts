import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import type {
  DatasetIndex,
  CategoryDetails,
  PlaylistItem,
  CategoryItem,
  TrackItem,
  FullDataset,
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
  if (googleMatch) return googleMatch[1];
  const ytMatch = url.match(/i\.ytimg\.com\/vi\/([^/?]+)/);
  if (ytMatch) return ytMatch[1];
  return url.split("?")[0];
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
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
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
      if (hexMatch) {
        const decoded = hexMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        );
        return JSON.parse(decoded);
      }
    }
  }

  const ytInitialMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});/s);
  if (ytInitialMatch) {
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
  const thumbnailId = extractThumbnailId(thumbUrl) || videoId;

  // Is Song boolean
  const watchCfg =
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs?.[0]?.navigationEndpoint?.watchEndpoint
      ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig;
  const musicVideoType = watchCfg?.musicVideoType;
  const isSong =
    musicVideoType === "MUSIC_VIDEO_TYPE_ATV" ||
    musicVideoType === "MUSIC_VIDEO_TYPE_OMV" ||
    !musicVideoType?.includes("UGC");

  return {
    id: videoId,
    title,
    isSong,
    duration,
    durationStr,
    thumbnailId,
    author,
    authorId,
  };
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

  const json = await response.json();
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
 * Builds and saves full_dataset.json containing the entire hierarchy:
 * moods & genres -> category sections -> playlists -> tracks.
 */
export async function buildFullDataset(
  apiKey: string,
  clientVersion: string,
  options: {
    concurrency?: number;
    delayBetweenBatchesMs?: number;
    saveEveryN?: number;
    limitPlaylists?: number;
  } = {},
): Promise<FullDataset> {
  const concurrency = options.concurrency ?? 6;
  const delayMs = options.delayBetweenBatchesMs ?? 100;
  const saveEveryN = options.saveEveryN ?? 50;

  // In-memory cache of playlistId -> TrackItem[]
  const playlistCache = new Map<string, TrackItem[]>();

  // 1. If full_dataset.json already exists, load existing tracks to resume / cache
  const fullDatasetFile = Bun.file("full_dataset.json");
  if (await fullDatasetFile.exists()) {
    try {
      const existing: FullDataset = await fullDatasetFile.json();
      for (const group of ["moods", "genres"] as const) {
        const categories = existing[group] || {};
        for (const catKey of Object.keys(categories)) {
          const sections = categories[catKey] || {};
          for (const secKey of Object.keys(sections)) {
            for (const item of sections[secKey] || []) {
              if (
                item.id &&
                Array.isArray(item.tracks) &&
                item.tracks.length > 0
              ) {
                playlistCache.set(item.id, item.tracks);
              }
            }
          }
        }
      }
      console.log(
        `Loaded ${playlistCache.size} existing playlists from full_dataset.json cache.`,
      );
    } catch {
      console.warn(
        "Could not parse existing full_dataset.json, starting fresh cache.",
      );
    }
  }

  // 2. Read all mood and genre JSON files
  const moodsDir = "moods";
  const genresDir = "genres";

  const moodFiles = readdirSync(moodsDir).filter((f) => f.endsWith(".json"));
  const genreFiles = readdirSync(genresDir).filter((f) => f.endsWith(".json"));

  const fullDataset: FullDataset = {
    moods: {},
    genres: {},
  };

  // Collect all unique playlist IDs that need fetching
  const uniquePlaylistIds = new Set<string>();

  for (const file of moodFiles) {
    const slug = file.replace(/\.json$/, "");
    const content: CategoryDetails = JSON.parse(
      readFileSync(`${moodsDir}/${file}`, "utf-8"),
    );
    fullDataset.moods[slug] = content;
    for (const section of Object.values(content)) {
      for (const item of section) {
        if (
          item.id &&
          (item.id.startsWith("RDCLAK") ||
            item.id.startsWith("PL") ||
            item.id.startsWith("OLAK") ||
            item.id.startsWith("MPREb") ||
            item.id.length > 15)
        ) {
          uniquePlaylistIds.add(item.id);
        }
      }
    }
  }

  for (const file of genreFiles) {
    const slug = file.replace(/\.json$/, "");
    const content: CategoryDetails = JSON.parse(
      readFileSync(`${genresDir}/${file}`, "utf-8"),
    );
    fullDataset.genres[slug] = content;
    for (const section of Object.values(content)) {
      for (const item of section) {
        if (
          item.id &&
          (item.id.startsWith("RDCLAK") ||
            item.id.startsWith("PL") ||
            item.id.startsWith("OLAK") ||
            item.id.startsWith("MPREb") ||
            item.id.length > 15)
        ) {
          uniquePlaylistIds.add(item.id);
        }
      }
    }
  }

  const allIds = Array.from(uniquePlaylistIds);
  let toFetch = allIds.filter((id) => !playlistCache.has(id));

  if (options.limitPlaylists && options.limitPlaylists > 0) {
    toFetch = toFetch.slice(0, options.limitPlaylists);
  }

  console.log(
    `Found ${allIds.length} unique playlists across all moods and genres.`,
  );
  console.log(
    `Already cached: ${playlistCache.size} | To fetch: ${toFetch.length}`,
  );

  // Helper function to attach cached tracks and write dataset
  const saveCurrentProgress = async () => {
    for (const group of ["moods", "genres"] as const) {
      for (const catKey of Object.keys(fullDataset[group])) {
        for (const secKey of Object.keys(fullDataset[group][catKey])) {
          for (const item of fullDataset[group][catKey][secKey]) {
            if (playlistCache.has(item.id)) {
              item.tracks = playlistCache.get(item.id);
            } else if (
              !item.id.startsWith("RDCLAK") &&
              !item.id.startsWith("PL") &&
              !item.id.startsWith("OLAK") &&
              item.id.length === 11
            ) {
              // Single track
              item.tracks = [
                {
                  id: item.id,
                  title: item.name,
                  isSong: true,
                  duration: 0,
                  durationStr: "",
                  thumbnailId: item.thumbnailId,
                  author: "",
                  authorId: null,
                },
              ];
            } else if (!item.tracks) {
              item.tracks = [];
            }
          }
        }
      }
    }
    await Bun.write(
      "full_dataset.json",
      JSON.stringify(fullDataset, null, 2) + "\n",
    );
  };

  // 3. Fetch playlists in concurrent batches
  let fetchedCount = 0;
  for (let i = 0; i < toFetch.length; i += concurrency) {
    const chunk = toFetch.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (playlistId) => {
        const tracks = await fetchPlaylistTracksWithRetry(
          apiKey,
          clientVersion,
          playlistId,
        );
        playlistCache.set(playlistId, tracks);
        fetchedCount++;
      }),
    );

    if (delayMs > 0) {
      await Bun.sleep(delayMs);
    }

    const currentTotal = playlistCache.size;
    const percent = ((currentTotal / allIds.length) * 100).toFixed(1);
    console.log(
      `[Playlists Progress] ${currentTotal}/${allIds.length} (${percent}%) - Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(toFetch.length / concurrency)}`,
    );

    // Save periodically
    if (fetchedCount > 0 && fetchedCount % saveEveryN === 0) {
      await saveCurrentProgress();
      console.log(`  -> Periodic progress saved to full_dataset.json`);
    }
  }

  // Final save
  await saveCurrentProgress();
  console.log(`\nSuccessfully built and saved full_dataset.json!`);
  return fullDataset;
}

/**
 * Runs the full scrape:
 * 1. Fetches index of moods and genres, saving to data.json.
 * 2. Fetches and saves category details to ./moods/<slug>.json and ./genres/<slug>.json.
 * 3. Fetches playlist tracks and builds nested full_dataset.json.
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

    // 3. Scrape each mood
    console.log("\n--- Scraping Moods ---");
    for (let i = 0; i < moods.length; i++) {
      const mood = moods[i];
      const outPath = `moods/${mood.slug}.json`;
      console.log(
        `[${i + 1}/${moods.length}] Scraping mood "${mood.name}" (${mood.slug})...`,
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
    for (let i = 0; i < genres.length; i++) {
      const genre = genres[i];
      const outPath = `genres/${genre.slug}.json`;
      console.log(
        `[${i + 1}/${genres.length}] Scraping genre "${genre.name}" (${genre.slug})...`,
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
    console.log("\n--- Building Full Dataset with Playlist Tracks ---");
    await buildFullDataset(apiKey, clientVersion, {
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
    ? parseInt(limitArg.split("=")[1], 10)
    : undefined;

  try {
    await scrapeAll({ categoriesOnly, playlistsOnly, limitPlaylists });
  } catch (error) {
    console.error("Fatal scraping error:", error);
    process.exit(1);
  }
}
