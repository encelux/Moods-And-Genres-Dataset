# Moods & Genres Dataset

A comprehensive JSON dataset of moods, genres, sections, and playlists extracted directly from [YouTube Music Moods & Genres](https://music.youtube.com/moods_and_genres).

Includes an interactive, zero-dependency Web Explorer for GitHub Pages ([`index.html`](./index.html)) and a GitHub Actions workflow for scheduled dataset updates.

Built with [Bun](https://bun.sh) and TypeScript.

---

## Dataset Schema

### 1. Index File ([`data.json`](./data.json))

Maps each mood and genre slug to its YouTube Music browse `params` identifier:

```json
{
  "moods": {
    "chill": "ggMPOg1uX1JOQWZFeDByc2Jm",
    "commute": "ggMPOg1uX044Z2o5WERLckpU",
    "energize": "ggMPOg1uX2lRZUZiMnNrQnJW",
    "feel_good": "ggMPOg1uXzZQbDB5eThLRTQ3",
    "focus": "ggMPOg1uX0NvNGNhWThMYWRh",
    "gaming": "ggMPOg1uX3NmUVV4Vzl3WGQ0",
    "party": "ggMPOg1uX0pmQ0s2V0JRclZs",
    "romance": "ggMPOg1uX0FzQ2FhZWtUY211",
    "sad": "ggMPOg1uX0JLQ0gySWZKZVY1",
    "sleep": "ggMPOg1uX1MxaFQ3Z0JMZkN4",
    "workout": "ggMPOg1uX09LWkhnTjRGRUJh"
  },
  "genres": {
    "african": "ggMPOg1uX0UzWGxlRE5jMDVk",
    "arabic": "ggMPOg1uX3VOQWxsblVZTFNE",
    "dance_and_electronic": "ggMPOg1uX1NPTld3SDN3WGs4",
    "hip_hop": "ggMPOg1uX0M2dmRieXNxTW1s",
    "rock": "ggMPOg1uXzJKTm5jUEZ5Uzlu"
  }
}
```

### 2. Category Files ([`moods/*.json`](./moods/) & [`genres/*.json`](./genres/))

Each mood and genre has a dedicated JSON file under `./moods/<slug>.json` and `./genres/<slug>.json`. The file organizes playlists, tracks, or albums by section title, with each section containing a list of item objects:

```json
{
  "Coffee shop blends": [
    {
      "id": "RDCLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc",
      "name": "Coffee Shop Blend",
      "thumbnailId": "CDt4RjHDGr0YiX6WxARTBFkdb9k9VsAIm88sJXZ7B3O1yMoS53kLS_dy8ZIKRrFRHHCB6OJePWU1GbY"
    },
    {
      "id": "RDCLAK5uy_l80pbx0UAQ7EWipFs57eQnUIB9KbaDEow",
      "name": "Cafecito & Chill",
      "thumbnailId": "8-oaSCmYeAL_WyGX8AZ9fWa_z6COU5XVBqspkeJ4iAPYugoIGkB_Hkn5sTgVjzLi9V8jj8IoMtMRw8J2"
    }
  ],
  "Unwind + explore": [
    {
      "id": "RDCLAK5uy_nHSqCJjDrW9HBhCNdF6tWPdnOMngOv0wA",
      "name": "Pop Gold",
      "thumbnailId": "jYjY9U_Y9U_..."
    }
  ]
}
```

- **Section Titles**: The shelf or carousel titles (e.g. `"Coffee shop blends"`, `"Featured playlists"`, `"Songs"`, `"Albums"`).
- **Item Fields**:
  - `id`: Playlist ID (`RDCLAK...`, `PL...`), track video ID, or album ID (prefixed `VL` stripped).
  - `name`: Name or title of the playlist/song/album.
  - `thumbnailId`: Unique identifier for the thumbnail image (extracted from `googleusercontent.com`, `ggpht.com`, or YouTube video thumbnail URLs).

---

## Web Explorer ([`index.html`](./index.html))

The repository includes a single, zero-dependency [`index.html`](./index.html) file ready to be served directly via GitHub Pages (Source: `Deploy from a branch` -> `/ (root)`):

- **Zero dependencies**: Pure HTML, CSS, and Vanilla JavaScript in a single file.
- **Client-Side Data Fetching**: Dynamically loads `data.json` and fetches individual category files (`./moods/<slug>.json`, `./genres/<slug>.json`) on demand.
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
3. **Auto-Commits**: Detects changes in `data.json`, `moods/`, and `genres/` and commits them back to `main`.

---

## Directory Structure

```
├── .github/workflows/
│   └── update-data.yml    # Scheduled dataset update workflow
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

### Run the Scraper

To scrape the entire index and all individual mood and genre JSON files:

```bash
bun run scrape
```

Or run via the main entry point:

```bash
bun run start
```
