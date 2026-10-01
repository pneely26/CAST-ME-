// Offline support: the page loads fresh when online; other files come from cache and refresh in the background.
const CACHE = "sales-tracker-v12";
const APP = [
  "./", "index.html", "manifest.webmanifest",
  "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "vendor/pdf-lib.min.js", "vendor/anthropic.min.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The page itself: newest version when online, saved copy when offline.
    if (req.mode === "navigate") {
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) cache.put("index.html", res.clone());
        return res;
      } catch (err) {
        return (await cache.match("index.html")) || Response.error();
      }
    }
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    const fresh = fetch(req).then(res => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  })());
});
