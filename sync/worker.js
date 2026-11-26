export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/health" || request.method !== "GET") {
      return new Response("Not found", { status: 404 });
    }
    try {
      await env.DB.prepare("SELECT id, data, updated_at FROM cup_state LIMIT 0").all();
      return Response.json({ database: "ok" }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
};
