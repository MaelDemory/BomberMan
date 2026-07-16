import { defineConfig } from 'vite';

// En dev, Vite proxifie /ws vers le serveur de jeu local ; en prod le serveur
// Node sert le client buildé sur la même origine (aucune URL codée en dur).
export default defineConfig({
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
