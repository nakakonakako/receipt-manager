import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      port: 5274,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8100',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }),
)
