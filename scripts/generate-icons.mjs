// Renders the app icons from favicon.svg's artwork. Run after changing the icon:
//   node scripts/generate-icons.mjs
import { chromium } from '@playwright/test';

const GREEN = '#23784f';
// The favicon's glyph on a 64-unit canvas, without its rounded background.
const GLYPH =
  '<path d="M20 47V25a12 12 0 0 1 24 0v22M20 32h24M25 20h14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="26" cy="40" r="3" fill="#d8e2d6"/><circle cx="38" cy="40" r="3" fill="#d8e2d6"/>';

/** Rounded icon with transparent corners, as in favicon.svg. */
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${GREEN}"/>${GLYPH}</svg>`;
/**
 * Full-bleed square for platforms that apply their own mask. The glyph is shrunk to 70%
 * so it stays inside the maskable safe zone (the central 80% circle).
 */
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${GREEN}"/><g transform="translate(9.6 9.6) scale(0.7)">${GLYPH}</g></svg>`;

const icons = [
  { file: 'icon-192.png', size: 192, svg: rounded },
  { file: 'icon-512.png', size: 512, svg: rounded },
  { file: 'icon-maskable-512.png', size: 512, svg: fullBleed },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed },
];

const browser = await chromium.launch();
try {
  for (const { file, size, svg } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: `apps/web/public/${file}`, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
