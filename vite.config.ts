import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from 'tailwindcss3'
import autoprefixer from 'autoprefixer'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3' })],
  css: { postcss: { plugins: [tailwindcss({ config: './tailwind.config.js' }), autoprefixer()] } },
  // Frappe UI imports this CommonJS package from Vue source. Prebundle it
  // explicitly so Vite development mode exposes the same default as production.
  optimizeDeps: { include: ['feather-icons'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
