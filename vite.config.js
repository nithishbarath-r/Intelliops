import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths: works on GitHub Pages (/repo/), the BTP approuter and localhost.
  base: './',
  plugins: [react()],
  server: {
    // VITE_SAP_MODE=live in dev: forward OData calls to the CAP service (cd btp && npm run dev)
    proxy: {
      '/odata': 'http://localhost:4004',
    },
  },
})
