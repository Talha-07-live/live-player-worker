// worker.js — Deploy with `wrangler deploy`

export default {
  async fetch(req) {
    const url = new URL(req.url);

    // 🔍 Debug mode → ?debug=1 দিলে candidate list JSON আকারে পাবে
    if (url.searchParams.get("debug") === "1") {
      const { all } = await extractHls(IFRAME_URL, req);
      return new Response(JSON.stringify({ candidates: all }, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    // Optional proxy (for CORS bypass)
    if (url.pathname === "/proxy") {
      const raw = url.searchParams.get("url");
      if (!raw) return new Response("Missing url", { status: 400 });
      const upstream = await fetch(raw, {
        headers: {
          "User-Agent": req.headers.get("user-agent") || "Mozilla/5.0",
          "Referer": "https://topembed.pw/", // কিছু সাইট রেফারার চায়
          "Origin": "https://topembed.pw"
        },
      });
      const h = new Headers(upstream.headers);
      h.set("Access-Control-Allow-Origin", "*");
      h.delete("set-cookie");
      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    // 🎯 তোমার iframe URL এখানে বসাও
    const IFRAME_URL = "https://topembed.pw/channel/WillowXtra2[USA]";

    // Extract HLS link
    const { hls } = await extractHls(IFRAME_URL, req);
    if (!hls) {
      return new Response("❌ No HLS/M3U8 found", { status: 404 });
    }

    // Serve player
    return new Response(playerHtml(hls), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
};

// ==========================
// ADVANCED EXTRACTOR
// ==========================
async function extractHls(pageUrl, req) {
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent": req.headers.get("user-agent") || "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": pageUrl,
    },
  });
  const html = await res.text();

  const candidates = new Set();

  // Different patterns
  matchAll(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi, html).forEach(u => candidates.add(cleanUrl(u)));
  matchAll(/data-(?:file|src)=["'](https?:[^"']+\.m3u8[^"']*)["']/gi, html).forEach(u => candidates.add(cleanUrl(u)));
  matchAll(/\bsrc\s*:\s*["'](https?:[^"']+\.m3u8[^"']*)["']/gi, html).forEach(u => candidates.add(cleanUrl(u)));
  matchAll(/sources\s*:\s*\[\s*\{[^}]*?src\s*:\s*["'](https?:[^"']+\.m3u8[^"']*)["']/gis, html).forEach(u => candidates.add(cleanUrl(u)));
  matchAll(/"(https?:[^"']+\.m3u8[^"']*)"/gi, html).forEach(u => candidates.add(cleanUrl(u)));
  matchAll(/https?:\\\/\\\/[^"']+?\.m3u8[^"']*/gi, html).forEach(u => {
    try { candidates.add(cleanUrl(u.replace(/\\\//g, "/"))); } catch {}
  });

  // Relative → absolute
  const regexPlaylist = /["']([^"']+\.m3u8[^"']*)["']/gi;
  matchAll(regexPlaylist, html).forEach(u => {
    if (!/^https?:/.test(u)) {
      try { candidates.add(new URL(u, pageUrl).toString()); } catch {}
    }
  });

  // Filter ads
  const DENY = ["doubleclick.net", "googlesyndication.com", "adservice.google.com"];
  const filtered = Array.from(candidates).filter(u => {
    try {
      const host = new URL(u).host;
      return !DENY.some(d => host.endsWith(d));
    } catch { return false; }
  });

  filtered.sort((a, b) => scoreUrl(b) - scoreUrl(a));
  return { hls: filtered[0] || null, all: filtered };
}

function matchAll(regex, text) {
  const out = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
    else if (m[0]) out.push(m[0]);
  }
  return out;
}

function cleanUrl(u) {
  let s = u.trim().replace(/[)\\]}>]+$/, "");
  try { s = decodeURIComponent(s); } catch {}
  return s;
}

function scoreUrl(u) {
  try {
    const x = new URL(u);
    let s = 0;
    if (x.protocol === "https:") s += 2;
    if (x.search.length > 10) s += 2;
    if (/token|sig|exp|expires|policy|signature/i.test(u)) s += 3;
    if (/\.m3u8$/i.test(x.pathname)) s += 1;
    return s + Math.min(3, u.length / 100);
  } catch { return 0; }
}

// ==========================
// PLAYER HTML
// ==========================
function playerHtml(hlsUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Live Player</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/plyr@3/dist/plyr.css"/>
<style>
  body { margin:0; background:#000; }
  video { width:100%; height:100vh; background:#000; }
</style>
</head>
<body>
<video id="v" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
<script src="https://cdn.jsdelivr.net/npm/plyr@3"></script>
<script>
  const video=document.getElementById('v');
  const player=new Plyr(video);
  const hlsUrl=${JSON.stringify(hlsUrl)};
  function load(url){
    if(Hls.isSupported()){
      const hls=new Hls({ liveSyncDuration:4, liveMaxLatencyDuration:10 });
      hls.attachMedia(video);
      hls.loadSource("/proxy?url="+encodeURIComponent(url));
    } else if(video.canPlayType('application/vnd.apple.mpegurl')){
      video.src="/proxy?url="+encodeURIComponent(url);
    } else {
      alert("HLS not supported");
    }
  }
  load(hlsUrl);
</script>
</body>
</html>`;
    }
