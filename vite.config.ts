import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // En GitHub Pages se construye con DEPLOY_BASE=/moneycontrol/ (definido en el workflow)
  base: process.env.DEPLOY_BASE || '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
})
