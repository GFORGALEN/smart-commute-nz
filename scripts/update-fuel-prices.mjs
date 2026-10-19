/* global fetch, console */
// Refreshes packages/providers/src/data/nz-fuel-prices.json from MBIE's weekly fuel price
// monitoring (CC BY 4.0). A weekly GitHub workflow runs it; by hand:
//   node scripts/update-fuel-prices.mjs
import { readFile, writeFile } from 'node:fs/promises';

const PAGE =
  'https://www.mbie.govt.nz/building-and-energy/energy-and-natural-resources/energy-statistics-and-modelling/energy-statistics/weekly-fuel-price-monitoring';
const CSV =
  'https://www.mbie.govt.nz/assets/Data-Files/Energy/Weekly-fuel-price-monitoring/weekly-table.csv';
const OUTPUT = 'packages/providers/src/data/nz-fuel-prices.json';
const FUELS = { regular: 'Regular Petrol', premium: 'Premium Petrol 95R', diesel: 'Diesel' };

const response = await fetch(CSV, { headers: { 'User-Agent': 'smart-commute-nz fuel update' } });
if (!response.ok) throw new Error(`MBIE answered ${response.status} for ${CSV}.`);
const raw = await response.text();
// A UTF-8 byte order mark would otherwise stick to the first column name.
const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

// The file is a simple quoted CSV: Week, Date, Fuel, Variable, Value, Unit, Status.
const cells = (line) =>
  [...line.matchAll(/"([^"]*)"|([^,]+)|(?<=,)(?=,|$)/g)].map((m) => m[1] ?? m[2] ?? '');
const [header, ...lines] = text.trim().split(/\r?\n/);
const columns = cells(header);
const rows = lines.map((line) =>
  Object.fromEntries(cells(line).map((value, i) => [columns[i], value])),
);
const latest = rows.reduce((last, row) => (row.Date > last ? row.Date : last), '');
if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) throw new Error('No dated rows in the MBIE file.');

const price = (fuel, variable) => {
  const row = rows.find(
    (candidate) =>
      candidate.Date === latest && candidate.Fuel === fuel && candidate.Variable === variable,
  );
  if (!row || row.Unit !== 'NZD c/L') throw new Error(`Missing ${variable} for ${fuel}.`);
  const dollars = Number(row.Value) / 100;
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 10)
    throw new Error(`Implausible ${variable} for ${fuel}: ${row.Value} c/L.`);
  return { value: Math.round(dollars * 100) / 100, status: row.Status };
};

const prices = Object.fromEntries(
  Object.entries(FUELS).map(([key, fuel]) => {
    const retail = price(fuel, 'Adjusted retail price');
    return [key, { retail: retail.value, board: price(fuel, 'Board price').value }];
  }),
);
const status = price(FUELS.regular, 'Adjusted retail price').status;

const next = {
  source: 'MBIE weekly fuel price monitoring',
  url: PAGE,
  license: 'CC BY 4.0',
  weekEnding: latest,
  status,
  unit: 'NZD per litre',
  prices,
};
const previous = await readFile(OUTPUT, 'utf8').catch(() => '');
const body = `${JSON.stringify(next, null, 2)}\n`;
if (previous === body) console.log(`${OUTPUT}: unchanged (week ending ${latest}).`);
else {
  await writeFile(OUTPUT, body);
  console.log(`${OUTPUT}: week ending ${latest}, 91 $${prices.regular.retail}/L.`);
}
