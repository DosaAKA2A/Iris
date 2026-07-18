import { defineConfig } from 'vite'

// Base relativo para que el build funcione servido bajo /site/ en GitHub Pages
// o en cualquier subruta. El dev server usa '/'.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
})
