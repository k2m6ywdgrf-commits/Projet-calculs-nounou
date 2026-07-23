// Service worker : cache "network-first" pour la page, afin que la PWA
// récupère la dernière version dès qu'une connexion est disponible tout en
// restant lançable hors-ligne. Indispensable en app sur l'écran d'accueil
// iPhone : sans lui, iOS peut resservir indéfiniment une version en cache.
var CACHE = 'nounoupay-v3';
var ASSETS = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-180.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) { return c.addAll(ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; })
                             .map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  // Ne pas intercepter le cross-origin (Firebase, Google auth, gstatic,
  // Tailwind CDN…) : le SW gênerait ces requêtes. On les laisse au navigateur.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function(res) {
      var copy = res.clone();
      caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
      return res;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
