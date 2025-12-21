import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    mkcert(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    https: true, // Enable HTTPS
  },
  build: {
    outDir: 'dist',
  },
});

