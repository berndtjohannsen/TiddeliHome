import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, writeFileSync, watchFile } from 'fs';
import { resolve } from 'path';
import { networkInterfaces } from 'os';

// Function to update service worker version
function updateServiceWorkerVersion() {
  try {
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
    const swPath = resolve(__dirname, 'public/service-worker.js');
    let swContent = readFileSync(swPath, 'utf-8');
    const newVersion = packageJson.version;
    const oldVersionMatch = swContent.match(/const VERSION = ['"]([^'"]*)['"];/);
    const oldVersion = oldVersionMatch ? oldVersionMatch[1] : 'unknown';
    
    if (oldVersion !== newVersion) {
      swContent = swContent.replace(
        /const VERSION = ['"][^'"]*['"];/,
        `const VERSION = '${newVersion}';`
      );
      writeFileSync(swPath, swContent);
      console.log(`✅ Service worker version updated: ${oldVersion} → ${newVersion}`);
    }
  } catch (error) {
    console.error('Error updating service worker version:', error);
  }
}

// Update immediately
updateServiceWorkerVersion();

// Watch package.json for changes
watchFile('./package.json', { interval: 1000 }, () => {
  updateServiceWorkerVersion();
});

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Function to get local network IP for HMR WebSocket
function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces || {})) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

export default defineConfig({
  plugins: [
    mkcert(),
    tailwindcss(),
    // Plugin to inject version into service worker
    {
      name: 'inject-version',
      buildStart() {
        updateServiceWorkerVersion();
      },
      configureServer(server) {
        // Update in dev mode when server starts
        updateServiceWorkerVersion();
      }
    },
    // Plugin to ensure manifest.json is served with correct content-type
    {
      name: 'manifest-content-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/manifest.json') {
            res.setHeader('Content-Type', 'application/manifest+json');
          }
          next();
        });
      }
    }
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    https: true, // Enable HTTPS (handled by mkcert plugin)
    hmr: {
      // Use the network IP for HMR WebSocket instead of localhost
      // This prevents the fallback to localhost which fails on mobile devices
      host: localIP,
      protocol: 'wss', // Use secure WebSocket
      clientPort: 3000, // Same port as server
    },
  } as any, // Type assertion needed due to mkcert plugin type compatibility
  build: {
    outDir: 'dist',
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});

