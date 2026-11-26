const headers = { "Cache-Control": "no-store" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        await env.DB.prepare("SELECT id, data, updated_at FROM cup_state LIMIT 0").all();
        return Response.json({ database: "ok" }, { headers });
      }
      if (url.pathname !== "/proverunde") return new Response("Ukjent side", { status: 404 });
      if (request.method === "POST") {
        if (!env.ADMIN_PASSWORD) return new Response("Sett ADMIN_PASSWORD i Cloudflare først.", { status: 503, headers });
        if (request.headers.get("Origin") !== url.origin) return new Response("Avvist", { status: 403 });
        const form = await request.formData();
        if (form.get("password") !== env.ADMIN_PASSWORD) return new Response("Feil administratorpassord", { status: 403, headers });
        await env.DB.batch([
          env.DB.prepare("CREATE TABLE IF NOT EXISTS sync_test_round (id INTEGER PRIMARY KEY, gross INTEGER NOT NULL, handicap INTEGER NOT NULL)"),
          env.DB.prepare("INSERT OR IGNORE INTO sync_test_round (id, gross, handicap) VALUES (1, 95, 18)")
        ]);
        return Response.redirect(url.href, 303);
      }
      if (request.method !== "GET") return new Response("Avvist", { status: 405 });
      const exists = await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sync_test_round'").first();
      const row = exists && await env.DB.prepare("SELECT gross, handicap FROM sync_test_round WHERE id=1").first();
      const body = row
        ? '<p>Lagret i D1</p><p>Brutto ' + Number(row.gross) + ' · Handicap ' + Number(row.handicap) + ' · Netto ' + (row.gross-row.handicap) + '</p>'
        : '<p>95 bruttoslag · Handicap 18</p><form method="post"><label>Administratorpassord <input type="password" name="password" required></label><p><button>Lagre prøverunde</button></p></form>';
      return new Response('<!doctype html><html lang="no"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purra prøverunde</title><main><h1>Purra prøverunde</h1>' + body + '</main></html>', { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" } });
    } catch {
      return Response.json({ database: "unavailable" }, { status: 503, headers });
    }
  }
};
