// Service worker for TiddeliHome
// Strategy: Stale-While-Revalidate for UI assets, Network-Only for APIs
const CACHE_NAME = 'tiddelihome-v1';
const VERSION = '0.1.268'; // This will be replaced at build time

// Automatically detect base path (e.g., /TiddeliHome/ or /)
const getBasePath = () => {
  const swPath = self.location.pathname;
  return swPath.substring(0, swPath.lastIndexOf('/') + 1);
};
const BASE_PATH = getBasePath();

// Core assets required for the app to function and be installable
const STATIC_ASSETS = [
  BASE_PATH,
  BASE_PATH + 'index.html',
  BASE_PATH + 'manifest.json',
  BASE_PATH + 'audio-processor.js'
];

// Install: Create cache and pre-cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        // If pre-caching fails (e.g., in dev mode), continue anyway
        console.warn('SW: Pre-cache failed (this is OK in dev mode):', err);
      });
    })
  );
  // Only skip waiting on first install (when there's no active service worker)
  // For updates, wait for user confirmation via SKIP_WAITING message
  if (!self.controller) {
    // First install - activate immediately for PWA installability
    self.skipWaiting();
  }
  // Otherwise, wait for user to click "Update Now" which sends SKIP_WAITING message
});

// Activate: Clean up old versions and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('SW: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Required for immediate PWA installability
  );
});

// Fetch: The logic that minimizes server hits while satisfying Google
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const pathname = url.pathname;
  
  // Skip Vite dev server resources (development only)
  // These should never be cached by the service worker
  const isViteDevResource = 
    pathname.startsWith('/@') || // Vite special paths like /@vite/client
    pathname.startsWith('/src/') || // Source files in dev mode
    pathname.startsWith('/node_modules/'); // Node modules in dev mode
  
  if (isViteDevResource) {
    // Bypass service worker for Vite dev resources - don't intercept at all
    return;
  }
  
  // 1. Skip non-GET and API/External requests (Network Only)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Stale-While-Revalidate for UI/Static assets (including navigation, manifest, icons)
  // This is key: Chrome needs to see the service worker handle these requests properly
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchedResponse = fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
            cache.put(event.request, networkResponse.clone()); // Update cache in background
          }
          return networkResponse;
        }).catch((error) => {
          // If network fails and we have cache, return cache
          if (cachedResponse) {
            return cachedResponse;
          }
          // Otherwise let the error propagate
          throw error;
        });

        // Return cached version if exists, otherwise wait for network
        return cachedResponse || fetchedResponse;
      });
    })
  );
});

// Listen for SKIP_WAITING to handle updates gracefully
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting().then(() => clients.claim());
  } else if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({
      type: 'SW_VERSION',
      version: VERSION
    });
  }
});
