import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  publicDir: '../artifacts',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
