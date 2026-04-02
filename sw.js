var CACHE_NAME = 'gfig-v3';
var STATIC_CACHE = 'gfig-static-v3';
var DYNAMIC_CACHE = 'gfig-dynamic-v3';

var urlsToCache = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/login.html',
  '/missions.html',
  '/report.html',
  '/profile.html',
  '/roster.html',
  '/logbook.html',
  '/livemap.html',
  '/fleet.html',
  '/tours.html',
  '/schedule.html',
  '/nag.html',
  '/nag-routes.html',
  '/codeshare.html',
  '/achievements.html',
  '/weather.html',
  '/notam.html',
  '/training.html',
  '/events.html',
  '/pireps.html',
  '/css/style.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/dashboard.js',
  '/js/report.js',
  '/js/missions.js',
  '/logo.png'
];

/* Offline fallback page content */
var OFFLINE_PAGE = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — GFIG</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0b1f3a;color:#e0e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}.wrap{max-width:400px}h1{font-size:2rem;margin-bottom:12px}p{color:#8899aa;margin-bottom:24px}button{padding:12px 28px;background:#0077ff;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}button:hover{background:#0066dd}</style></head><body><div class="wrap"><h1>✈ You\'re Offline</h1><p>GFIG needs an internet connection to sync with operations. Check your connection and try again.</p><button onclick="location.reload()">Retry</button></div></body></html>';

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      /* Cache offline page first, then best-effort cache everything else */
      return cache.put('/offline.html', new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html' } }))
        .then(function() {
          return cache.addAll(urlsToCache).catch(function() {
            /* Some pages may not be available yet, that's fine */
          });
        });
    })
  );
});

self.addEventListener('fetch', function(event) {
  var request = event.request;

  /* Skip non-GET and Firebase/external API requests */
  if (request.method !== 'GET') return;
  if (request.url.indexOf('firestore.googleapis.com') !== -1) return;
  if (request.url.indexOf('firebase') !== -1 && request.url.indexOf('gstatic') === -1) return;

  event.respondWith(
    /* Network-first for HTML pages, cache-first for assets */
    (request.destination === 'document'
      ? fetch(request).then(function(resp) {
          if (resp && resp.status === 200) {
            var clone = resp.clone();
            caches.open(DYNAMIC_CACHE).then(function(c) { c.put(request, clone); });
          }
          return resp;
        }).catch(function() {
          return caches.match(request).then(function(r) { return r || caches.match('/offline.html'); });
        })
      : caches.match(request).then(function(cached) {
          if (cached) return cached;
          return fetch(request).then(function(resp) {
            if (resp && resp.status === 200) {
              var clone = resp.clone();
              caches.open(DYNAMIC_CACHE).then(function(c) { c.put(request, clone); });
            }
            return resp;
          }).catch(function() { return undefined; });
        })
    )
  );
});

self.addEventListener('activate', function(event) {
  var keep = [STATIC_CACHE, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return keep.indexOf(n) === -1; })
          .map(function(n) { return caches.delete(n); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* Background Sync — retry failed report submissions */
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-reports') {
    event.waitUntil(
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SYNC_REPORTS' });
        });
      })
    );
  }
});

/* Push notifications placeholder */
self.addEventListener('push', function(event) {
  var data = event.data ? event.data.json() : { title: 'GFIG', body: 'New mission available!' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'GFIG Operations', {
      body: data.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      tag: data.tag || 'gfig-notification',
      data: { url: data.url || '/dashboard.html' }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/dashboard.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.indexOf(url) !== -1 && 'focus' in clients[i]) return clients[i].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
