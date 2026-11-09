/* Répar'Loc : l'appli s'ouvre même sans réseau (la démo fonctionne hors ligne). */
const CACHE = "reparloc-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "vendor/supabase.js", "vendor/qrcode.js", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // les données Supabase ne sont jamais mises en cache
  // réseau d'abord (pour recevoir les mises à jour), cache si pas de réseau
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});

/* Notifications sur le téléphone : affichage et ouverture du dossier concerné. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(d.title || "Répar'Loc", {body: d.body || "", tag: d.tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: {url: d.url || "./"}}));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) { c.postMessage({open: url}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
