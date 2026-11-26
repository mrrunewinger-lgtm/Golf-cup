const headers = { "Cache-Control": "no-store" };


const origins = new Set(["https://mrrunewinger-lgtm.github.io", "https://purra-golf-api.ruwi60.workers.dev", "https://purra-cup-sync.ruwi60.workers.dev"]);

function validPlayers(players) {
  return Array.isArray(players) && players.every(player =>
    player && typeof player.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(player.id) &&
    typeof player.name === 'string' && Number.isFinite(Number(player.hcp)) &&
    Array.isArray(player.rounds) && player.rounds.length <= 10 &&
    player.rounds.every(strokes => Number.isInteger(strokes) && strokes >= 0)
  ) && new Set(players.map(player => player.id)).size === players.length;
}

function normalizeBackup(data) {
  
  const tournaments = data?.tournaments;
  if (!Array.isArray(tournaments) || !tournaments.length ||
      !tournaments.every(tournament => tournament && typeof tournament.id === 'string' &&
        tournament.id && typeof tournament.name === 'string' && tournament.name.trim() &&
        validPlayers(tournament.players)) ||
      new Set(tournaments.map(tournament => tournament.id)).size !== tournaments.length ||
      !tournaments.some(tournament => tournament.id === data.activeId)) {
    throw new Error('Ugyldig sikkerhetskopi');
  }
  return {activeId: data.activeId, tournaments: tournaments.map(({id,name,players})=>({
    id, name, players: players.map(({id,name,hcp,rounds})=>({id,name,hcp:Number(hcp),rounds}))
  }))};
}


async function cupApi(request, env) {
  const origin = request.headers.get("Origin");
  const cors = { ...headers, Vary: "Origin" };
  if (origins.has(origin)) cors["Access-Control-Allow-Origin"] = origin;
  const reply = (value, status = 200) => Response.json(value, { status, headers: cors });
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      ...cors, "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS"
    } });
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT data, updated_at FROM cup_state WHERE id = 1").first();
      return reply(row ? { state: normalizeBackup(JSON.parse(row.data)), revision: row.updated_at } : { state: null, revision: null });
    }
    if (!["POST","PUT"].includes(request.method)) return reply({},405);
    if (!env.ADMIN_PASSWORD) return reply({ code: "admin_unconfigured" },503);
    if (request.headers.get("Authorization") !== "Bearer " + encodeURIComponent(env.ADMIN_PASSWORD)) return reply({},401);
    if (request.method === "POST") return reply({ admin: true });
    const raw = await request.text();
    if (raw.length > 1000000) return reply({},413);
    let body, state;
    try { body = JSON.parse(raw); state = normalizeBackup(body.state); } catch { return reply({},400); }
    const revision = new Date().toISOString();
    const next = revision === body.revision ? new Date(Date.parse(revision)+1).toISOString() : revision;
    const data = JSON.stringify(state);
    const query = body.revision === null
      ? env.DB.prepare("INSERT INTO cup_state(id,data,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO NOTHING").bind(data,next)
      : env.DB.prepare("UPDATE cup_state SET data=?, updated_at=? WHERE id=1 AND updated_at=?").bind(data,next,body.revision);
    const result = await query.run();
    return result.meta.changes === 1 ? reply({ revision: next }) : reply({},409);
  } catch { return reply({},503); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/state') return cupApi(request, env);
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
