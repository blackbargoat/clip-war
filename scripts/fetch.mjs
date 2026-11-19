// Pulls live stats for both channels with no API key.
// Sources: channel about page (subs, avatar), uploads playlist via innertube (every video id),
// player endpoint per video (exact view count), RSS feed as a fallback for recent videos.
// Never overwrites good data with a failed read: if a source fails, the last known value is kept.
import fs from "node:fs/promises";

const CHANNELS = [
  { key: "me", id: "UCpP09symXfvPDQUMd0pv37w" },
  { key: "him", id: "UCFmrAHgWGYKTpkgKEq-9qOg" },
];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CTX = { client: { clientName: "WEB", clientVersion: "2.20241101.00.00", hl: "en", gl: "US" } };
const DATA = new URL("../data/", import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        ...opts,
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI", ...(opts.headers || {}) },
      });
      if (r.ok) return r;
      throw new Error(`${r.status} ${url}`);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}
const num = (s) => (s == null ? null : Number(String(s).replace(/[^0-9]/g, "")) || 0);
function abbrevToNum(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

async function about(id) {
  const html = await (await req(`https://www.youtube.com/channel/${id}/about`)).text();
  const pick = (re) => (html.match(re) || [])[1];
  const subsText = pick(/"subscriberCountText":"([^"]*)"/) || pick(/"subscriberCountText":\{"simpleText":"([^"]*)"/);
  const viewsText = pick(/"viewCountText":"([^"]*)"/);
  return {
    name: pick(/"channelMetadataRenderer":\{"title":"([^"]*)"/),
    handle: pick(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]*)"/),
    avatar: pick(/"avatar":\{"thumbnails":\[\{"url":"(https:\/\/yt3\.googleusercontent\.com\/[^"]*)"/),
    subs: subsText ? (/[KMB]/i.test(subsText) ? abbrevToNum(subsText) : num(subsText)) : null,
    subsText: subsText || null,
    aboutViews: viewsText ? num(viewsText) : null,
  };
}

async function uploads(id) {
  const out = new Map();
  let body = { context: CTX, browseId: "VLUU" + id.slice(2) };
  for (let page = 0; page < 40; page++) {
    const r = await req("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    let token = null;
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (o.playlistVideoRenderer) {
        const v = o.playlistVideoRenderer;
        out.set(v.videoId, { id: v.videoId, title: v.title?.runs?.[0]?.text || v.title?.simpleText || "" });
      }
      if (o.lockupViewModel?.contentId && /VIDEO/.test(o.lockupViewModel.contentType || "VIDEO")) {
        const v = o.lockupViewModel;
        out.set(v.contentId, { id: v.contentId, title: v.metadata?.lockupMetadataViewModel?.title?.content || "" });
      }
      if (o.continuationCommand?.token) token = o.continuationCommand.token;
      for (const k in o) walk(o[k]);
    })(j);
    if (!token) break;
    body = { context: CTX, continuation: token };
  }
  return [...out.values()];
}

async function rss(id) {
  try {
    const xml = await (await req(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text();
    const map = {};
    for (const e of xml.split("<entry>").slice(1)) {
      const vid = (e.match(/<yt:videoId>([^<]+)/) || [])[1];
      if (!vid) continue;
      map[vid] = {
        views: num((e.match(/views="(\d+)"/) || [])[1]),
        published: (e.match(/<published>([^<]+)/) || [])[1],
        title: (e.match(/<title>([^<]+)/) || [])[1],
      };
    }
    return map;
  } catch {
    return {};
  }
}

async function player(videoId) {
  const r = await req("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: CTX, videoId }),
  }, 2);
  const j = await r.json();
  const v = j.videoDetails;
  if (!v || v.viewCount == null) return null;
  const mf = j.microformat?.playerMicroformatRenderer;
  return { views: Number(v.viewCount), title: v.title, published: mf?.publishDate || mf?.uploadDate || null };
}

async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { res[k] = await fn(items[k]); } catch { res[k] = null; }
    }
  }));
  return res;
}

async function readJSON(name, fallback) {
  try { return JSON.parse(await fs.readFile(new URL(name, DATA), "utf8")); } catch { return fallback; }
}

async function saveAvatar(key, url) {
  if (!url) return;
  try {
    const big = url.replace(/=s\d+-/, "=s400-");
    const buf = Buffer.from(await (await req(big)).arrayBuffer());
    if (buf.length > 1000) await fs.writeFile(new URL(`avatar-${key}.jpg`, DATA), buf);
  } catch {}
}

async function channel(c, prev) {
  const p = prev?.[c.key] || {};
  const prevVideos = Object.fromEntries((p.videos || []).map((v) => [v.id, v]));
  let a = {};
  try { a = await about(c.id); } catch (e) { console.warn("about failed", c.key, e.message); }
  let list = null;
  try { list = await uploads(c.id); } catch (e) { console.warn("uploads failed", c.key, e.message); }
  const feed = await rss(c.id);
  if (!list) list = Object.keys(feed).map((id) => ({ id, title: feed[id].title }));
  // keep previously seen videos too (a failed page read should not drop them)
  for (const id in prevVideos) if (!list.find((v) => v.id === id)) list.push({ id, title: prevVideos[id].title });

  const details = await pool(list, 6, (v) => player(v.id));
  let fresh = 0;
  const videos = list.map((v, i) => {
    const d = details[i];
    const f = feed[v.id];
    const old = prevVideos[v.id];
    let views = d?.views ?? f?.views ?? old?.views ?? 0;
    if (d) fresh++;
    if (old && views < old.views && !d) views = old.views; // never go backwards on a fallback read
    return {
      id: v.id,
      title: d?.title || v.title || f?.title || old?.title || "",
      views,
      published: d?.published || f?.published || old?.published || null,
    };
  }).sort((x, y) => y.views - x.views);

  await saveAvatar(c.key, a.avatar || p.avatarUrl);
  const sum = videos.reduce((s, v) => s + v.views, 0);
  return {
    id: c.id,
    name: a.name || p.name || "",
    handle: a.handle || p.handle || null,
    avatarUrl: a.avatar || p.avatarUrl || null,
    subs: a.subs ?? p.subs ?? 0,
    subsText: a.subsText || p.subsText || null,
    views: Math.max(sum, a.aboutViews || 0),
    aboutViews: a.aboutViews ?? p.aboutViews ?? null,
    videoCount: videos.length,
    exactCoverage: list.length ? fresh / list.length : 1,
    top: videos[0] || null,
    videos,
  };
}

const prev = await readJSON("latest.json", null);
const out = { updated: new Date().toISOString() };
for (const c of CHANNELS) out[c.key] = await channel(c, prev);
await fs.writeFile(new URL("latest.json", DATA), JSON.stringify(out, null, 1));

const hist = await readJSON("history.json", []);
const point = {
  t: out.updated,
  me: { v: out.me.views, s: out.me.subs, top: out.me.top?.views || 0 },
  him: { v: out.him.views, s: out.him.subs, top: out.him.top?.views || 0 },
};
const last = hist[hist.length - 1];
if (last && Date.parse(point.t) - Date.parse(last.t) < 20 * 60 * 1000) hist[hist.length - 1] = point;
else hist.push(point);
await fs.writeFile(new URL("history.json", DATA), JSON.stringify(hist));
console.log(JSON.stringify({ me: [out.me.name, out.me.views, out.me.subs, out.me.videoCount, out.me.exactCoverage], him: [out.him.name, out.him.views, out.him.subs, out.him.videoCount, out.him.exactCoverage] }));
