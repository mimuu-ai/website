const CACHE_NAME = 'mimuu-v2';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/chat',
  '/chat.css',
  '/chat.js',
  '/favicon-192.png',
  '/favicon-512.png',
  '/mimuu-avatar.png',
  '/offline.html',
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/marked@15/marked.min.js'
];

// Install — precache essentials
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for API, cache first for assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls or SSE streams
  if (url.pathname.startsWith('/api/') || 
      event.request.headers.get('accept')?.includes('text/event-stream')) {
    return;
  }

  // For navigation (HTML pages) — network first, fallback to offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // For assets — cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Fallback for images
      if (event.request.destination === 'image') {
        return new Response('', { status: 404 });
      }
    })
  );
});
