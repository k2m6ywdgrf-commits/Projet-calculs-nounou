// Service worker : cache "network-first" pour la page, afin que la PWA
// récupère la dernière version dès qu'une connexion est disponible tout en
// restant lançable hors-ligne. Indispensable en app sur l'écran d'accueil
// iPhone : sans lui, iOS peut resservir indéfiniment une version en cache.
var CACHE = 'nounoupay-v4';
var ASSETS = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-180.png'];

// Tailwind (mise en forme de TOUTE l'appli) et le SDK Firebase sont chargés
// depuis des CDN. Ce sont des scripts statiques et versionnés (jamais de
// données perso dedans) : on les met aussi en cache pour que l'appli reste
// utilisable hors-ligne dès la 2e ouverture, même sans connexion au tout
// premier lancement suivant. Firestore/Auth (données perso, temps réel) ne
// sont volontairement PAS dans cette liste : ils doivent toujours passer
// par le réseau.
var EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) {
        return c.addAll(ASSETS).then(function() {
          // Best-effort : si le device est hors-ligne pile au moment de
          // l'install, on ne bloque pas dessus (repris au prochain fetch réussi).
          return Promise.all(EXTERNAL_ASSETS.map(function(url) {
            return fetch(url).then(function(res) { return c.put(url, res); }).catch(function() {});
          }));
        });
      })
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
  var url = e.request.url;
  var estAssetExterne = EXTERNAL_ASSETS.indexOf(url) !== -1;
  // Cross-origin non listé (Firestore, Auth, popups Google…) : on laisse le
  // SW de côté, il ne ferait que gêner ces requêtes en temps réel.
  if (new URL(url).origin !== self.location.origin && !estAssetExterne) return;
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
