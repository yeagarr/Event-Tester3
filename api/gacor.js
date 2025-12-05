// /api/gacor.js (CommonJS)
const PROVIDERS = {
  all:        { label: "Semua Provider", url: null },

  pragmatic:  { label: "Pragmatic",      url: "https://pyw.maxrtpnew.com/index.html" },
  pgsoft:     { label: "PGSOFT",         url: "https://pyw.maxrtpnew.com/pgsoft.html" },
  "5g":       { label: "5G",             url: "https://pyw.maxrtpnew.com/5g.html" },
  nolimit:    { label: "NoLimit",        url: "https://pyw.maxrtpnew.com/nolimit.html" },
  habanero:   { label: "Habanero",       url: "https://pyw.maxrtpnew.com/habanero.html" },
  live22:     { label: "Live22",         url: "https://pyw.maxrtpnew.com/live22.html" },
  netent:     { label: "NetEnt",         url: "https://pyw.maxrtpnew.com/netent.html" },
  joker:      { label: "Joker",          url: "https://pyw.maxrtpnew.com/joker.html" },
  spade:      { label: "Spade",          url: "https://pyw.maxrtpnew.com/spade.html" },
  jili:       { label: "Jili",           url: "https://pyw.maxrtpnew.com/jili.html" },
  fastspin:   { label: "Fastspin",       url: "https://pyw.maxrtpnew.com/fastspin.html" },
  playstar:   { label: "PlayStar",       url: "https://pyw.maxrtpnew.com/playstar.html" },
  cq9:        { label: "CQ9",            url: "https://pyw.maxrtpnew.com/cq9.html" },
  microgaming:{ label: "Microgaming",    url: "https://pyw.maxrtpnew.com/microgaming.html" },
  ttg:        { label: "TTG",            url: "https://pyw.maxrtpnew.com/ttg.html" },
};

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = tag.match(re);
  return m ? m[1] : "";
}

function cleanTitle(alt) {
  let t = (alt || "").trim();
  t = t.replace(/^Persentase\s+RTP\s+untuk\s+/i, "");
  t = t.replace(/\s+oleh\s+.+$/i, "");
  return t.trim();
}

function toAbs(url, base) {
  try { return new URL(url, base).toString(); } catch { return url; }
}

function parseGamesFromHtml(html, baseUrl, providerKey, providerLabel) {
  const items = [];
  const seen = new Set();

  const imgTagRe = /<img\b[^>]*>/gi;
  const tags = html.match(imgTagRe) || [];

  for (const tag of tags) {
    const srcRaw = attr(tag, "src");
    const alt = attr(tag, "alt");

    if (!srcRaw) continue;

    // ambil hanya gambar game (yang alt-nya biasanya "Persentase RTP untuk ...")
    const isGame = /Persentase\s+RTP/i.test(alt || "");
    if (!isGame) continue;

    const img = toAbs(srcRaw, baseUrl);
    if (seen.has(img)) continue;
    seen.add(img);

    const title = cleanTitle(alt);
    if (!title) continue;

    items.push({
      id: `${providerKey}:${img.split("/").pop() || img}`,
      provider: providerLabel,
      title,
      image: img,
      rawAlt: alt || "",
    });
  }

  return items;
}

async function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; GacorBot/1.0; +https://vercel.com)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  try {
    const host = req.headers.host || "localhost";
    const u = new URL(req.url, `http://${host}`);
    const providerKey = (u.searchParams.get("provider") || "all").toLowerCase();

    // list provider buat UI
    if (providerKey === "providers") {
      const list = Object.entries(PROVIDERS)
        .filter(([k]) => k !== "providers")
        .map(([key, v]) => ({ key, label: v.label, url: v.url }));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).end(JSON.stringify({ ok: true, providers: list }));
    }

    const cfg = PROVIDERS[providerKey] || PROVIDERS.all;

    // "all" -> jangan fetch heavy di serverless; biar client yang loop per provider
    if (providerKey === "all") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).end(JSON.stringify({
        ok: true,
        mode: "all-client",
        message: "Gunakan client untuk memanggil per-provider: /api/gacor?provider=pragmatic, pgsoft, dst."
      }));
    }

    if (!cfg.url) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.status(400).end(JSON.stringify({ ok: false, error: "Provider tidak valid." }));
    }

    const baseUrl = cfg.url;
    const { ok, status, text } = await fetchWithTimeout(cfg.url);

    const items = parseGamesFromHtml(text, baseUrl, providerKey, cfg.label);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");

    return res.status(200).end(JSON.stringify({
      ok: true,
      provider: providerKey,
      label: cfg.label,
      source: cfg.url,
      fetched: { ok, status },
      updatedAt: new Date().toISOString(),
      count: items.length,
      items,
    }));
  } catch (e) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).end(JSON.stringify({
      ok: false,
      error: "Gagal ambil/parse sumber (mungkin putus koneksi / diblok / timeout).",
      detail: String(e && e.message ? e.message : e),
    }));
  }
};
