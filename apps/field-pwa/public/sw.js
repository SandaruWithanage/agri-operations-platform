// Only the explicit public shell and immutable public build assets belong in Cache Storage.
// Private data lives solely in the encrypted IndexedDB vault, never in HTTP caches.
const CACHE = "agri-public-shell-v2";
const SHELL = "/offline-workspace";
function staticAsset(url) {
  return (
    url.origin === self.location.origin &&
    /^\/_next\/static\/.+\.(js|css|woff2)$/.test(url.pathname)
  );
}
function publicRequest(url) {
  return new Request(url, { credentials: "omit", cache: "reload" });
}
async function installShell() {
  const cache = await caches.open(CACHE);
  await cache.add("/offline.html");
  const response = await fetch(
    publicRequest(new URL(SHELL, self.location.origin).href),
  );
  if (!response.ok || response.headers.get("x-agri-public-shell") !== "1")
    throw new Error("Public shell unavailable");
  const html = await response.clone().text();
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(
      match[1].replaceAll("&amp;", "&"),
      self.location.origin,
    );
    if (staticAsset(url)) assets.add(url.origin + url.pathname);
  }
  if (assets.size === 0) throw new Error("Public shell assets unavailable");
  await Promise.all([...assets].map((url) => cache.add(publicRequest(url))));
  await cache.put(SHELL, response);
}
self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("agri-fallback-") ||
                  key.startsWith("agri-public-shell-")) &&
                key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET")
    return;
  if (staticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const key = publicRequest(url.origin + url.pathname);
        const existing = await cache.match(key);
        if (existing) return existing;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(key, response.clone());
        return response;
      })(),
    );
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const response = await fetch(event.request);
          if (
            url.pathname === SHELL &&
            response.ok &&
            response.headers.get("x-agri-public-shell") === "1"
          )
            await cache.put(SHELL, response.clone());
          return response;
        } catch {
          return (
            (url.pathname === SHELL ? await cache.match(SHELL) : null) ||
            (await cache.match("/offline.html"))
          );
        }
      })(),
    );
  }
});
self.addEventListener("message", (event) => {
  if (event.data !== "AGRI_PUBLIC_SHELL" || !event.ports[0]) return;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.match(SHELL))
      .then((response) =>
        event.ports[0].postMessage({ version: 2, ready: Boolean(response) }),
      ),
  );
});
