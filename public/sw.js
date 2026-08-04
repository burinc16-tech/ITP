/*
 * App-shell service worker (SPEC §8): the plant-room tool must boot with no
 * signal. Strategy, scoped tightly so nothing dynamic is ever served stale:
 *
 *   /assets/*   content-hashed build output, immutable → cache-first (a new
 *               deploy changes the filename, so the cache self-updates).
 *   navigations network-first, falling back to the cached app shell offline.
 *   /api/*      never touched — records stay fresh and the sync queue owns
 *               offline writes; caching them would defeat both.
 *   cross-origin never touched (the API in a split deploy, fonts, etc.).
 *
 * Templates ride inside the JS bundle, so they're covered by the asset cache;
 * the active project's equipment list is already local-first in IndexedDB.
 */
const VERSION = "v1";
const CACHE = `itp-itr-${VERSION}`;
const SHELL = "/";

self.addEventListener("install", (event) => {
  // Precache the shell, then take over so the next navigation is covered.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Drop caches from older versions, then control open pages immediately.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutations always hit the network
  const url = new URL(req.url);

  // Leave the API and any cross-origin request entirely to the network.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirstShell(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstShell(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    // Keep the shell fresh, but only from the root navigation — never store a
    // /sign/:token response (it needs the live server) as the offline shell.
    if (res.ok && new URL(req.url).pathname === SHELL) cache.put(SHELL, res.clone());
    return res;
  } catch {
    return (await cache.match(SHELL)) ?? Response.error();
  }
}
