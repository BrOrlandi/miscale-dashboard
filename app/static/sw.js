// Service worker: makes the dashboard installable and lets the app shell open offline.
// Pages and static files are network-first (always fresh when the server is reachable);
// the API and the WebSocket are never cached.
const CACHE = "miscale-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/static/vendor/chart.umd.min.js",
  "/static/icons/icon-192.png", "/static/icons/favicon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin
      || url.pathname.startsWith("/api/") || url.pathname === "/ws") return;
  event.respondWith(fetch(event.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); }
    return res;
  }).catch(() => caches.match(event.request, { ignoreSearch: true })
    .then((hit) => hit || (event.request.mode === "navigate" ? caches.match("/") : Response.error()))));
});
