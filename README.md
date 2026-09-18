# Moods & Genres Dataset

A comprehensive JSON dataset of moods, genres, sections, playlists, and tracks extracted directly from [YouTube Music Moods & Genres](https://music.youtube.com/moods_and_genres).

Includes a normalized tracks dictionary, category files with playlist content references, an interactive zero-dependency Web Explorer for GitHub Pages ([`index.html`](./index.html)), and a GitHub Actions workflow for scheduled dataset updates.

Built with [Bun](https://bun.sh) and TypeScript.

---

## Dataset Schemas

### 1. Normalized Tracks ([`normalized_tracks.json`](./normalized_tracks.json))

Contains all unique tracks across all playlists normalized into a single dictionary keyed by track ID: `{ [trackId: string]: TrackItem }`.

- **Pure Songs (`isSong: true`)**: Retain `thumbnailId` (square cover art from official label releases).
- **Videos / Non-Songs (`isSong: false`)**: The `thumbnailId` property is omitted.

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

#### Track Item Fields:

- `id`: YouTube video / track identifier (e.g. `"f9fqe_VvWtU"`).
- `title`: Name of the track or song.
- `isSong`: `true` strictly for pure YouTube Music songs (Audio Track Videos / official label releases: `MUSIC_VIDEO_TYPE_ATV`), `false` for YouTube video entities (Official Music Videos, lyric videos, UGC uploads).
- `duration`: Total duration in integer seconds (e.g. `113`).
- `durationStr`: Formatted duration string (e.g. `"1:53"`).
- `thumbnailId`: _(Optional)_ Unique identifier for the track thumbnail image. Present strictly when `isSong` is `true`; omitted when `isSong` is `false`.
- `author`: Primary artist or author name (e.g. `"Haruomi Hosono"`).
- `authorId`: Artist's YouTube channel / browse identifier (e.g. `"UCNWPRMK0ciGFGLAuwyR_dgg"`), or `null`.

---

### 2. Category Files ([`moods/*.json`](./moods/) & [`genres/*.json`](./genres/))

Each mood and genre has a dedicated JSON file under `./moods/<slug>.json` and `./genres/<slug>.json`. Each playlist contains a `contents` array of track ID strings referencing entries in [`normalized_tracks.json`](./normalized_tracks.json):

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

### 3. Primary Index File ([`data.json`](./data.json))

Maps each mood and genre slug to its YouTube Music browse `params` identifier:

```json
{
  "moods": {
    "chill": "ggMPOg1uX1JOQWZFeDByc2Jm",
    "commute": "ggMPOg1uX044Z2o5WERLckpU"
  },
  "genres": {
    "african": "ggMPOg1uX0UzWGxlRE5jMDVk",
    "rock": "ggMPOg1uXzJKTm5jUEZ5Uzlu"
  }
}
```

---

## Web Explorer ([`index.html`](./index.html))

The repository includes a single, zero-dependency [`index.html`](./index.html) file ready to be served directly via GitHub Pages (Source: `Deploy from a branch` -> `/ (root)`):

- **Zero dependencies**: Pure HTML, CSS, and Vanilla JavaScript in a single file.
- **Client-Side Data Fetching**: Dynamically loads `data.json` and fetches individual category files on demand.
- **Search & Filter**: Real-time search by playlist/track title or ID.
- **Responsive Layout**: Dark theme matching YouTube Music, with instant thumbnail rendering, clipboard copy for IDs, and direct links to YouTube Music.

To preview locally:

```bash
bun x serve .
```

---

## Periodic Updates via GitHub Actions

The workflow in [`.github/workflows/update-data.yml`](./.github/workflows/update-data.yml):

1. **Schedule**: Runs periodically every week (`0 0 * * 0`) or on-demand (`workflow_dispatch`).
2. **Scrapes Fresh Data**: Runs `bun run scrape` using the latest InnerTube API configuration.
3. **Auto-Commits**: Detects changes in `data.json`, `moods/`, `genres/`, and `normalized_tracks.json`, and commits them back to `main`.

---

## Directory Structure

```
├── .github/workflows/
│   └── update-data.yml    # Scheduled dataset update workflow
├── normalized_tracks.json # Normalized track dictionary (omitting thumbnailId for non-songs)
├── index.html             # Zero-dependency web explorer for GitHub Pages
├── data.json              # Primary index mapping moods & genres to browse IDs
├── moods/                 # Category JSON files for each mood (11 files, with contents: id[])
│   ├── chill.json
│   ├── commute.json
│   ├── energize.json
│   ├── feel_good.json
│   ├── focus.json
│   ├── gaming.json
│   ├── party.json
│   ├── romance.json
│   ├── sad.json
│   ├── sleep.json
│   └── workout.json
├── genres/                # Category JSON files for each genre (38 files, with contents: id[])
│   ├── african.json
│   ├── dance_and_electronic.json
│   ├── hip_hop.json
│   ├── rock.json
│   └── ...
├── src/
│   ├── scraper.ts         # Scraping logic and Innertube API queries
│   └── types.ts           # TypeScript interfaces and data models
├── index.ts               # Main entrypoint
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)

### Installation

```bash
bun install
```

### Scraping Dataset

```bash
# Scrape everything (index, category files, playlist tracks, and normalized tracks)
bun run scrape

# Scrape only category index and individual mood/genre files
bun run scrape:categories

# Scrape playlist tracks and update normalized_tracks.json
bun run scrape:tracks
```
