// Service worker for PWA
// Implements standard PWA caching strategy:
// - Cache static assets (JS, CSS, images, icons) for performance
// - Always fetch API calls from network (no caching for real-time data)

const CACHE_NAME = 'tiddelihome-v1';
const VERSION = '0.1.245'; // This will be replaced at build time

// Get base path from service worker's own location
// If service worker is at /TiddeliHome/service-worker.js, base path is /TiddeliHome/
// If service worker is at /service-worker.js, base path is /
const getBasePath = () => {
  const swPath = self.location.pathname; // e.g., "/TiddeliHome/service-worker.js" or "/service-worker.js"
  const basePath = swPath.substring(0, swPath.lastIndexOf('/') + 1); // e.g., "/TiddeliHome/" or "/"
  return basePath;
};

const BASE_PATH = getBasePath();

// Static assets to cache (files that don't change often)
// Paths are relative to service worker scope (handled by Vite base path)
const STATIC_ASSETS = [
  BASE_PATH, // Root (e.g., "/TiddeliHome/" or "/")
  BASE_PATH + 'index.html',
  BASE_PATH + 'manifest.json',
  BASE_PATH + 'audio-processor.js',
  // JS, CSS, images will be matched by extension
];

// Install event - required for PWA
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...', VERSION);
  
  // Check if this is a first install or an update
  // On first install (no active service worker), activate immediately for PWA installability
  // On updates (active service worker exists), wait for user confirmation
  if (self.registration && self.registration.active) {
    // There's an active service worker - this is an update
    // Don't skip waiting - wait for SKIP_WAITING message from user
    console.log('Update detected - waiting for user confirmation (SKIP_WAITING message)');
    // Don't call skipWaiting() - the service worker will wait in "installed" state
  } else {
    // No active service worker - this is a first install
    // Activate immediately so service worker controls the page (required for PWA installability)
    console.log('First install detected - activating immediately for PWA installability');
    self.skipWaiting();
  }
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...', VERSION);
  // Claim clients immediately - this is required for PWA installability
  // The beforeinstallprompt event requires the service worker to be controlling the page
  event.waitUntil(
    // Clean up old caches
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old cache versions
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim clients
      return clients.claim().then(() => {
        // Notify all clients about the new version
        return clients.matchAll().then((clientList) => {
          clientList.forEach((client) => {
            client.postMessage({
              type: 'SW_VERSION',
              version: VERSION
            });
          });
        });
      });
    })
  );
});

// Fetch event - implement standard PWA caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const request = event.request;
  
  // Skip non-GET requests (POST, PUT, etc.) - always fetch from network
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }
  
  // Skip Vite dev server resources (development only)
  // These should never be cached by the service worker
  const pathname = url.pathname;
  const isViteDevResource = 
    pathname.startsWith('/@') || // Vite special paths like /@vite/client
    pathname.startsWith('/src/') || // Source files in dev mode
    pathname.startsWith('/node_modules/'); // Node modules in dev mode
  
  if (isViteDevResource) {
    // Bypass service worker for Vite dev resources - don't intercept at all
    // Return without calling event.respondWith() to let browser handle it natively
    return;
  }
  
  // Check if this is a static asset that should be cached
  // Note: url.pathname already includes base path (e.g., "/TiddeliHome/index.html")
  const isStaticAsset = 
    // JavaScript files
    pathname.endsWith('.js') ||
    // CSS files
    pathname.endsWith('.css') ||
    // Images
    pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i) ||
    // Icons directory
    pathname.includes('/icons/') ||
    // Manifest (with or without base path)
    pathname === '/manifest.json' || pathname === BASE_PATH + 'manifest.json' ||
    // HTML (main page) - check for base path root or index.html
    pathname === BASE_PATH || pathname === BASE_PATH + 'index.html' || pathname === '/' || pathname === '/index.html' ||
    // Audio processor (with or without base path)
    pathname === '/audio-processor.js' || pathname === BASE_PATH + 'audio-processor.js';
  
  // Check if this is an API call that should NOT be cached
  const isAPICall = 
    // External API calls (Gemini, Home Assistant)
    url.origin !== self.location.origin ||
    // API endpoints (if you add any in the future)
    url.pathname.startsWith('/api/') ||
    // WebSocket connections (not handled by fetch, but good to exclude)
    url.protocol === 'ws:' || url.protocol === 'wss:';
  
  if (isStaticAsset && !isAPICall) {
    // Cache-first strategy for static assets
    // This improves performance and reduces server load
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // Try cache first
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          // Return from cache, but also update cache in background (stale-while-revalidate)
          // This ensures cache stays fresh without blocking the response
          fetch(request).then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(request, networkResponse.clone());
            }
          }).catch(() => {
            // Ignore network errors when updating cache in background
          });
          return cachedResponse;
        }
        
        // Not in cache - fetch from network
        try {
          const networkResponse = await fetch(request);
          // Cache successful responses
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          console.warn('Service Worker: Failed to fetch static asset', url.pathname, error);
          // Return a basic error response instead of throwing
          return new Response('Network error', { 
            status: 408,
            statusText: 'Request Timeout'
          });
        }
      })
    );
  } else {
    // Network-only strategy for API calls and dynamic content
    // Always fetch from network - no caching for real-time data
    event.respondWith(
      fetch(request).catch((error) => {
        console.warn('Service Worker: Fetch failed for', url.pathname, error);
        // Re-throw to let the browser handle it naturally
        throw error;
      })
    );
  }
});

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('Service Worker: Received SKIP_WAITING, activating now');
    self.skipWaiting().then(() => {
      // After skipping waiting, claim clients
      return clients.claim();
    });
  } else if (event.data && event.data.type === 'GET_VERSION') {
    // Send version back to client
    event.ports[0]?.postMessage({
      type: 'SW_VERSION',
      version: VERSION
    });
    // Also try to send via clients if ports not available
    clients.matchAll().then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({
          type: 'SW_VERSION',
          version: VERSION
        });
      });
    });
  }
});

