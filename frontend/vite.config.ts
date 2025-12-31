import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';

// Fix __dirname in ESM
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env files
// Vite's loadEnv needs the mode: 'development' for dev server, 'production' for build
// We determine mode from NODE_ENV, defaulting to 'development' for dev server
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const env = loadEnv(mode, resolve(__dirname), '');

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

// --- Utility: Inject version into service worker (works in dev and production) ---
function injectServiceWorkerVersion(targetPath: string, isSource: boolean = false) {
  try {
    if (!existsSync(targetPath)) {
      if (isSource) {
        // In dev mode, source file should exist
        console.warn(`Service worker source file not found: ${targetPath}`);
      }
      return;
    }

    let swContent = readFileSync(targetPath, 'utf-8');
    const newVersion = packageJson.version;

    swContent = swContent.replace(
      /const VERSION = ['"][^'"]*['"];/,
      `const VERSION = '${newVersion}';`
    );

    writeFileSync(targetPath, swContent);
    console.log(`✅ Service worker version injected: ${newVersion} (${isSource ? 'source' : 'build'})`);
  } catch (err) {
    console.error('Failed to inject service worker version:', err);
  }
}

// --- Compute base path (platform-agnostic) ---
// Priority: VITE_BASE_PATH (explicit) > GitHub Pages detection > default (/)
function getBasePath() {
  // 1. Explicit base path (highest priority - works for any platform: Netlify, Vercel, etc.)
  const explicitBasePath = process.env.VITE_BASE_PATH;
  if (explicitBasePath && explicitBasePath.trim()) {
    // Ensure it starts and ends with /
    const basePath = explicitBasePath.trim();
    if (basePath === '/') return '/';
    return basePath.startsWith('/') && basePath.endsWith('/') 
      ? basePath 
      : `/${basePath.replace(/^\/|\/$/g, '')}/`;
  }
  
  // 2. GitHub Pages detection (backward compatibility)
  if (process.env.GITHUB_PAGES === 'true') {
    const repo = process.env.GITHUB_REPOSITORY || '';
    if (repo && !repo.endsWith('.github.io')) {
      const repoName = repo.split('/')[1];
      return `/${repoName}/`;
    }
  }
  
  // 3. Default (root - works for dev, Netlify root, Vercel root, etc.)
  return '/';
}


export default defineConfig({
  base: getBasePath(),

  plugins: [
    // Use mkcert for dev and preview (local HTTPS, not in CI)
    ...(!isCI ? [mkcert()] : []),
    tailwindcss(),

    // Inject version into service worker (works in dev and production)
    {
      name: 'inject-version',
      // Update source file in dev mode for immediate feedback
      buildStart() {
        if (!isCI) {
          const swSourcePath = resolve(__dirname, 'public/service-worker.js');
          injectServiceWorkerVersion(swSourcePath, true);
        }
      },
      // Inject version into built service worker after build completes (production)
      closeBundle() {
        const swBuildPath = resolve(__dirname, 'dist/service-worker.js');
        // Use setTimeout to ensure dist files are written
        setTimeout(() => {
          injectServiceWorkerVersion(swBuildPath, false);
        }, 100);
      }
    },

    // Fix manifest.json content-type (dev and preview)
    {
      name: 'manifest-content-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const basePath = getBasePath();
          const manifestPath = basePath === '/' ? '/manifest.json' : `${basePath}manifest.json`;
          if (req.url === manifestPath || req.url === '/manifest.json') {
            res.setHeader('Content-Type', 'application/manifest+json');
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const basePath = getBasePath();
          const manifestPath = basePath === '/' ? '/manifest.json' : `${basePath}manifest.json`;
          if (req.url === manifestPath || req.url === '/manifest.json') {
            res.setHeader('Content-Type', 'application/manifest+json');
          }
          next();
        });
      }
    }
  ],

  server: (() => {
    const isDev = process.env.NODE_ENV !== 'production' && !isCI;
    // HMR can be disabled via environment variable (useful for testing update mechanism)
    // Default: enabled (true) - set VITE_DISABLE_HMR=true in .env file to disable
    // Check both process.env (command line) and env (from .env file)
    const disableHMR = (process.env.VITE_DISABLE_HMR === 'true' || env.VITE_DISABLE_HMR === 'true');
    
    return {
      port: 3000,
      host: '0.0.0.0',
      // mkcert plugin automatically enables HTTPS, so we don't need to set https here
      hmr: disableHMR ? false : {
        host: localIP,
        // Use secure WebSocket when HTTPS is enabled (mkcert handles HTTPS)
        protocol: isDev ? 'wss' : 'ws',
        clientPort: 3000
      }
    };
  })(),

  build: {
    outDir: 'dist'
  },

  preview: {
    port: 4173,
    host: '0.0.0.0',
    // mkcert plugin automatically enables HTTPS for preview (same as dev)
    // Vite preview automatically detects the base path from the built index.html
    // No need to set it explicitly - it will read from the built files
  },

  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  }
});
