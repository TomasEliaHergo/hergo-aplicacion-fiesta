import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, /api se redirige al backend Express.
// Se puede cambiar con VITE_API_PROXY (ej: VITE_API_PROXY=http://localhost:3000 npm run dev).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      // host: true permite probar el escáner desde el celular en la misma red
      // (la cámara requiere HTTPS fuera de localhost).
      host: true,
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/fotos': { target, changeOrigin: true }, // modo local: fotos servidas por Express
      },
    },
    preview: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/fotos': { target, changeOrigin: true }, // modo local: fotos servidas por Express
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
