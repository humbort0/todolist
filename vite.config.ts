import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'
import { cpSync, existsSync } from 'fs'

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    }),
    {
      name: 'copy-public-to-dist',
      closeBundle() {
        if (existsSync('public')) {
          cpSync('public', 'dist', { recursive: true, force: true })
          console.log('✅ Copied public/ → dist/')
        }
      }
    }
  ]
})
