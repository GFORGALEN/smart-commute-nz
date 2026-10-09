import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    root: 'apps/web',
    envDir: process.cwd(),
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: Object.fromEntries(
        ['core', 'react', 'providers', 'i18n'].map((name) => [
          `@smart-commute/${name}`,
          resolve(`packages/${name}/src/index.ts`),
        ]),
      ),
    },
    build: { outDir: '../../dist', emptyOutDir: true, sourcemap: true },
  };
});
