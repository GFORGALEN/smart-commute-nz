import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const packages = Object.entries(lock.packages)
  .filter(([name, entry]) => name.startsWith('node_modules/') && !entry.dev && !entry.link)
  .map(([name, entry]) => ({
    name: name.replace(/^node_modules\//, ''),
    version: entry.version,
    license: entry.license || 'Inspect package LICENSE',
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const table = packages
  .map((entry) => `| ${entry.name} | ${entry.version} | ${entry.license} |`)
  .join('\n');
const content = `# Third-party notices\n\nRuntime dependencies recorded from package-lock.json on 2026-10-09.\n\n| Package | Version | License |\n| --- | --- | --- |\n${table}\n\nMIT, ISC, BSD and Apache-2.0 are compatible with distribution of this MIT application when their respective notice obligations are retained.\nThe installed dependencies include their original LICENSE files. Build tooling and test libraries remain development dependencies and are not claimed as original project code.\n\nThe Google Maps JavaScript loader is open-source; Google Maps/Places/Routes service content is governed separately by Google Maps Platform terms.\nAT fare facts are referenced from official pages; no GTFS or GIS dataset is redistributed.\n\nRegenerate this inventory after dependency changes with \`node scripts/license-notices.mjs\`.\n`;
await writeFile('docs/THIRD_PARTY_NOTICES.md', content);
const licenseTexts = [];
for (const entry of packages) {
  const directory = join('node_modules', entry.name);
  const file = (await readdir(directory)).find((name) => /^licen[cs]e(?:\..*)?$/i.test(name));
  if (file)
    licenseTexts.push(
      `${entry.name}@${entry.version}\n${await readFile(join(directory, file), 'utf8')}`,
    );
}
await writeFile(
  'docs/THIRD_PARTY_LICENSES.txt',
  licenseTexts.join('\n\n----------------------------------------\n\n'),
);
