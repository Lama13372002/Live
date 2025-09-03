import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      server: {
        host: '0.0.0.0',
        https: false, // Change to true if you need HTTPS for camera access
        port: 5173
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              'three': ['three']
            }
          }
        }
      },
      optimizeDeps: {
        include: ['three']
      }
    };
});
