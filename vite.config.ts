import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Só o three.js já tem ~600 kB minificado (~160 kB com gzip); o aviso padrão de 500 kB não ajuda aqui.
    chunkSizeWarningLimit: 900,
  },
});
