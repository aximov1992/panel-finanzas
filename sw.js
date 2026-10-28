// Service worker mínimo: deja la app instalable y abre el armazón rápido.
// Los datos nunca se guardan acá: las llamadas a la planilla van siempre a la red.
const CACHE = "finanzas-shell-v2";
const SHELL = [
  "./", "index.html", "css/style.css", "js/app.js", "js/model.js", "js/api.js", "js/config.js", "js/fmt.js", "js/util.js", "js/suggest.js", "js/forms.js",
  "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate para archivos propios; lo demás pasa directo a la red.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
