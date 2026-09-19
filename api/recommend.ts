import { recommendPlaylists } from "../src/recommend";

/**
 * Vercel Function entry point using Web Request / Response standard (Bun runtime).
 * Exclusively handles GET requests. CORS headers are managed via vercel.json.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: `Method ${req.method} not allowed. Only GET is supported.`,
      }),
      {
        status: 405,
        headers: { Allow: "GET" },
      },
    );
  }

  try {
    // Provide base URL to safely parse relative URLs (e.g. "/api/recommend?ids=...") in serverless runtimes
    const url = new URL(req.url, "http://localhost");
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
          error:
            "No valid track IDs provided. Use ?ids=id1,id2 query parameter.",
        }),
        { status: 400 },
      );
    }

    const result = recommendPlaylists(inputIds, { limit });

    if (result.recommendations.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "No relevant playlists found for the provided listening history.",
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
    console.error("[API Error] recommend function failure:", err);
    return new Response(
      JSON.stringify({
        error:
          "Internal server error while generating playlist recommendations.",
        message: err.message,
      }),
      { status: 500 },
    );
  }
}
