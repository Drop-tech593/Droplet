// sw.js - Service Worker for Droplet PWA

const CACHE_NAME = 'droplet-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/Gemini_Generated_Image_sdu6v7sdu6v7sdu6.jpg',
  '/Untitled design.png',
  // Core document converters
  '/pdf-to-word.html',
  '/word-to-pdf.html',
  '/pdf-to-txt.html',
  '/epub-to-pdf.html',
  '/txt-to-pdf.html',
  '/pdf-to-pdfa.html',
  '/pdf-to-powerpoint.html',
  '/pdf-to-excel.html',
  // Image converters
  '/heic-to-jpg.html',
  '/webp-to-jpg.html',
  '/avif-to-png.html',
  '/gif-to-png.html',
  '/psd-to-png.html',
  '/raw-to-jpg.html',
  '/tiff-to-pdf.html',
  '/jpg-to-pdf.html',
  '/pdf-to-jpg.html',
  '/webp-to-png.html',
  '/svg-to-png.html',
  // Data tools
  '/json-to-csv.html',
  '/csv-to-json.html',
  '/xml-to-json.html',
  // Legal pages
  '/privacy.html',
  '/terms.html',
  '/faq.html',
  '/contact.html',
  // Coming soon page
  '/coming-soon.html'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Removing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached response if found
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise fetch from network
        return fetch(event.request)
          .then((response) => {
            // Don't cache if not a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            // Cache the new response
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Offline fallback
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/offline.html');
            }
            return new Response('Offline - Please check your connection.', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
