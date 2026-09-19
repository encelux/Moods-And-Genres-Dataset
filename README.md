## Playlist Recommendation API (`/api/recommend`)

A Vercel Function running on Bun that recommends relevant playlists based on a user's listening history track IDs.

### Endpoint: `GET /api/recommend?ids=id1,id2,...`

#### Request:

```
GET /api/recommend?ids=yNa8jP4zoJo,f9fqe_VvWtU&limit=5
```

#### Response (`200 OK`):

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

#### Error Responses:

- **`400 Bad Request`**: When no track IDs are provided (`?ids=` missing or empty).
- **`404 Not Found`**: When no matching or relevant playlists are found for the provided history.
- **`405 Method Not Allowed`**: When non-GET HTTP methods are called.

---

## Dataset Schemas
