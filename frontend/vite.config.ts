import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';

// Fix __dirname in ESM
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Detect CI (GitHub Actions)
const isCI = process.env.CI === 'true';

// Load package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

// --- Utility: Get local IP for HMR (dev only) ---
function getLocalIP() {
  if (isCI) return 'localhost';
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

// --- Utility: Update service worker version (dev only) ---
function updateServiceWorkerVersion() {
  if (isCI) return; // Never run in CI

  try {
    const swPath = resolve(__dirname, 'public/service-worker.js');
    let swContent = readFileSync(swPath, 'utf-8');
    const newVersion = packageJson.version;

    swContent = swContent.replace(
      /const VERSION = ['"][^'"]*['"];/,
      `const VERSION = '${newVersion}';`
    );

    writeFileSync(swPath, swContent);
    console.log(`Service worker version updated to ${newVersion}`);
  } catch (err) {
    console.error('Failed to update service worker version:', err);
  }
}

// --- Compute base path for GitHub Pages ---
function getBasePath() {
  if (process.env.GITHUB_PAGES === 'true') {
    const repo = process.env.GITHUB_REPOSITORY || '';
    if (repo && !repo.endsWith('.github.io')) {
      const repoName = repo.split('/')[1];
      return `/${repoName}/`;
    }
  }
  return '/';
}

export default defineConfig({
  base: getBasePath(),

  plugins: [
    // Only use mkcert in development (not in CI/production)
    ...(process.env.NODE_ENV !== 'production' && !isCI ? [mkcert()] : []),
    tailwindcss(),

    // Inject version into service worker (safe in CI)
    {
      name: 'inject-version',
      buildStart() {
        updateServiceWorkerVersion();
      }
    },

    // Fix manifest.json content-type
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
    // Enable HTTPS in development (using mkcert), disable in CI/production
    https: process.env.NODE_ENV !== 'production' && !isCI,
    hmr: {
      host: localIP,
      // Use secure WebSocket when HTTPS is enabled
      protocol: process.env.NODE_ENV !== 'production' && !isCI ? 'wss' : 'ws',
      clientPort: 3000
    }
  },

  build: {
    outDir: 'dist'
  },

  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  }
});
