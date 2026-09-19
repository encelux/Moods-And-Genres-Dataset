# Moods & Genres Dataset

A comprehensive open-source dataset, scraping pipeline, interactive Web Explorer, and Vercel Functions Recommendation API for moods, genres, sections, playlists, and tracks extracted directly from [YouTube Music Moods & Genres](https://music.youtube.com/moods_and_genres).

Built with [Bun](https://bun.sh) and TypeScript.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Playlist Recommendation API (`/api/recommend`)](#playlist-recommendation-api-apirecommend)
- [Dataset Schemas & Storage Format](#dataset-schemas--storage-format)
  - [1. Normalized Track Partitions (`normalized/<hex>.json`)](#1-normalized-track-partitions-normalizedhexjson)
  - [2. Category Files (`moods/*.json` & `genres/*.json`)](#2-category-files-moodsjson--genresjson)
  - [3. Primary Index (`data.json`)](#3-primary-index-datajson)
- [Interactive Web Explorer (`index.html`)](#interactive-web-explorer-indexhtml)
- [Vercel Deployment with Bun Runtime](#vercel-deployment-with-bun-runtime)
- [Automated Scheduled Updates (GitHub Actions)](#automated-scheduled-updates-github-actions)
- [Repository & File Structure](#repository--file-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Local Server](#running-the-local-server)
  - [Running the Scraper](#running-the-scraper)
- [License](#license)

---

## Overview & Architecture

YouTube Music categorizes music into distinct **Moods & Moments** (e.g. Chill, Energize, Focus, Workout) and **Genres** (e.g. Rock, Hip-Hop, Classical, Pop). Each category contains multiple curated sections (e.g. _"Coffee shop blends"_, _"Muted jazz"_), and each section houses featured playlists, albums, and singles.

This repository provides:

1. **Automated Scraping**: Reverse-engineers YouTube Music's InnerTube Web Remix API to scrape and normalize all moods, genres, playlists, and tracks.
2. **Deterministic Hex Partitioning**: Over 170,000 unique tracks are normalized and split across 64 individual partition files named after the 2-digit ASCII hex code of each track ID's first character (`normalized/<hex>.json`). This eliminates filesystem case-insensitivity bugs on Windows/macOS and provides $O(1)$ disk lookups.
3. **Pure Song vs. Video Entity Differentiation**: Accurately differentiates between official Audio Track Videos (`MUSIC_VIDEO_TYPE_ATV`, where `isSong: true` with album art `thumbnailId`) and generic YouTube videos (music videos, UGC, live performances, where `isSong: false` with `thumbnailId` omitted).
4. **Vercel Bun Framework Preset Server (`server.ts`)**: Single `Bun.serve()` server configured with `bunVersion: "1.4.x"` in `vercel.json` and `bun.lock` for zero-overhead, native Bun routing on Vercel Functions.
5. **Interactive Web Explorer**: A standalone, zero-dependency `index.html` frontend designed for GitHub Pages with instant client-side search, filtering, clipboard actions, and external links.

---

## Playlist Recommendation API (`/api/recommend`)

Served natively via `Bun.serve()` in [`server.ts`](./server.ts) on Vercel Fluid Compute.

### Endpoint

```http
GET /api/recommend?ids={id1},{id2},...&limit={limit}
```

### Query Parameters

| Parameter    | Type     | Required | Default | Description                                                                                                        |
| :----------- | :------- | :------- | :------ | :----------------------------------------------------------------------------------------------------------------- |
| `ids` / `id` | `string` | **Yes**  | —       | Comma-separated list of YouTube track/video IDs from user listening history (e.g. `?ids=yNa8jP4zoJo,f9fqe_VvWtU`). |
| `limit`      | `number` | No       | `10`    | Maximum number of playlists to return (capped at `50`).                                                            |

### How Recommendation Scoring Works

The engine evaluates all 11,600+ playlist entries across moods and genres:

1. **Exact Track Overlap (+10 pts / track)**: Playlists containing one or more of the user's input tracks receive primary weighting.
2. **Partition Lookup**: The engine resolves track and artist metadata using instant $O(1)$ lookups into only the necessary `normalized/<hex>.json` files.
3. **Ranking & Deduplication**: Playlists are ranked by score descending, deduplicated across duplicate category appearances, and returned with direct YouTube Music links.

### Example Request

```http
GET /api/recommend?ids=yNa8jP4zoJo,f9fqe_VvWtU&limit=5
```

### Example Response (`200 OK`)

```json
{
  "success": true,
  "count": 1,
  "totalInputTracks": 2,
  "recognizedInputTracks": 2,
  "playlists": [
    {
      "id": "RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc",
      "name": "Coffee Shop Blend",
      "thumbnailId": "CDt4RjHDGr0YiX6WxARTBFkdb9k9VsAIm88sJXZ7B3O1yMoS53kLS_dy8ZIKRrFRHHCB6OJePWU1GbY",
      "categoryType": "mood",
      "categorySlug": "chill",
      "section": "Coffee shop blends",
      "score": 20,
      "matchedTrackIds": ["yNa8jP4zoJo", "f9fqe_VvWtU"],
      "matchedArtists": ["Laufey", "Haruomi Hosono"],
      "url": "https://music.youtube.com/playlist?list=RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc"
    }
  ]
}
```

### Error Responses

- **`400 Bad Request`**: When `ids` is missing or empty.
  ```json
  {
    "error": "No valid track IDs provided. Use ?ids=id1,id2 query parameter."
  }
  ```
- **`404 Not Found`**: When no matching or relevant playlists are found for the provided history.
  ```json
  {
    "error": "No relevant playlists found for the provided listening history.",
    "totalInputTracks": 2,
    "recognizedInputTracks": 0
  }
  ```
- **`405 Method Not Allowed`**: When a non-`GET` HTTP method is called.
  ```json
  {
    "error": "Method POST not allowed. Only GET is supported."
  }
  ```

---

## Dataset Schemas & Storage Format

### 1. Normalized Track Partitions (`normalized/<hex>.json`)

To prevent monolithic multi-hundred-megabyte JSON files and eliminate case-sensitivity collisions on Windows and macOS (e.g. `a.json` vs `A.json`), all tracks are partitioned directly into **64 JSON files** named after the 2-digit lowercase ASCII hex code of the track ID's first character:

$$\text{hex} = \text{trackId.charCodeAt}(0)\text{.toString}(16)\text{.padStart}(2, \text{'0'})$$

- `41.json` – `5a.json`: Tracks starting with uppercase letters `'A'` (hex `41`) through `'Z'` (hex `5a`)
- `61.json` – `7a.json`: Tracks starting with lowercase letters `'a'` (hex `61`) through `'z'` (hex `7a`)
- `30.json` – `39.json`: Tracks starting with digits `'0'` (hex `30`) through `'9'` (hex `39`)
- `2d.json`: Tracks starting with hyphen `'-'` (hex `2d`)
- `5f.json`: Tracks starting with underscore `'_'` (hex `5f`)

Each partition file contains a dictionary keyed by track ID: `{ [trackId: string]: TrackItem }`:

```json
{
  "yNa8jP4zoJo": {
    "id": "yNa8jP4zoJo",
    "title": "Madwoman",
    "isSong": false,
    "duration": 285,
    "durationStr": "4:45",
    "author": "Laufey",
    "authorId": "UCJtROTPxo3qnEzww8JyDxuA"
  },
  "f9fqe_VvWtU": {
    "id": "f9fqe_VvWtU",
    "title": "Sincerely",
    "isSong": true,
    "duration": 113,
    "durationStr": "1:53",
    "thumbnailId": "_lAR-xYR8HP_AX-OUpd00ZbI3p_GZuK7d7g9bHvOM_dFBVwkYmbDQsRWBT3Os1IH6a9QBh-vuquPcfhVZA",
    "author": "Haruomi Hosono",
    "authorId": "UCNWPRMK0ciGFGLAuwyR_dgg"
  }
}
```

#### Track Item Fields

| Field         | Type             | Description                                                                                                                                                  |
| :------------ | :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`         | YouTube video / track identifier (e.g. `"f9fqe_VvWtU"`).                                                                                                     |
| `title`       | `string`         | Track or song title.                                                                                                                                         |
| `isSong`      | `boolean`        | `true` strictly for pure YouTube Music Audio Track Videos (`MUSIC_VIDEO_TYPE_ATV`), `false` for YouTube video entities (Official Music Videos, UGC uploads). |
| `duration`    | `number`         | Total duration in integer seconds (e.g. `113`).                                                                                                              |
| `durationStr` | `string`         | Formatted duration string (e.g. `"1:53"`).                                                                                                                   |
| `thumbnailId` | `string?`        | _(Optional)_ Unique ID for square release artwork. Retained **only** when `isSong` is `true`; omitted when `isSong` is `false`.                              |
| `author`      | `string`         | Primary artist or creator name (e.g. `"Haruomi Hosono"`).                                                                                                    |
| `authorId`    | `string \| null` | Artist's YouTube channel identifier (e.g. `"UCNWPRMK0ciGFGLAuwyR_dgg"`), or `null`.                                                                          |

---

### 2. Category Files (`moods/*.json` & `genres/*.json`)

Each mood and genre has a dedicated JSON file located in `./moods/<slug>.json` and `./genres/<slug>.json`. Sections within each category map to lists of playlists. Each playlist entry holds a `contents` array containing the ordered track IDs:

```json
{
  "Coffee shop blends": [
    {
      "id": "RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc",
      "name": "Coffee Shop Blend",
      "thumbnailId": "CDt4RjHDGr0YiX6WxARTBFkdb9k9VsAIm88sJXZ7B3O1yMoS53kLS_dy8ZIKRrFRHHCB6OJePWU1GbY",
      "contents": ["yNa8jP4zoJo", "ekAsG_p2jM4", "f9fqe_VvWtU", "PmSwUCdQQC4"]
    }
  ]
}
```

---

### 3. Primary Index (`data.json`)

Maps all category slugs to their corresponding YouTube Music browse `params` identifier:

```json
{
  "moods": {
    "chill": "ggMPOg1uX1JOQWZFeDByc2Jm",
    "commute": "ggMPOg1uX044Z2o5WERLckpU",
    "energize": "ggMPOg1uXzVpNmJjSDRoQ3F2"
  },
  "genres": {
    "african": "ggMPOg1uX0UzWGxlRE5jMDVk",
    "rock": "ggMPOg1uXzJKTm5jUEZ5Uzlu",
    "hip_hop": "ggMPOg1uXzFRQ2Z2d2k5N2pS"
  }
}
```

---

## Interactive Web Explorer (`index.html`)

The repository includes a single, zero-dependency [`index.html`](./index.html) file ready for GitHub Pages hosting (Source: `Deploy from a branch` &rarr; `/ (root)`):

- **Zero External Dependencies**: Pure HTML, CSS, and Vanilla JavaScript bundled into a single file.
- **On-Demand Fetching**: Loads `data.json` on launch, then lazily loads category JSON files only when selected.
- **Fast Search & Filter**: Real-time client-side search across playlists, sections, and IDs.
- **YouTube Music Dark Theme**: Responsive card grid with automatic cover art rendering via Google Image CDN, click-to-copy IDs, and direct playback links.

---

## Vercel Deployment with Bun Runtime

This project uses Vercel's **Bun framework preset**:

- **`vercel.json`**:
  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "bunVersion": "1.4.x",
    "headers": [
      {
        "source": "/api/(.*)",
        "headers": [
          { "key": "Access-Control-Allow-Origin", "value": "*" },
          { "key": "Access-Control-Allow-Methods", "value": "GET, OPTIONS" },
          { "key": "Access-Control-Allow-Headers", "value": "Content-Type" },
          { "key": "Content-Type", "value": "application/json" }
        ]
      }
    ]
  }
  ```
- **Framework Preset Requirements**:
  1. `bunVersion` is set to `"1.4.x"`.
  2. `bun.lock` (text format) is committed.
  3. Entrypoint is [`server.ts`](./server.ts) invoking `Bun.serve()`.

Deploy directly using the Vercel CLI:

```bash
bunx vercel deploy --prod
```

---

## Automated Scheduled Updates (GitHub Actions)

The repository workflow ([`.github/workflows/update-data.yml`](./.github/workflows/update-data.yml)) automatically refreshes the dataset on a weekly schedule:

- **Schedule**: Every Sunday at 00:00 UTC (`0 0 * * 0`) or manually triggered via `workflow_dispatch`.
- **Environment**: Ubuntu runner with Bun runtime (`oven-sh/setup-bun@v2`).
- **Process**: Executes `bun run scrape` to query the latest YouTube Music browse hierarchies.
- **Auto-Commit**: If new tracks, playlists, or categories are discovered, changes in `data.json`, `moods/`, `genres/`, and `normalized/` are committed and pushed back to `main`.

---

## Repository & File Structure

```
├── .github/workflows/
│   └── update-data.yml    # Weekly dataset updater GitHub Actions workflow
├── api/
│   └── recommend.ts       # Standalone recommendation handler
├── normalized/            # 64 normalized track partition files (<hex>.json)
│   ├── 2d.json            # Tracks starting with '-'
│   ├── 30.json            # Tracks starting with '0'
│   ├── 41.json            # Tracks starting with 'A'
│   ├── 5f.json            # Tracks starting with '_'
│   ├── 61.json            # Tracks starting with 'a'
│   └── ...
├── moods/                 # Mood category files (11 files, with contents: id[])
│   ├── chill.json
│   ├── commute.json
│   ├── energize.json
│   └── ...
├── genres/                # Genre category files (38+ files, with contents: id[])
│   ├── african.json
│   ├── classical.json
│   ├── rock.json
│   └── ...
├── src/
│   ├── recommend.ts       # Core recommendation engine logic
│   ├── scraper.ts         # YouTube Music InnerTube scraping pipeline
│   └── types.ts           # TypeScript definitions & data models
├── bun.lock               # Bun text lockfile
├── data.json              # Primary index mapping slugs to InnerTube params
├── index.html             # Zero-dependency Web Explorer for GitHub Pages
├── index.ts               # CLI scraper entrypoint
├── package.json
├── server.ts              # Bun.serve() server for Vercel Bun preset
├── tsconfig.json
├── vercel.json            # Vercel configuration (bunVersion: 1.4.x)
└── README.md
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0 or higher)

### Installation

```bash
# Clone the repository
git clone https://github.com/n-ce/Moods-And-Genres-Dataset.git
cd Moods-And-Genres-Dataset

# Install dependencies
bun install
```

### Running the Local Server

```bash
# Start the Bun HTTP server (serves index.html at http://localhost:3000 and /api/recommend)
bun run start
```

### Running the Scraper

```bash
# Full scrape: index -> categories -> playlist tracks -> normalized partitions
bun run scrape

# Scrape only categories and update data.json, moods/, and genres/
bun run scrape:categories

# Scrape tracks for all playlists and save to normalized/<hex>.json partitions
bun run scrape:tracks

# Limit playlist scraping for quick testing (e.g. first 20 playlists)
bun run src/scraper.ts --limit=20
```

---

## License

This project is open-source under the [MIT License](LICENSE).
