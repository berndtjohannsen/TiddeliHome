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

// Get base path from environment variable (for GitHub Pages)
// If GITHUB_REPOSITORY is set (e.g., "username/TiddeliHome"), use /TiddeliHome/
// Otherwise, use root path for localhost or custom domain
const getBasePath = (): string => {
  // Check if we're building for GitHub Pages
  if (process.env.GITHUB_PAGES === 'true') {
    const repo = process.env.GITHUB_REPOSITORY || '';
    if (repo && !repo.endsWith('.github.io')) {
      // Extract repo name from "username/repo-name"
      const repoName = repo.split('/')[1] || 'TiddeliHome';
      return `/${repoName}/`;
    }
  }
  // Default to root for localhost or custom domain
  return '/';
};

export default defineConfig({
  base: getBasePath(), // Add base path for GitHub Pages support
  plugins: [
    // Only use mkcert in development (not in GitHub Actions)
    ...(process.env.NODE_ENV !== 'production' ? [mkcert()] : []),
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
    https: process.env.NODE_ENV !== 'production', // Only HTTPS in dev (mkcert not available in CI)
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

