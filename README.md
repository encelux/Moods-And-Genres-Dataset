# Moods & Genres Dataset

A comprehensive JSON dataset of moods, genres, sections, playlists, and tracks extracted directly from [YouTube Music Moods & Genres](https://music.youtube.com/moods_and_genres).

Includes an interactive, zero-dependency Web Explorer for GitHub Pages ([`index.html`](./index.html)) and a GitHub Actions workflow for scheduled dataset updates.

Built with [Bun](https://bun.sh) and TypeScript.

---

## Dataset Schemas

### 1. Full Dataset Hierarchy ([`full_dataset.json`](./full_dataset.json))

Contains the entire nested tree: **moods/genres &rarr; categories &rarr; playlists/items &rarr; tracks**:

```json
{
  "moods": {
    "chill": {
      "Coffee shop blends": [
        {
          "id": "RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc",
          "name": "Coffee Shop Blend",
          "thumbnailId": "CDt4RjHDGr0YiX6WxARTBFkdb9k9VsAIm88sJXZ7B3O1yMoS53kLS_dy8ZIKRrFRHHCB6OJePWU1GbY",
          "tracks": [
            {
              "id": "yNa8jP4zoJo",
              "title": "Madwoman",
              "isSong": true,
              "duration": 285,
              "durationStr": "4:45",
              "thumbnailId": "yNa8jP4zoJo",
              "author": "Laufey",
              "authorId": "UCJtROTPxo3qnEzww8JyDxuA"
            },
            {
              "id": "ekAsG_p2jM4",
              "title": "Look To Him (Official Video)",
              "isSong": false,
              "duration": 264,
              "durationStr": "4:24",
              "thumbnailId": "ekAsG_p2jM4",
              "author": "Greentea Peng",
              "authorId": "UCLi9BEXTwUeCdrp9Mt0Oxbg"
            }
          ]
        }
      ]
    }
  },
  "genres": {
    "african": { ... }
  }
}
```

#### Track Item Fields:

- `id`: YouTube video / track identifier (e.g. `"yNa8jP4zoJo"`).
- `title`: Name of the track or song.
- `isSong`: `true` strictly for pure YouTube Music songs (Audio Track Videos / official label releases: `MUSIC_VIDEO_TYPE_ATV`), `false` for YouTube video entities (Official Music Videos, lyric videos, UGC uploads).
- `duration`: Total duration in integer seconds (e.g. `285`).
- `durationStr`: Formatted duration string (e.g. `"4:45"`).
- `thumbnailId`: Unique identifier for the track thumbnail image.
- `author`: Primary artist or author name (e.g. `"Laufey"`).
- `authorId`: Artist's YouTube channel / browse identifier (e.g. `"UCJtROTPxo3qnEzww8JyDxuA"`), or `null`.

---

### 2. Category Files ([`moods/*.json`](./moods/) & [`genres/*.json`](./genres/))

Each mood and genre has a dedicated JSON file under `./moods/<slug>.json` and `./genres/<slug>.json`:

```json
{
  "Coffee shop blends": [
    {
      "id": "RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc",
      "name": "Coffee Shop Blend",
      "thumbnailId": "CDt4RjHDGr0YiX6WxARTBFkdb9k9VsAIm88sJXZ7B3O1yMoS53kLS_dy8ZIKRrFRHHCB6OJePWU1GbY"
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
3. **Auto-Commits**: Detects changes in `data.json`, `moods/`, `genres/`, and `full_dataset.json` and commits them back to `main`.

---

## Directory Structure

```
├── .github/workflows/
│   └── update-data.yml    # Scheduled dataset update workflow
├── full_dataset.json      # Complete nested dataset (moods & genres -> playlists -> tracks)
├── index.html             # Zero-dependency web explorer for GitHub Pages
├── data.json              # Primary index mapping moods & genres to browse IDs
├── moods/                 # Category JSON files for each mood (11 files)
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
├── genres/                # Category JSON files for each genre (38 files)
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

### Available Commands

- **Full Scrape** (Index + Categories + Full Dataset with Tracks):

  ```bash
  bun run scrape
  ```

- **Categories Only** (Quick scrape of `data.json`, `moods/`, and `genres/`):

  ```bash
  bun run scrape:categories
  ```

- **Tracks Only** (Update/enrich playlists and tracks into `full_dataset.json`):

  ```bash
  bun run scrape:tracks
  ```

- **Scrape with Playlist Limit** (useful for testing):
  ```bash
  bun run scrape:tracks --limit=20
  ```
