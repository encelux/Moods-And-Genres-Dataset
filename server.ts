import handler from "./api/index";

Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
    const url = new URL(req.url, "http://localhost");

    // Serve static explorer if loaded in browser and no query ids
    if (
      (url.pathname === "/" || url.pathname === "/index.html") &&
      !url.searchParams.has("ids") &&
      !url.searchParams.has("id") &&
      req.headers.get("accept")?.includes("text/html")
    ) {
      return new Response(Bun.file("index.html"));
    }

    // Serve static dataset files
    if (url.pathname === "/data.json") {
      return new Response(Bun.file("data.json"));
    }
    if (
      url.pathname.startsWith("/moods/") ||
      url.pathname.startsWith("/genres/") ||
      url.pathname.startsWith("/normalized/")
    ) {
      const filePath = url.pathname.slice(1);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    // Direct recommendation engine (handles /, /?ids=..., /recommend, /api, etc.)
    return handler(req);
  },
});
