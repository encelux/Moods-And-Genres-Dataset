import { recommendPlaylists } from "./src/recommend";
import { existsSync, readFileSync } from "node:fs";

console.log(`[Server] Initializing Bun.serve() with Bun ${process.versions.bun}...`);

export default Bun.serve({
  routes: {
    "/health": () => Response.json({ status: "ok", runtime: `bun ${process.versions.bun}` }),

    "/api/recommend": (req) => {
      if (req.method !== "GET") {
        return new Response(
          JSON.stringify({ error: `Method ${req.method} not allowed. Only GET is supported.` }),
          { status: 405, headers: { Allow: "GET" } },
        );
      }

      try {
        const url = new URL(req.url);
        const idsParam = url.searchParams.get("ids") || url.searchParams.get("id");

        const inputIds = idsParam
          ? idsParam
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

        let limit = 10;
        const limitParam = url.searchParams.get("limit");
        if (limitParam) {
          const parsedLimit = parseInt(limitParam, 10);
          if (!isNaN(parsedLimit) && parsedLimit > 0) {
            limit = Math.min(parsedLimit, 50);
          }
        }

        if (inputIds.length === 0) {
          return new Response(
            JSON.stringify({
              error: "No valid track IDs provided. Use ?ids=id1,id2 query parameter.",
            }),
            { status: 400 },
          );
        }

        const result = recommendPlaylists(inputIds, { limit });

        if (result.recommendations.length === 0) {
          return new Response(
            JSON.stringify({
              error: "No relevant playlists found for the provided listening history.",
              totalInputTracks: result.totalInputTracks,
              recognizedInputTracks: result.recognizedInputTracks,
            }),
            { status: 404 },
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            count: result.recommendations.length,
            totalInputTracks: result.totalInputTracks,
            recognizedInputTracks: result.recognizedInputTracks,
            playlists: result.recommendations,
          }),
          { status: 200 },
        );
      } catch (err: any) {
        console.error("[API Error] recommend error:", err);
        return new Response(
          JSON.stringify({
            error: "Internal server error while generating playlist recommendations.",
            message: err.message,
          }),
          { status: 500 },
        );
      }
    },
  },

  async fetch(req) {
    const url = new URL(req.url);

    // Serve index.html at root
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (existsSync("index.html")) {
        return new Response(readFileSync("index.html", "utf-8"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    // Serve static files from root (data.json, moods/, genres/, normalized/)
    const filePath = url.pathname.replace(/^\/+/, "");
    if (filePath && existsSync(filePath)) {
      const file = Bun.file(filePath);
      return new Response(file);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
});
