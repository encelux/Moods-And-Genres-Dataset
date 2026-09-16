import { mkdirSync } from "node:fs";
import type {
  DatasetIndex,
  CategoryDetails,
  PlaylistItem,
  CategoryItem,
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
 * Runs the full scrape:
 * 1. Fetches index of moods and genres, saving { moods: { [slug]: id }, genres: { [slug]: id } } to data.json.
 * 2. Fetches and saves category details to ./moods/<slug>.json and ./genres/<slug>.json.
 */
export async function scrapeAll(): Promise<void> {
  console.log("Fetching moods and genres page...");
  const html = await fetchMoodsAndGenresHtml();
  const { apiKey, clientVersion } = extractInnertubeConfig(html);
  const browseData = extractBrowseData(html);
  const { moods, genres } = extractCategories(browseData);

  console.log(`Discovered ${moods.length} moods and ${genres.length} genres.`);

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
      const catData = await fetchCategoryData(apiKey, clientVersion, genre.id);
      const parsed = parseCategoryPayload(catData);
      await Bun.write(outPath, JSON.stringify(parsed, null, 2) + "\n");
      console.log(
        `  -> Saved ${outPath} (${Object.keys(parsed).length} sections)`,
      );
    } catch (err: any) {
      console.error(`  -> Failed to scrape genre ${genre.name}:`, err.message);
    }
    await Bun.sleep(150);
  }

  console.log("\nAll moods and genres have been scraped successfully!");
}

if (import.meta.main) {
  try {
    await scrapeAll();
  } catch (error) {
    console.error("Fatal scraping error:", error);
    process.exit(1);
  }
}
