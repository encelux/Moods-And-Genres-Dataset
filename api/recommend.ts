import { recommendPlaylists } from "../src/recommend";

/**
 * Standard CORS headers for client-side web integration.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

/**
 * Vercel Function entry point using Web Request / Response standard (Bun runtime).
 */
export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  try {
    let inputIds: string[] = [];
    let limit = 10;

    if (req.method === "POST") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON in request body" }),
          { status: 400, headers: CORS_HEADERS },
        );
      }

      if (Array.isArray(body.ids)) {
        inputIds = body.ids.filter((id: any) => typeof id === "string" && id.trim().length > 0);
      } else if (typeof body.ids === "string") {
        inputIds = body.ids.split(",").map((s: string) => s.trim()).filter(Boolean);
      }

      if (typeof body.limit === "number" && body.limit > 0) {
        limit = Math.min(Math.floor(body.limit), 50);
      }
    } else if (req.method === "GET") {
      const url = new URL(req.url);
      const idsParam = url.searchParams.get("ids") || url.searchParams.get("id");
      if (idsParam) {
        inputIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
      }
      const limitParam = url.searchParams.get("limit");
      if (limitParam) {
        const parsedLimit = parseInt(limitParam, 10);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, 50);
        }
      }
    } else {
      return new Response(
        JSON.stringify({ error: `Method ${req.method} not allowed` }),
        {
          status: 405,
          headers: { ...CORS_HEADERS, Allow: "GET, POST, OPTIONS" },
        },
      );
    }

    if (inputIds.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No valid track IDs provided. Provide 'ids' array in body or ?ids=id1,id2 query param.",
        }),
        { status: 400, headers: CORS_HEADERS },
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
        { status: 404, headers: CORS_HEADERS },
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
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (err: any) {
    console.error("[API Error] recommend function failure:", err);
    return new Response(
      JSON.stringify({
        error: "Internal server error while generating playlist recommendations.",
        message: err.message,
      }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
