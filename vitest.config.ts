import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: Object.fromEntries(
      ['core', 'react', 'providers', 'i18n'].map((name) => [
        `@smart-commute/${name}`,
        resolve(`packages/${name}/src/index.ts`),
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'],
    clearMocks: true,
  },
});
