import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from 'tailwindcss3'
import autoprefixer from 'autoprefixer'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3' })],
  css: { postcss: { plugins: [tailwindcss({ config: './tailwind.config.js' }), autoprefixer()] } },
  // Frappe UI's Vue sources import dependencies with CommonJS internals.
  // Prebundle them so development exposes the same exports as production.
  optimizeDeps: {
    include: ['feather-icons', 'lowlight', 'highlight.js/lib/core', 'interactjs', 'socket.io-client'],
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
