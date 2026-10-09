import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: Object.fromEntries(
      ['core', 'react', 'providers', 'i18n'].map((name) => [
        `@smart-commute/${name}`,
        resolve(`packages/${name}/src/index.ts`),
      ]),
    ),
  },
  build: {
    minify: true,
    outDir: 'dist-widget',
    emptyOutDir: true,
    lib: {
      entry: resolve('apps/web/src/widget.tsx'),
      formats: ['es'],
      fileName: 'smart-commute-widget',
      cssFileName: 'smart-commute-widget',
    },
  },
});
