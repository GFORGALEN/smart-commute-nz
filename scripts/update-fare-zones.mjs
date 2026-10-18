/* global fetch, URLSearchParams, console */
// Refreshes packages/providers/src/data/at-fare-zones.json from Auckland Transport's published
// Fare Zones layer (CC BY 4.0). AT loads zone changes by hand, so run this after a fare review:
//   node scripts/update-fare-zones.mjs
import { writeFile } from 'node:fs/promises';

const ITEM = 'https://data-atgis.opendata.arcgis.com/datasets/3549d3cc98e7480abb77f436e05a7799';
const LAYER =
  'https://services2.arcgis.com/JkPEgZJGxhSjYOo0/arcgis/rest/services/FareZones/FeatureServer/1';
const OUTPUT = 'packages/providers/src/data/at-fare-zones.json';

const layer = await (await fetch(`${LAYER}?f=json`)).json();
// About 2 m of simplification keeps every overlap area, including the smallest, at half the size.
const query = new URLSearchParams({
  where: '1=1',
  outFields: 'Name',
  outSR: '4326',
  geometryPrecision: '6',
  maxAllowableOffset: '0.00002',
  f: 'geojson',
});
const collection = await (await fetch(`${LAYER}/query?${query}`)).json();
if (!collection.features?.length) throw new Error('The Fare Zones layer returned no features.');

const round = (value) => Math.round(value * 1e5) / 1e5;
const areas = collection.features.map((feature) => {
  const { type, coordinates } = feature.geometry ?? {};
  if (type !== 'Polygon' && type !== 'MultiPolygon')
    throw new Error(`Unexpected geometry for ${feature.properties.Name}.`);
  const polygons = (type === 'Polygon' ? [coordinates] : coordinates).map((polygon) =>
    polygon.map((ring) => ring.map(([lng, lat]) => [round(lng), round(lat)])),
  );
  const points = polygons.flat(2);
  return {
    // An overlap area is named after both zones, for example "City, Isthmus".
    zones: feature.properties.Name.split(',').map((zone) => zone.trim()),
    bbox: [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
    ],
    polygons,
  };
});

const data = {
  source: 'Auckland Transport, Fare Zones',
  url: ITEM,
  license: 'CC BY 4.0',
  retrievedOn: new Date().toISOString().slice(0, 10),
  sourceEditedOn: new Date(layer.editingInfo?.lastEditDate ?? Date.now())
    .toISOString()
    .slice(0, 10),
  areas,
};
await writeFile(OUTPUT, `${JSON.stringify(data)}\n`);
console.log(
  `${OUTPUT}: ${areas.length} areas, ${areas.flatMap((a) => a.polygons.flat(2)).length} points`,
);
