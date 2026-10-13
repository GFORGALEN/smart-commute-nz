import { readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = join(directory, entry.name);
      return entry.isDirectory() ? walk(relative) : [relative];
    }),
  );
  return files.flat();
}

const files = (await walk('dist')).filter(
  (file) => /\.(html|js|css|svg|png|webmanifest)$/.test(file) && !file.endsWith('sw.js'),
);
const precache = files.map((file) => `./${file.replaceAll('\\', '/').replace(/^dist\//, '')}`);
const digest = createHash('sha256');
for (const file of files) digest.update(await readFile(file));
const version = digest.digest('hex').slice(0, 12);
let serviceWorker = await readFile('apps/web/public/sw.js', 'utf8');
serviceWorker = serviceWorker.replace(
  "'smart-commute-shell-v1'",
  `'smart-commute-shell-${version}'`,
);
serviceWorker = serviceWorker.replace("['./', './favicon.svg']", JSON.stringify(precache));
await writeFile('dist/sw.js', serviceWorker);
await cp('dist-widget', 'dist/widget', { recursive: true });
await cp('docs/THIRD_PARTY_LICENSES.txt', 'dist/THIRD_PARTY_LICENSES.txt');
await cp('docs/THIRD_PARTY_LICENSES.txt', 'dist/widget/THIRD_PARTY_LICENSES.txt');
await cp('LICENSE', 'dist/LICENSE');
await cp('LICENSE', 'dist/widget/LICENSE');
