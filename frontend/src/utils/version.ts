/**
 * Application version information
 * Single source of truth: package.json
 * 
 * IMPORTANT: In dev mode, changing package.json version will cause Vite's HMR to reload
 * the module, updating APP_VERSION immediately. The service worker update mechanism
 * (update indicator, user confirmation) only works in production/preview builds.
 * 
 * To test the update mechanism:
 * 1. Build: npm run build
 * 2. Preview: npm run preview
 * 3. Change version in package.json and rebuild to see update indicator
 */

import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;
export const APP_NAME = packageJson.name;

