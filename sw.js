/* Cache everything on install so the app opens with no network at all. */
const CACHE = "dust-index-20260829-1241";
const ASSETS = [
  "./", "./index.html", "./app.css", "./app.js", "./data.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-180.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // Page loads go network-first: with signal you always get the newest
  // version on the FIRST open (and the fresh copy replaces the cached one);
  // without signal, the cache answers. Assets stay cache-first — they are
  // versioned by the cache name, so they only change when the SW does.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => { c.put("./", copy.clone()); c.put("./index.html", copy); });
        }
        return res;
      }).catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // Opportunistically keep fonts once they've been fetched once.
        if (res.ok && /fonts\.(googleapis|gstatic)\.com/.test(e.request.url)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
