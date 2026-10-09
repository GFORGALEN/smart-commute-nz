import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { chromium } from '@playwright/test';

const screenshotUrl = process.env.SCREENSHOT_URL || 'http://127.0.0.1:4173/';
const outputDirectory = resolve('docs/screenshots');
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const diagnostics = [];
const pageErrors = [];

async function capture(name, contextOptions) {
  // Each device gets its own fresh browser storage and service-worker lifecycle.
  const context = await browser.newContext({
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
    ...contextOptions,
  });
  try {
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error')
        diagnostics.push({ device: name, type: 'console', text: message.text() });
    });
    page.on('pageerror', (error) => {
      const entry = { device: name, type: 'pageerror', text: error.stack || error.message };
      diagnostics.push(entry);
      pageErrors.push(entry);
    });
    await page.goto(screenshotUrl, { waitUntil: 'networkidle' });
    await page.getByTestId('route-card-drive').waitFor({ state: 'visible' });
    await page.getByTestId('route-card-hybrid').waitFor({ state: 'visible' });
    await page.getByTestId('route-card-transit').waitFor({ state: 'visible' });
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready;
    });
    const path = resolve(outputDirectory, `${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    console.log(`Saved ${path}`);
  } finally {
    await context.close();
  }
}

try {
  await capture('desktop', { viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
  await capture('mobile', {
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  if (pageErrors.length)
    throw new Error(`Screenshot capture found ${pageErrors.length} uncaught page error(s).`);
} finally {
  if (diagnostics.length) console.error(JSON.stringify(diagnostics, null, 2));
  await browser.close();
}
