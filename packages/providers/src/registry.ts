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
      'legs.steps.transitDetails.stopCount',
      'legs.steps.transitDetails.transitLine',
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
      'Limited Auckland live checks on 2026-10-09 verified maps, driving, address search and geocoding; wider coverage remains unverified.',
      'A complete Google NZD fare is preferred; the planner estimates an adult AT range for recognized AT bus/train services when fare data is incomplete. Other operators require manual pricing.',
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
      'Specific fare estimates require verified zones/overlap rules and eligibility. Automatic ranges are an adult tariff envelope, not stop-count or zone predictions.',
      'Ranges exclude concession, subsidy and fare-cap history; unknown transfer eligibility widens the upper end.',
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
    updateFrequency: 'Not verified; inspected public feed dates 2026-09-30 to 2027-01-24',
    license: 'Public GTFS download: CC BY 4.0; authenticated API product terms require review',
    authentication:
      'API: free portal registration, product subscription and subscription key; public ZIP: none',
    commercialUse: 'unverified',
    redistribution: 'unverified',
    limitations: [
      'No authenticated feed was queried.',
      'Public ZIP inspection found empty fare tables and no populated stop zone_id values; it does not provide automatic fare quotes.',
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
  {
    id: 'open-meteo',
    name: 'Open-Meteo Forecast API',
    url: 'https://open-meteo.com/en/docs',
    service: 'GET /v1/forecast (free, no key)',
    fields: [
      'temperature_2m',
      'weather_code',
      'is_day',
      'wind_speed_10m',
      'precipitation_probability',
      'snowfall',
    ],
    status: 'integrated',
    verifiedOn: '2026-10-11',
    sourceUpdatedOn: null,
    updateFrequency: 'Model runs several times a day; current values use 15-minute model data',
    license: 'CC BY 4.0 (attribution required)',
    authentication: 'None for the free non-commercial endpoint',
    commercialUse: 'subject-to-terms',
    redistribution: 'restricted',
    limitations: [
      'Free tier is for non-commercial use, under 10,000 calls a day.',
      'Rain chance applies to the hour ending at each forecast time.',
      'Weather is a commute reference and does not change costs or rankings.',
    ],
  },
  {
    id: 'ird-kilometre-rates',
    name: 'Inland Revenue kilometre rates (2025-26)',
    url: 'https://www.ird.govt.nz/updates/news-folder/2026/kilometre-rates-for-the-2025-2026-income-year',
    service: 'Published annual rates; no API',
    fields: ['maintenancePerKm'],
    status: 'manual',
    verifiedOn: '2026-10-13',
    sourceUpdatedOn: '2026-06-03',
    updateFrequency: 'Annual, per income year',
    license: 'New Zealand Government published rate; referenced, not redistributed',
    authentication: 'None',
    commercialUse: 'yes',
    redistribution: 'yes',
    limitations: [
      'Tier 2 running costs: petrol NZ$0.37/km, diesel 0.38, petrol hybrid 0.24, electric 0.23.',
      'Each less its example energy cost and any RUC leaves about NZ$0.08/km of upkeep.',
      'IRD does not itemise the rates, so whether they include RUC is assumed, not stated.',
      'A derived estimate for comparison, not a tax rate; users can change or zero it.',
    ],
  },
  {
    id: 'nzta-ruc',
    name: 'NZTA road user charges rates',
    url: 'https://www.nzta.govt.nz/vehicles/road-user-charges/ruc-rates-and-transaction-fees/',
    service: 'Published rate table; no API',
    fields: ['rucPer1000Km'],
    status: 'manual',
    verifiedOn: '2026-10-13',
    sourceUpdatedOn: null,
    updateFrequency: 'When regulations change',
    license: 'New Zealand Government published rate; referenced, not redistributed',
    authentication: 'None',
    commercialUse: 'yes',
    redistribution: 'yes',
    limitations: [
      'Light vehicles up to 3,500 kg (type 1, diesel and electric) NZ$76 per 1,000 km.',
      'Plug-in petrol hybrids (type 12) NZ$38 per 1,000 km; GST inclusive.',
      'The NZ$12.44 online administration fee per licence is not included.',
    ],
  },
  {
    id: 'nzta-licensing',
    name: 'NZTA vehicle licensing (rego) fees',
    url: 'https://nzta.govt.nz/vehicles/licensing-rego/vehicle-fees/licensing-fees',
    service: 'Published fee table; no API',
    fields: ['licencePerYear'],
    status: 'manual',
    verifiedOn: '2026-10-13',
    sourceUpdatedOn: null,
    updateFrequency: 'When fees or ACC levies change',
    license: 'New Zealand Government published fee; referenced, not redistributed',
    authentication: 'None',
    commercialUse: 'yes',
    redistribution: 'yes',
    limitations: [
      '12-month private passenger licence from 1 July 2026, online, GST inclusive.',
      'Petrol and petrol hybrids NZ$181.45; diesel and electric NZ$248.83.',
      'A plate-specific fee can differ; Rightcar gives the exact amount.',
    ],
  },
  {
    id: 'mbie-energy-prices',
    name: 'MBIE weekly fuel prices and domestic electricity survey',
    url: 'https://www.mbie.govt.nz/building-and-energy/energy-and-natural-resources/energy-statistics-and-modelling/energy-statistics/weekly-fuel-price-monitoring',
    service: 'Weekly CSV and quarterly survey; referenced manually',
    fields: ['fuelPrice', 'electricityPrice'],
    status: 'manual',
    verifiedOn: '2026-10-13',
    sourceUpdatedOn: '2026-10-07',
    updateFrequency: 'Fuel weekly; electricity quarterly',
    license: 'Creative Commons Attribution 4.0 New Zealand',
    authentication: 'None',
    commercialUse: 'yes',
    redistribution: 'yes',
    limitations: [
      'Board prices, week ending 2 Oct 2026: regular petrol NZ$3.47/L, diesel NZ$3.20/L.',
      'Electricity: Auckland Central retail NZ$0.413/kWh on 15 Aug 2026, low-user tariff.',
      'Defaults are not today’s pump or plan price; users enter their own.',
    ],
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
