import { defineConfig, devices } from '@playwright/test';

const production = process.env.PLAYWRIGHT_PRODUCTION === '1';
const baseURL = `http://127.0.0.1:4173${production ? process.env.VITE_BASE_PATH || '/' : '/'}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: production ? 'npm run preview -- --port 4173' : 'npm run dev -- --port 4173',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
