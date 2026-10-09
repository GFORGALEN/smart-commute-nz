export interface DataSource {
  id: string;
  name: string;
  url: string;
  service: string;
  fields: string[];
  status: 'integrated' | 'manual' | 'catalog-only' | 'not-integrated';
  verifiedOn: string;
  sourceUpdatedOn: string | null;
  updateFrequency: string;
  license: string;
  authentication: string;
  commercialUse: 'subject-to-terms' | 'unverified' | 'yes';
  redistribution: 'restricted' | 'unverified' | 'yes';
  limitations: string[];
}

export const DATA_SOURCES: readonly DataSource[] = [
  {
    id: 'manual',
    name: 'User inputs and labelled offline example',
    url: '',
    service: 'Local deterministic cost engine',
    fields: ['distanceKm', 'durationMinutes', 'fare', 'parkingCost', 'toll', 'fuelConsumption'],
    status: 'manual',
    verifiedOn: '2026-10-09',
    sourceUpdatedOn: null,
    updateFrequency: 'User controlled',
    license: 'User supplied values; example is project MIT content',
    authentication: 'None',
    commercialUse: 'yes',
    redistribution: 'yes',
    limitations: [
      'Inputs are estimates, not live measurements.',
      'Zero initial parking price is an unverified assumption.',
    ],
  },
  {
    id: 'google',
    name: 'Google Maps JavaScript Routes library / Places (New)',
    url: 'https://developers.google.com/maps/documentation/javascript/routes/overview',
    service: 'Route.computeRoutes; PlaceAutocompleteElement; Geocoder',
    fields: [
      'distanceMeters',
      'durationMillis',
      'legs',
      'path',
      'warnings',
      'travelAdvisory.transitFare',
    ],
    status: 'integrated',
    verifiedOn: '2026-10-09',
    sourceUpdatedOn: '2026-10-07',
    updateFrequency: 'Request time; provider controlled',
    license: 'Google Maps Platform Terms of Service',
    authentication: 'Restricted browser API key; owner must configure billing/APIs',
    commercialUse: 'subject-to-terms',
    redistribution: 'restricted',
    limitations: [
      'No production key was used to validate live coverage.',
      'Fare may be absent; missing fare requires manual input.',
      'Only transient session memory; no localStorage/API response caching.',
      'Draw Google routes on a Google map and preserve attribution.',
    ],
  },
  {
    id: 'at-fares',
    name: 'Auckland Transport 2026 bus/train fare rules',
    url: 'https://at.govt.nz/bus-train-ferry/fares-and-discounts/public-transport-fare-changes',
    service: 'Maintained static table; no fare API called',
    fields: ['zones', 'paymentMethod', 'passengerType', 'transferWindow', 'fareCap'],
    status: 'integrated',
    verifiedOn: '2026-10-09',
    sourceUpdatedOn: '2026-08-13',
    updateFrequency: 'Annual fare review; typically February; manual refresh required',
    license: 'Published factual fare amounts; AT website terms apply to source content',
    authentication: 'None for public fare documentation',
    commercialUse: 'subject-to-terms',
    redistribution: 'unverified',
    limitations: [
      'Effective 1 February 2026; snapshot requires refresh for February 2027.',
      'User must verify zones/overlap rules and eligibility.',
      'No automatic fare-zone polygon intersection.',
      'Ferries, group travel and monthly ferry pass interactions not implemented.',
    ],
  },
  {
    id: 'at-gtfs',
    name: 'Auckland Transport GTFS Static API',
    url: 'https://dev-portal.at.govt.nz/GTFS-API',
    service: 'Official developer portal describes REST over active GTFS static data',
    fields: ['routes', 'trips', 'stops'],
    status: 'not-integrated',
    verifiedOn: '2026-10-09',
    sourceUpdatedOn: null,
    updateFrequency: 'Not verified for a selected feed',
    license: 'Not verified; inspect AT API product terms before integrating or redistributing',
    authentication: 'Developer portal subscription/access requirements must be checked',
    commercialUse: 'unverified',
    redistribution: 'unverified',
    limitations: [
      'No authenticated feed was queried.',
      'Static GTFS is scheduling data; not automatically a route optimizer, realtime fare or parking tariff service.',
    ],
  },
  {
    id: 'at-gis',
    name: 'Auckland Transport Open GIS Data',
    url: 'https://data-atgis.opendata.arcgis.com/',
    service: 'ArcGIS data catalog; no dataset selected',
    fields: [],
    status: 'catalog-only',
    verifiedOn: '2026-10-09',
    sourceUpdatedOn: null,
    updateFrequency: 'Per selected item; not verified',
    license: 'Per selected item; not verified',
    authentication: 'Per selected item; not verified',
    commercialUse: 'unverified',
    redistribution: 'unverified',
    limitations: [
      'Catalog metadata/search is not navigation routing.',
      'No verified parking tariffs, legality or availability dataset integrated.',
    ],
  },
  {
    id: 'council-gis',
    name: 'Auckland Council Open Data',
    url: 'https://data-aucklandcouncil.opendata.arcgis.com/',
    service: 'ArcGIS data catalog; no dataset selected',
    fields: [],
    status: 'catalog-only',
    verifiedOn: '2026-10-09',
    sourceUpdatedOn: null,
    updateFrequency: 'Per selected item; not verified',
    license: 'Per selected item; not verified',
    authentication: 'Per selected item; not verified',
    commercialUse: 'unverified',
    redistribution: 'unverified',
    limitations: ['No parking-price dataset was selected or represented as integrated.'],
  },
];

export function sourceAgeDays(source: DataSource, now = new Date()): number {
  const age = (now.getTime() - new Date(`${source.verifiedOn}T00:00:00Z`).getTime()) / 86400000;
  return Math.max(0, Math.floor(age));
}

export function sourceNeedsReview(
  source: DataSource,
  now = new Date(),
  maximumAgeDays = 90,
): boolean {
  return sourceAgeDays(source, now) > maximumAgeDays;
}
