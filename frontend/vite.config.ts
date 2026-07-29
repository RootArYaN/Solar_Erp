import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const exposeDevelopmentServer = env.VITE_DEV_EXPOSE === 'true'
  const allowedHosts = csv(env.VITE_ALLOWED_HOSTS)
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      host: exposeDevelopmentServer ? '0.0.0.0' : '127.0.0.1',
      port: 5173,
      strictPort: true,
      allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    build: {
      sourcemap: false,
      target: 'es2020',
    },
  }
})
