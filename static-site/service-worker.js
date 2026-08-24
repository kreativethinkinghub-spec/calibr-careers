// CALIBR Service Worker — offline-first caching
var CACHE_VERSION = 'calibr-v7-2026-08-08';
var STATIC_CACHE = [
  '/',
  '/index.html',
  '/pricing.html',
  '/contact.html',
  '/css/style.css',
  '/js/main.js',
  '/js/faq-bot.js',
  '/manifest.json'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return cache.addAll(STATIC_CACHE).catch(function(){});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_VERSION; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  // Network-first for HTML (fresh content), cache-first for assets
  var isHtml = e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').indexOf('text/html') !== -1;
  // Network-first for BOTH html and assets during active development,
  // so fresh CSS/JS always wins; cache is only an offline fallback.
  e.respondWith(
    fetch(e.request).then(function(res){
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function(c){ c.put(e.request, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(r){
        return r || (isHtml ? caches.match('/index.html') : undefined);
      });
    })
  );
});
