import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { PlaceHours } from './opening-hours';
import type { JourneyOption, Location, TransitFareRange, TravelLeg } from '@smart-commute/core';
import type { ProviderMetrics, RouteProvider, RouteRequest, RouteResult } from './types';
import { RouteProviderError } from './types';
import { AT_FARE_RULES } from './fares';
import { countJourneyZones, loadATFareZones, type FareZoneMap } from './fare-zones';

type LibraryName = 'maps' | 'core' | 'routes' | 'places' | 'geocoding';
export type GoogleLibraryLoader = (name: LibraryName) => Promise<unknown>;

/** Projections of the official SDK response, also usable as deterministic fixtures. */
export interface GoogleRouteStep {
  distanceMeters?: number;
  staticDurationMillis?: number;
  travelMode?: string;
  /** The step's line on the map; for a bus or train, where it runs from boarding to alighting. */
  path?: { lat: number; lng: number }[];
  transitDetails?: {
    departureTime?: Date;
    arrivalTime?: Date;
    departureStop?: { name?: string };
    arrivalStop?: { name?: string };
    stopCount?: number;
    transitLine?: {
      name?: string;
      /** Official Maps JavaScript Route SDK property (REST uses nameShort). */
      shortName?: string;
      vehicle?: { vehicleType?: string };
      agencies?: { name?: string; url?: URL | string }[];
    };
  };
}
export interface GoogleRouteData {
  description?: string;
  distanceMeters?: number;
  durationMillis?: number;
  /** Free-flow duration without live traffic; driving only. */
  staticDurationMillis?: number;
  legs?: { steps?: GoogleRouteStep[] }[];
  warnings?: string[];
  travelAdvisory?: { transitFare?: { currencyCode?: string; units?: number; nanos?: number } };
  viewport?: google.maps.LatLngBounds;
  createPolylines?: (options?: google.maps.routes.RoutePolylineOptions) => google.maps.Polyline[];
}
export interface GoogleComputeRequest extends google.maps.routes.ComputeRoutesRequest {
  origin: string | google.maps.LatLngLiteral;
  destination: string | google.maps.LatLngLiteral;
  intermediates?: { location: string | google.maps.LatLngLiteral }[];
  travelMode: 'DRIVING' | 'TRANSIT';
  fields: string[];
  computeAlternativeRoutes: boolean;
  departureTime?: Date;
  routingPreference?: 'TRAFFIC_UNAWARE' | 'TRAFFIC_AWARE';
  transitPreference?: { allowedTransitModes: ('BUS' | 'RAIL')[] };
  language: string;
  region: string;
}
interface GoogleRoutesLibrary {
  Route: {
    computeRoutes(
      request: GoogleComputeRequest,
    ): Promise<{ routes?: GoogleRouteData[]; fallbackInfo?: unknown }>;
  };
}

export interface GoogleRouteProviderOptions {
  apiKey?: string;
  /** Advanced traffic routing uses the Pro SKU. Default false. */
  trafficAware?: boolean;
  /** Opt in to a clearly labelled standard-adult AT range when Google omits a fare. */
  estimateMissingTransitFare?: boolean;
  /**
   * Whether to ask Google for a transit fare at all. Default true. With false, AT services are
   * always priced from the AT tariff (with estimateMissingTransitFare) and no fare is requested.
   */
  useGoogleTransitFare?: boolean;
  /** Injectable SDK loader for deterministic tests without paid requests. */
  loadLibrary?: GoogleLibraryLoader;
  maxRouteRequests?: number;
}

export interface GoogleAutocompleteOptions {
  initialValue?: string;
  onInput?: (value: string) => void;
  label?: string;
  /** True while a chosen suggestion is being resolved to coordinates, false once settled. */
  onResolving?: (resolving: boolean) => void;
}

/** How every alternative route is drawn; the selected one is emphasised and drawn on top. */
export interface RouteRenderOptions {
  /** Short text per route id, shown as a chip on the map (for example "26 min · $7.76"). */
  labels?: Record<string, string>;
  /** Called when a person clicks an alternative route or its chip. */
  onSelect?: (id: string) => void;
  /** Text beside the start and end marks, for example "Start · 4 Fong Road". */
  endpoints?: { start: string; end: string };
  /** Space kept clear around the routes when they are first framed, for overlaid controls. */
  padding?: google.maps.Padding;
}

export interface MapDisplayOptions {
  /** Phones overlay their own controls on the map, so the fullscreen button is left off. */
  fullscreenControl?: boolean;
}

/** Callable cleanup retains compatibility with integrations that only dispose it. */
export type GoogleAutocompleteControl = (() => void) & { setValue(value: string): void };

/** One address suggestion for a planner that draws its own list. */
export interface PlaceSuggestion {
  id: string;
  main: string;
  secondary: string;
  text: string;
}
/**
 * Address search without Google's widget, which takes over the whole screen on phones. One
 * session token covers the typing and the chosen place's details, as the widget does.
 */
export interface GooglePlaceSearch {
  suggest(input: string): Promise<PlaceSuggestion[]>;
  select(suggestion: PlaceSuggestion): Promise<Location>;
}

let configuredKey: string | undefined;
type MapsAuthenticationWindow = Window & { gm_authFailure?: () => void };
const authenticationListeners = new Set<() => void>();
let previousAuthenticationCallback: (() => void) | undefined;
let authenticationCallback: (() => void) | undefined;

/** Google exposes authentication failures through a page-level callback. */
function watchAuthenticationFailure(listener: () => void): () => void {
  const page = window as MapsAuthenticationWindow;
  if (authenticationListeners.size === 0) {
    previousAuthenticationCallback = page.gm_authFailure;
    const previous = previousAuthenticationCallback;
    authenticationCallback = () => {
      for (const notify of [...authenticationListeners]) notify();
      previous?.();
    };
    page.gm_authFailure = authenticationCallback;
  }
  authenticationListeners.add(listener);
  return () => {
    authenticationListeners.delete(listener);
    if (authenticationListeners.size === 0) {
      if (page.gm_authFailure === authenticationCallback)
        page.gm_authFailure = previousAuthenticationCallback;
      authenticationCallback = undefined;
      previousAuthenticationCallback = undefined;
    }
  };
}

function nonnegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function locationValue(location: Location): string | google.maps.LatLngLiteral {
  if (location.coordinates) {
    const { lat, lng } = location.coordinates;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new RouteProviderError(
        'INVALID_INPUT',
        'Coordinates must have latitude −90 to 90 and longitude −180 to 180.',
      );
    }
    return { lat, lng };
  }
  if (!location.label.trim())
    throw new RouteProviderError('INVALID_INPUT', 'Enter both origin and destination.');
  return location.label.trim();
}

function readableError(error: unknown): RouteProviderError {
  if (error instanceof RouteProviderError) return error;
  // MapsNetworkError exposes a code independently of its human-readable message.
  // Read it structurally because SDK errors may originate in another realm.
  const details =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown; name?: unknown })
      : undefined;
  const code = typeof details?.code === 'string' ? details.code.toUpperCase() : '';
  const raw =
    typeof details?.message === 'string'
      ? details.message
      : error instanceof Error
        ? error.message
        : String(error);
  if (
    ['RESOURCE_EXHAUSTED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT'].includes(code) ||
    /quota|resource.exhausted|over.query.limit|429/i.test(raw)
  ) {
    return new RouteProviderError(
      'QUOTA_EXCEEDED',
      'Google quota was reached. Continue with Manual Mode or check the project quota.',
    );
  }
  if (
    ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'REQUEST_DENIED'].includes(code) ||
    /denied|unauthenticated|invalid.key|not.authorized|billing|403|api.key/i.test(raw)
  ) {
    return new RouteProviderError(
      'REQUEST_DENIED',
      'Google rejected the request. Check key restrictions, enabled APIs and the account configuration. Manual Mode remains available.',
    );
  }
  if (
    details?.name === 'InvalidValueError' ||
    ['INVALID_ARGUMENT', 'INVALID_REQUEST', 'OUT_OF_RANGE'].includes(code) ||
    /invalid.argument|invalid.request|out.of.range/i.test(raw)
  )
    return new RouteProviderError(
      'INVALID_INPUT',
      'Google rejected the route inputs or SDK request fields. Check addresses, coordinates and departure times. If those are valid, the Google adapter may need an update; Manual Mode remains available.',
    );
  if (['ZERO_RESULTS', 'NOT_FOUND'].includes(code) || /zero.results|not.found|no.route/i.test(raw))
    return new RouteProviderError(
      'NO_ROUTES',
      'Google returned no route for these locations and this time.',
    );
  return new RouteProviderError(
    'NETWORK_ERROR',
    'Google could not complete the request. Check connectivity or continue with Manual Mode.',
  );
}

function modeOf(step: GoogleRouteStep): TravelLeg['mode'] {
  if (step.travelMode === 'WALKING') return 'walk';
  if (step.travelMode === 'DRIVING') return 'drive';
  const vehicle = step.transitDetails?.transitLine?.vehicle?.vehicleType;
  if (vehicle && /RAIL|TRAIN|SUBWAY|METRO|TRAM/.test(vehicle)) return 'train';
  if (vehicle === 'BUS' || vehicle === 'TROLLEYBUS' || vehicle === 'INTERCITY_BUS') return 'bus';
  throw new RouteProviderError(
    'UNSUPPORTED',
    'This route contains a transport mode outside the bus/train MVP. Enter its cost manually.',
  );
}

function dateMillis(date: Date | undefined): number | undefined {
  const value = date?.getTime();
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function isATService(step: GoogleRouteStep): boolean {
  const line = step.transitDetails?.transitLine;
  // Intercity buses and metro/tram systems can have different fares even when
  // Google classifies their navigation steps as bus/train.
  if (
    !['BUS', 'TROLLEYBUS', 'HEAVY_RAIL', 'COMMUTER_TRAIN', 'RAIL'].includes(
      line?.vehicle?.vehicleType ?? '',
    )
  )
    return false;
  return (
    Boolean(line?.agencies?.length) &&
    line!.agencies!.every((agency) => {
      if (/^(Auckland Transport|AT\s*Metro)$/i.test(agency.name?.trim() ?? '')) return true;
      try {
        const url = new URL(String(agency.url));
        return (
          ['https:', 'http:'].includes(url.protocol) &&
          (url.hostname === 'at.govt.nz' || url.hostname.endsWith('.at.govt.nz'))
        );
      } catch {
        return false;
      }
    })
  );
}

function completeNZDFare(fare: GoogleRouteData['travelAdvisory']): number | undefined {
  const money = fare?.transitFare;
  if (money?.currencyCode !== 'NZD' || (money.units === undefined && money.nanos === undefined))
    return undefined;
  const units = money.units ?? 0;
  const nanos = money.nanos ?? 0;
  if (
    !Number.isInteger(units) ||
    units < 0 ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos >= 1e9
  )
    return undefined;
  const amount = units + nanos / 1e9;
  return nonnegative(amount) ? amount : undefined;
}

/** A tariff envelope, not a zone or stop-count prediction. */
function estimateATFare(
  steps: GoogleRouteStep[],
  departureTime?: Date,
  zoneMap?: FareZoneMap,
): TransitFareRange {
  const transitSteps = steps.filter((step) => step.travelMode === 'TRANSIT');
  if (!transitSteps.length || !transitSteps.every(isATService))
    throw new RouteProviderError(
      'INCOMPLETE_RESULT',
      'Google returned a route without a complete NZD fare, and its operator or service is not confirmed as an AT bus/train. Enter a manual fare for this service.',
    );
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const fallbackDate = departureTime ?? new Date();
  // A walking or waiting segment can move the actual boarding into another
  // tariff period. Validate each known boarding, not just the requested start.
  const boardingDates = transitSteps.map((step) => {
    const boarding = step.transitDetails?.departureTime;
    const parts = dateFormatter.formatToParts(
      dateMillis(boarding) !== undefined ? boarding! : fallbackDate,
    );
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  });
  if (
    boardingDates.some(
      (date) => date < AT_FARE_RULES.effectiveFrom || date >= AT_FARE_RULES.validUntil,
    )
  )
    throw new RouteProviderError(
      'INCOMPLETE_RESULT',
      'The AT fare snapshot does not cover this travel date. Enter a verified fare until the published table is refreshed.',
    );
  const boardings = transitSteps.map((step) => ({
    departure: dateMillis(step.transitDetails?.departureTime),
    arrival: dateMillis(step.transitDetails?.arrivalTime),
    ride: {
      mode: modeOf(step) === 'train' ? ('train' as const) : ('bus' as const),
      path: (step.path ?? []).map((point) => ({ lat: point.lat, lng: point.lng })),
    },
    cityLink: [
      step.transitDetails?.transitLine?.name,
      step.transitDetails?.transitLine?.shortName,
    ].some((name) => /^city\s*link$/i.test(name?.trim() ?? '')),
  }));
  const groups = (conservativeUpper: boolean) => {
    const journeys: (typeof boardings)[] = [];
    for (const boarding of boardings) {
      const current = journeys.at(-1);
      const previous = current?.at(-1);
      const start = current?.[0]?.departure;
      const gap =
        boarding.departure !== undefined && previous?.arrival !== undefined
          ? (boarding.departure - previous.arrival) / 60000
          : undefined;
      const duration =
        boarding.arrival !== undefined && start !== undefined
          ? (boarding.arrival - start) / 60000
          : undefined;
      const knownSeparate =
        (gap !== undefined && gap > AT_FARE_RULES.transferWindowMinutes) ||
        (duration !== undefined && duration > AT_FARE_RULES.maximumJourneyMinutes);
      const knownIntegrated =
        gap !== undefined &&
        gap >= 0 &&
        gap <= AT_FARE_RULES.transferWindowMinutes &&
        duration !== undefined &&
        duration >= 0 &&
        duration <= AT_FARE_RULES.maximumJourneyMinutes &&
        current!.length < 5;
      if (!current || knownSeparate || (conservativeUpper && !knownIntegrated))
        journeys.push([boarding]);
      else current.push(boarding);
    }
    return journeys;
  };
  // Zones a journey travels through, counted along its bus and train paths when AT's zone
  // polygons are loaded; a journey without a usable path keeps the 1-to-4+ zone envelope.
  const zonesOf = (group: typeof boardings) =>
    zoneMap
      ? countJourneyZones(
          zoneMap,
          group.map((boarding) => boarding.ride),
        )
      : undefined;
  const zoneFare = (zones: number) =>
    AT_FARE_RULES.adult[Math.min(zones, AT_FARE_RULES.adult.length) - 1]!;
  const price = (journeys: (typeof boardings)[], upper: boolean) =>
    Math.round(
      journeys.reduce((sum, group) => {
        if (group.every((boarding) => boarding.cityLink)) return sum + AT_FARE_RULES.cityLink.adult;
        const counted = zonesOf(group);
        if (counted) return sum + zoneFare(counted.count);
        return sum + (upper ? AT_FARE_RULES.adult.at(-1)! : AT_FARE_RULES.adult[0]);
      }, 0) * 100,
    ) / 100;
  const minimumJourneys = groups(false);
  const maximumJourneys = groups(true);
  const cityLinkOnly = boardings.every((boarding) => boarding.cityLink);
  const countedJourneys = maximumJourneys.map((group) =>
    group.every((boarding) => boarding.cityLink) ? undefined : zonesOf(group),
  );
  const allCounted = maximumJourneys.every(
    (group, index) =>
      group.every((boarding) => boarding.cityLink) || countedJourneys[index] !== undefined,
  );
  // One journey whose zones are known can be shown, and re-priced, as a single zone count.
  const single =
    minimumJourneys.length === 1 && maximumJourneys.length === 1 && !cityLinkOnly
      ? countedJourneys[0]
      : undefined;
  const assumptions = [
    'Standard adult using the same AT HOP card or contactless card/device, with correct tag-on/tag-off. No concession, cap history or subsidy is applied.',
    allCounted && zoneMap
      ? `Fare zones counted along the route from Auckland Transport's fare zone map (${zoneMap.license}, edited ${zoneMap.sourceEditedOn}); an overlap area counts as the cheaper zone. Check the zone count in AT Journey Planner if a stop is on a zone edge.`
      : 'Fare-zone coverage is unverified. Stop counts describe the route and do not determine fare zones.',
    `Published AT fare table verified ${AT_FARE_RULES.verifiedOn}: ${AT_FARE_RULES.sourceUrl}`,
  ];
  if (maximumJourneys.length > minimumJourneys.length)
    assumptions.push(
      'Incomplete transfer timing or unverified transfer eligibility widens the upper bound to separate boarding fares.',
    );
  if (boardings.length > 5)
    assumptions.push(
      'The upper estimate limits each transfer group to five boardings; this is a conservative estimate, not a verified current journey condition.',
    );
  if (minimumJourneys.length > 1)
    assumptions.push(
      'Transfers exceeding 30 minutes or journeys exceeding 4 hours are priced as separate journeys.',
    );
  return {
    min: price(minimumJourneys, false),
    max: price(maximumJourneys, true),
    source: 'at-estimate',
    basis: cityLinkOnly ? 'citylink' : 'standard-adult',
    assumptions,
    ...(single ? { mapZones: { count: single.count, names: single.zones } } : {}),
  };
}

/** Maps and route responses are kept only in memory for the active planning session. */
/** Matches the planner's accent so the selected option and its map line read as one route. */
// Each route is a casing plus a fill, like a directions map: the selected route is the solid
// palette green with a deep outline; alternatives are a pale fill inside a lighter green outline.
const ROUTE_STYLE = {
  selected: {
    casing: { strokeColor: '#1b5e3f', strokeWeight: 10, strokeOpacity: 1 },
    fill: { strokeColor: '#2b8b5f', strokeWeight: 6, strokeOpacity: 1 },
  },
  alternative: {
    casing: { strokeColor: '#5e9c7c', strokeWeight: 8, strokeOpacity: 1 },
    fill: { strokeColor: '#d6e8dc', strokeWeight: 4, strokeOpacity: 1 },
  },
} as const;

type LatLngPoint = { lat: number; lng: number };

/** Google draws walking steps as dotted icon lines; detect them so they take the route colours. */
const isWalkingLine = (polyline: google.maps.Polyline) => {
  const icons = polyline.get?.('icons') as unknown;
  return Array.isArray(icons) && icons.length > 0;
};
const walkingDots = (selected: boolean): google.maps.IconSequence[] => [
  {
    icon: {
      // SymbolPath.CIRCLE is 0; the constant is only defined once the SDK has loaded.
      path: typeof google === 'undefined' ? 0 : google.maps.SymbolPath.CIRCLE,
      scale: selected ? 3 : 2.4,
      fillColor: selected ? '#2b8b5f' : '#5e9c7c',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 1.5,
    },
    offset: '0',
    repeat: selected ? '11px' : '10px',
  },
];
const pointsOf = (polylines: google.maps.Polyline[]): LatLngPoint[] =>
  polylines.flatMap(
    (polyline) =>
      polyline
        .getPath?.()
        ?.getArray()
        .map((point) => point.toJSON()) ?? [],
  );
/** Picks the point of a route farthest from the other routes, so overlapping chips separate. */
function labelPoint(path: LatLngPoint[], others: LatLngPoint[][]): LatLngPoint | undefined {
  if (!path.length) return undefined;
  const step = Math.max(1, Math.floor(path.length / 40));
  const otherPoints = others.flat().filter((_, index) => index % step === 0);
  let best = path[Math.floor(path.length / 2)]!;
  if (!otherPoints.length) return best;
  let bestDistance = -1;
  // Skip both ends, where every alternative starts and finishes together.
  for (let index = Math.floor(path.length * 0.15); index < path.length * 0.85; index += step) {
    const point = path[index]!;
    let nearest = Infinity;
    for (const other of otherPoints) {
      const distance = (point.lat - other.lat) ** 2 + (point.lng - other.lng) ** 2;
      if (distance < nearest) nearest = distance;
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = point;
    }
  }
  return best;
}
// Tinted to the planner palette: off-white land, sage parks, soft blue water, ochre highways.
const COMMUTE_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#eef0ea' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d8e2d6' }] },
  {
    featureType: 'landscape.natural',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c6d9e3' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#f0e3c4' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d6bf8a' }] },
];

export class GoogleRouteProvider implements RouteProvider {
  readonly id = 'google';
  private readonly options: GoogleRouteProviderOptions;
  private sdkLoad?: Promise<void>;
  private busy = false;
  private map?: google.maps.Map;
  private mapLifecycleCleanup?: () => void;
  private waypointSelectionCleanup?: () => void;
  private overlayViewConstructor?: typeof google.maps.OverlayView;
  private waypointMarkers: google.maps.OverlayView[] = [];
  private userLocationMarker?: google.maps.OverlayView;
  /** AT's fare zone polygons, loaded once a transit route needs an AT fare. */
  private fareZones?: FareZoneMap;
  private polylines: google.maps.Polyline[] = [];
  /** Alternatives that select a route on click; muted while a map point is being picked. */
  private clickableRoutes: google.maps.Polyline[] = [];
  private routeChips: google.maps.OverlayView[] = [];
  private routeListeners: google.maps.MapsEventListener[] = [];
  private fittedRouteSet = '';
  /**
   * Routes of recent responses, so a planner can redraw a cached result for another travel
   * mode. A route is only ever drawn with the other alternatives of its own response.
   */
  private sdkRoutes = new Map<string, GoogleRouteData>();
  private routeResponse = new Map<string, string>();
  private responseOrder: string[] = [];
  private placeHours = new Map<string, Promise<PlaceHours>>();
  private computationWarnings: string[] = [];
  private metrics: ProviderMetrics = {
    routeRequests: 0,
    routeErrors: 0,
    mapLoads: 0,
    placeDetailsRequests: 0,
    geocodingRequests: 0,
    autocompleteRequests: 'not-observable',
  };

  constructor(options: GoogleRouteProviderOptions = {}) {
    this.options = options;
  }

  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  private async load(name: LibraryName): Promise<unknown> {
    if (!this.options.apiKey?.trim())
      throw new RouteProviderError(
        'MISSING_KEY',
        'No Google API key is configured. Use Manual Mode.',
      );
    if (this.options.loadLibrary) return this.options.loadLibrary(name);
    this.sdkLoad ??= Promise.resolve().then(() => {
      if (configuredKey && configuredKey !== this.options.apiKey) {
        throw new RouteProviderError(
          'REQUEST_DENIED',
          'The Google SDK is already configured with another key. Reload before changing the key.',
        );
      }
      if (!configuredKey) {
        setOptions({ key: this.options.apiKey, v: 'weekly', region: 'NZ', language: 'en' });
        configuredKey = this.options.apiKey;
      }
    });
    await this.sdkLoad;
    return importLibrary(name);
  }

  async initializeMap(
    element: HTMLElement,
    onError?: (error: RouteProviderError) => void,
    display: MapDisplayOptions = {},
  ): Promise<void> {
    this.waypointSelectionCleanup?.();
    this.clearWaypointMarkers();
    this.clearUserLocation();
    this.mapLifecycleCleanup?.();
    let ready = false;
    let failed = false;
    let readinessListener: google.maps.MapsEventListener | undefined;
    let rejectFailure: (error: RouteProviderError) => void = () => undefined;
    const failure = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject;
    });
    const fail = (error: RouteProviderError) => {
      if (failed) return;
      failed = true;
      this.metrics.lastError = error.code;
      this.waypointSelectionCleanup?.();
      this.clearWaypointMarkers();
      this.clearMapRoutes();
      this.map = undefined;
      rejectFailure(error);
      onError?.(error);
    };
    const stopWatching = watchAuthenticationFailure(() =>
      fail(
        new RouteProviderError(
          'REQUEST_DENIED',
          'Google could not authenticate the map. Check key restrictions and enabled APIs. Continue with Manual Mode.',
        ),
      ),
    );
    // A blocked SDK script or first map render must not leave the planner loading forever.
    const deadline = window.setTimeout(
      () =>
        fail(
          new RouteProviderError(
            'NETWORK_ERROR',
            'Google Maps did not finish loading. Check connectivity or continue with Manual Mode.',
          ),
        ),
      12000,
    );
    const cleanup = () => {
      stopWatching();
      readinessListener?.remove();
      window.clearTimeout(deadline);
      if (!ready && !failed) {
        failed = true;
        rejectFailure(new RouteProviderError('NETWORK_ERROR', 'The map was closed while loading.'));
      }
    };
    this.mapLifecycleCleanup = cleanup;
    try {
      const maps = (await Promise.race([this.load('maps'), failure])) as google.maps.MapsLibrary;
      const map = new maps.Map(element, {
        center: { lat: -36.8485, lng: 174.7633 },
        zoom: 11,
        maxZoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: display.fullscreenControl ?? true,
        // Commuting needs roads, route shields and transit; businesses and landmarks are noise.
        clickableIcons: false,
        styles: COMMUTE_MAP_STYLE,
      });
      if (failed) await failure;
      this.map = map;
      this.overlayViewConstructor = maps.OverlayView;
      const firstRender = new Promise<void>((resolve) => {
        readinessListener = map.addListener('idle', resolve);
      });
      await Promise.race([firstRender, failure]);
      ready = true;
      readinessListener?.remove();
      window.clearTimeout(deadline);
      this.metrics.mapLoads += 1;
    } catch (error) {
      cleanup();
      const readable = readableError(error);
      if (this.mapLifecycleCleanup === cleanup) {
        this.mapLifecycleCleanup = undefined;
        this.clearMapRoutes();
        this.map = undefined;
        this.metrics.lastError = readable.code;
      }
      throw readable;
    }
  }

  createPlaceSearch(): GooglePlaceSearch {
    let token: google.maps.places.AutocompleteSessionToken | undefined;
    const predictions = new Map<string, google.maps.places.PlacePrediction>();
    return {
      suggest: async (input) => {
        if (!input.trim()) return [];
        const places = (await this.load('places')) as google.maps.PlacesLibrary;
        token ??= new places.AutocompleteSessionToken();
        try {
          const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            includedRegionCodes: ['nz'],
            sessionToken: token,
          });
          predictions.clear();
          return suggestions.flatMap(({ placePrediction }) => {
            if (!placePrediction) return [];
            predictions.set(placePrediction.placeId, placePrediction);
            return [
              {
                id: placePrediction.placeId,
                main: placePrediction.mainText?.text ?? placePrediction.text.text,
                secondary: placePrediction.secondaryText?.text ?? '',
                text: placePrediction.text.text,
              },
            ];
          });
        } catch (error) {
          throw readableError(error);
        }
      },
      select: async (suggestion) => {
        const prediction = predictions.get(suggestion.id);
        if (!prediction)
          throw new RouteProviderError('INVALID_INPUT', 'Search for the address again.');
        // The details request ends this session; the next keystroke starts another.
        token = undefined;
        predictions.clear();
        try {
          const place = prediction.toPlace();
          this.metrics.placeDetailsRequests += 1;
          // These fields use Place Details Essentials; displayName would escalate to Pro.
          await place.fetchFields({ fields: ['formattedAddress', 'location'] });
          if (!place.location)
            throw new RouteProviderError(
              'INCOMPLETE_RESULT',
              'The selected address has no coordinates. Enter latitude and longitude manually.',
            );
          // A landmark's address alone ("Victoria Street West, …") loses its name.
          const address = place.formattedAddress;
          return {
            label: !address
              ? suggestion.text
              : address.startsWith(suggestion.main)
                ? address
                : `${suggestion.main}, ${address}`,
            coordinates: place.location.toJSON(),
            ...(place.id ? { placeId: place.id } : {}),
          };
        } catch (error) {
          throw readableError(error);
        }
      },
    };
  }

  async attachAutocomplete(
    element: HTMLElement,
    onSelect: (location: Location) => void,
    onError?: (error: RouteProviderError) => void,
    options: GoogleAutocompleteOptions = {},
  ): Promise<GoogleAutocompleteControl> {
    const places = (await this.load('places')) as google.maps.PlacesLibrary;
    const widget = new places.PlaceAutocompleteElement({ includedRegionCodes: ['nz'] });
    let active = true;
    let revision = 0;
    widget.value = options.initialValue ?? '';
    widget.setAttribute('aria-label', options.label ?? 'Search a New Zealand address');
    const inputListener = () => {
      if (!active) return;
      revision += 1;
      options.onInput?.(widget.value);
    };
    const listener = (event: Event) => {
      const selectedRevision = ++revision;
      options.onResolving?.(true);
      void (async () => {
        try {
          const { placePrediction } = event as google.maps.places.PlacePredictionSelectEvent;
          const place = placePrediction.toPlace();
          this.metrics.placeDetailsRequests += 1;
          // These fields use Place Details Essentials; displayName would escalate to Pro.
          await place.fetchFields({ fields: ['formattedAddress', 'location'] });
          if (!place.location)
            throw new RouteProviderError(
              'INCOMPLETE_RESULT',
              'The selected address has no coordinates. Enter latitude and longitude manually.',
            );
          if (active && selectedRevision === revision) {
            const label = place.formattedAddress ?? widget.value;
            widget.value = label;
            onSelect({
              label,
              coordinates: place.location.toJSON(),
              ...(place.id ? { placeId: place.id } : {}),
            });
          }
        } catch (error) {
          if (active && selectedRevision === revision) onError?.(readableError(error));
        } finally {
          if (active) options.onResolving?.(false);
        }
      })();
    };
    const errorListener = () =>
      onError?.(
        new RouteProviderError(
          'REQUEST_DENIED',
          'Google denied address search. Check that Places API (New) is enabled and allowed by the key restrictions. Enter the address manually.',
        ),
      );
    widget.addEventListener('gmp-select', listener);
    widget.addEventListener('gmp-error', errorListener);
    widget.addEventListener('input', inputListener);
    element.appendChild(widget);
    const cleanup = () => {
      active = false;
      widget.removeEventListener('gmp-select', listener);
      widget.removeEventListener('gmp-error', errorListener);
      widget.removeEventListener('input', inputListener);
      widget.remove();
    };
    return Object.assign(cleanup, {
      setValue(value: string) {
        if (!active || widget.value === value) return;
        revision += 1;
        widget.value = value;
      },
    });
  }

  async geocode(location: Location): Promise<Location> {
    const value = locationValue(location);
    if (typeof value !== 'string') return { label: location.label, coordinates: value };
    try {
      const library = (await this.load('geocoding')) as google.maps.GeocodingLibrary;
      this.metrics.geocodingRequests += 1;
      const result = await new library.Geocoder().geocode({ address: value, region: 'NZ' });
      const first = result.results[0];
      if (!first)
        throw new RouteProviderError('NO_ROUTES', 'No coordinates were found for that address.');
      return { label: first.formatted_address, coordinates: first.geometry.location.toJSON() };
    } catch (error) {
      throw readableError(error);
    }
  }

  /**
   * Opening hours for one selected place. These fields bill as Place Details Enterprise, so each
   * place is requested at most once per session and only when the planner asks for it.
   */
  getPlaceHours(placeId: string): Promise<PlaceHours> {
    const cached = this.placeHours.get(placeId);
    if (cached) return cached;
    const request = (async (): Promise<PlaceHours> => {
      try {
        const places = (await this.load('places')) as google.maps.PlacesLibrary;
        const place = new places.Place({ id: placeId });
        this.metrics.placeDetailsRequests += 1;
        await place.fetchFields({
          fields: ['businessStatus', 'regularOpeningHours', 'utcOffsetMinutes'],
        });
        const status = place.businessStatus;
        return {
          placeId,
          ...(status === 'OPERATIONAL' ||
          status === 'CLOSED_TEMPORARILY' ||
          status === 'CLOSED_PERMANENTLY'
            ? { businessStatus: status }
            : {}),
          periods: (place.regularOpeningHours?.periods ?? []).map((period) => ({
            open: { day: period.open.day, hour: period.open.hour, minute: period.open.minute },
            ...(period.close
              ? {
                  close: {
                    day: period.close.day,
                    hour: period.close.hour,
                    minute: period.close.minute,
                  },
                }
              : {}),
          })),
          ...(typeof place.utcOffsetMinutes === 'number'
            ? { utcOffsetMinutes: place.utcOffsetMinutes }
            : {}),
          fetchedAt: Date.now(),
        };
      } catch (error) {
        this.placeHours.delete(placeId);
        throw readableError(error);
      }
    })();
    this.placeHours.set(placeId, request);
    return request;
  }

  clearMapRoutes(): void {
    for (const listener of this.routeListeners) listener.remove();
    for (const polyline of this.polylines) polyline.setMap(null);
    for (const chip of this.routeChips) chip.setMap(null);
    this.routeListeners = [];
    this.polylines = [];
    this.clickableRoutes = [];
    this.routeChips = [];
  }

  /** One deliberate map click adds a coordinate without a reverse-geocoding request. */
  beginWaypointSelection(onPick: (coordinates: google.maps.LatLngLiteral) => void): () => void {
    this.waypointSelectionCleanup?.();
    const map = this.map;
    if (!map) throw new RouteProviderError('INVALID_INPUT', 'Load the map before choosing a stop.');
    let active = true;
    // While picking, route lines must not swallow the click meant for the map.
    for (const polyline of this.clickableRoutes) polyline.setOptions?.({ clickable: false });
    const cleanup = () => {
      if (!active) return;
      active = false;
      listener.remove();
      map.setOptions({ draggableCursor: null });
      for (const polyline of this.clickableRoutes) polyline.setOptions?.({ clickable: true });
      if (this.waypointSelectionCleanup === cleanup) this.waypointSelectionCleanup = undefined;
    };
    map.setOptions({ draggableCursor: 'crosshair' });
    const listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!active || !event.latLng) return;
      const coordinates = event.latLng.toJSON();
      locationValue({ label: 'Map stop', coordinates });
      event.stop();
      cleanup();
      onPick(coordinates);
    });
    this.waypointSelectionCleanup = cleanup;
    return cleanup;
  }

  /** A blue dot for the browser's position, with the map centred on it; nothing is requested. */
  showUserLocation(point: LatLngPoint, accuracyMeters?: number): void {
    this.clearUserLocation();
    const map = this.map;
    const OverlayView = this.overlayViewConstructor;
    if (!map || !OverlayView) return;
    const marker = new OverlayView();
    const element = document.createElement('span');
    element.className = 'sc-map-user-location';
    element.setAttribute('aria-hidden', 'true');
    Object.assign(element.style, {
      position: 'absolute',
      transform: 'translate(-50%, -50%)',
      boxSizing: 'border-box',
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      border: '3px solid #ffffff',
      background: '#1a73e8',
      boxShadow: '0 0 0 8px rgb(26 115 232 / 0.2), 0 1px 4px rgb(0 0 0 / 0.35)',
      pointerEvents: 'none',
    });
    marker.onAdd = () => marker.getPanes()?.floatPane.appendChild(element);
    marker.draw = () => {
      const position = marker.getProjection()?.fromLatLngToDivPixel(point);
      if (!position) return;
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    };
    marker.onRemove = () => element.remove();
    marker.setMap(map);
    this.userLocationMarker = marker;
    map.panTo?.(point);
    // A rough fix is shown at street scale; a precise one closer in.
    map.setZoom?.(accuracyMeters !== undefined && accuracyMeters > 500 ? 13 : 15);
  }

  clearUserLocation(): void {
    this.userLocationMarker?.setMap(null);
    this.userLocationMarker = undefined;
  }

  clearWaypointMarkers(): void {
    for (const marker of this.waypointMarkers) marker.setMap(null);
    this.waypointMarkers = [];
  }

  /** Numbered overlays use the loaded map SDK and remain only in session memory. */
  renderWaypointMarkers(locations: Location[]): void {
    this.clearWaypointMarkers();
    const OverlayView = this.overlayViewConstructor;
    if (!this.map || !OverlayView) return;
    locations.forEach((location, index) => {
      if (!location.coordinates) return;
      const coordinates = locationValue(location) as google.maps.LatLngLiteral;
      const marker = new OverlayView();
      const element = document.createElement('span');
      element.className = 'sc-map-stop-marker';
      element.textContent = String(index + 1);
      element.title = location.label;
      element.setAttribute('aria-hidden', 'true');
      Object.assign(element.style, {
        position: 'absolute',
        transform: 'translate(-50%, -50%)',
        width: '28px',
        height: '28px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        border: '2px solid white',
        background: '#23784f',
        color: 'white',
        font: 'bold 13px system-ui, sans-serif',
        boxShadow: '0 2px 5px #0006',
        pointerEvents: 'none',
      });
      marker.onAdd = () => marker.getPanes()?.markerLayer.appendChild(element);
      marker.draw = () => {
        const position = marker.getProjection()?.fromLatLngToDivPixel(coordinates);
        if (!position) return;
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
      };
      marker.onRemove = () => element.remove();
      marker.setMap(this.map!);
      this.waypointMarkers.push(marker);
    });
  }

  /**
   * Draws every alternative from the last response, like a directions map: alternatives in a
   * muted line, the selected route in the accent colour on top. The view is fitted only when the
   * set of routes changes, so choosing an alternative does not move the map.
   */
  renderRoute(id: string, options: RouteRenderOptions = {}): void {
    this.clearMapRoutes();
    const map = this.map;
    const response = this.routeResponse.get(id);
    if (!map || !this.sdkRoutes.has(id) || response === undefined) return;
    const group = [...this.sdkRoutes.entries()].filter(
      ([routeId]) => this.routeResponse.get(routeId) === response,
    );
    const ordered = group.sort(([left], [right]) => (left === id ? 1 : right === id ? -1 : 0));
    const drawn = ordered.map(([routeId, route]) => {
      const selected = routeId === id;
      const style = selected ? ROUTE_STYLE.selected : ROUTE_STYLE.alternative;
      // Casing first, fill on top; selected layers sit above every alternative.
      const casing = route.createPolylines?.({ polylineOptions: { ...style.casing } }) ?? [];
      const fill = route.createPolylines?.({ polylineOptions: { ...style.fill } }) ?? [];
      const layers = [
        ...casing.map((polyline) => [polyline, selected ? 3 : 1] as const),
        ...fill.map((polyline) => [polyline, selected ? 4 : 2] as const),
      ];
      for (const [polyline, zIndex] of layers) {
        // The selected route never takes clicks, so a map click on it reaches the map.
        const clickable = !selected && Boolean(options.onSelect) && !this.waypointSelectionCleanup;
        polyline.setOptions?.({ zIndex, clickable });
        // Walking steps: one row of palette dots, no casing underneath.
        if (isWalkingLine(polyline))
          polyline.setOptions?.(
            casing.includes(polyline)
              ? { icons: [], strokeOpacity: 0 }
              : { icons: walkingDots(selected), strokeOpacity: 0 },
          );
        if (!selected && options.onSelect) this.clickableRoutes.push(polyline);
        polyline.setMap(map);
        if (!selected && options.onSelect) {
          const listener = polyline.addListener?.('click', () => options.onSelect?.(routeId));
          if (listener) this.routeListeners.push(listener);
        }
      }
      this.polylines.push(...casing, ...fill);
      return { routeId, selected, path: pointsOf(fill) };
    });
    const OverlayView = this.overlayViewConstructor;
    if (OverlayView && options.labels) {
      for (const route of drawn) {
        const text = options.labels[route.routeId];
        const point = text
          ? labelPoint(
              route.path,
              drawn.filter((other) => other !== route).map((other) => other.path),
            )
          : undefined;
        if (!text || !point) continue;
        this.routeChips.push(this.addRouteChip(OverlayView, map, point, text, route, options));
      }
    }
    // Start and end marks echo the form's route dots: hollow circle to filled square.
    const main = drawn.find((route) => route.selected);
    if (OverlayView && main?.path.length) {
      this.routeChips.push(
        this.addEndpointMarker(OverlayView, map, main.path[0]!, 'start', options.endpoints?.start),
        this.addEndpointMarker(
          OverlayView,
          map,
          main.path[main.path.length - 1]!,
          'end',
          options.endpoints?.end,
        ),
      );
    }
    if (response !== this.fittedRouteSet) {
      this.fittedRouteSet = response;
      this.fitRoutes(
        map,
        group.map(([, route]) => route),
        options.padding,
      );
    }
  }

  private addRouteChip(
    OverlayView: typeof google.maps.OverlayView,
    map: google.maps.Map,
    point: LatLngPoint,
    text: string,
    route: { routeId: string; selected: boolean },
    options: RouteRenderOptions,
  ): google.maps.OverlayView {
    const chip = new OverlayView();
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `sc-map-route-chip${route.selected ? ' is-selected' : ''}`;
    element.textContent = text;
    element.setAttribute('aria-pressed', String(route.selected));
    Object.assign(element.style, {
      position: 'absolute',
      transform: 'translate(-50%, calc(-100% - 8px))',
      padding: '4px 8px',
      border: route.selected ? '1px solid #1b5e3f' : '1px solid #5e9c7c',
      borderRadius: '6px',
      background: route.selected ? '#23784f' : '#fcfcf9',
      color: route.selected ? '#ffffff' : '#1e2b24',
      font: '600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      boxShadow: '0 1px 4px rgb(0 0 0 / 0.22)',
      cursor: route.selected ? 'default' : 'pointer',
      // The chosen route's time and price sit above the start and finish labels (zIndex 3).
      zIndex: route.selected ? '4' : '1',
    });
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!route.selected) options.onSelect?.(route.routeId);
    });
    OverlayView.preventMapHitsAndGesturesFrom?.(element);
    chip.onAdd = () => chip.getPanes()?.floatPane.appendChild(element);
    chip.draw = () => {
      const position = chip.getProjection()?.fromLatLngToDivPixel(point);
      if (!position) return;
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    };
    chip.onRemove = () => element.remove();
    chip.setMap(map);
    return chip;
  }

  private addEndpointMarker(
    OverlayView: typeof google.maps.OverlayView,
    map: google.maps.Map,
    point: LatLngPoint,
    kind: 'start' | 'end',
    label?: string,
  ): google.maps.OverlayView {
    const marker = new OverlayView();
    const element = document.createElement('span');
    element.className = `sc-map-endpoint sc-map-endpoint-${kind}`;
    element.setAttribute('aria-hidden', 'true');
    Object.assign(element.style, {
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      // Anchor on the dot's centre so the label extends to the right of the exact endpoint.
      transform: `translate(-${kind === 'start' ? 9 : 10}px, -50%)`,
      pointerEvents: 'none',
      zIndex: '3',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      flex: 'none',
      boxSizing: 'border-box',
      width: kind === 'start' ? '18px' : '20px',
      height: kind === 'start' ? '18px' : '20px',
      borderRadius: kind === 'start' ? '50%' : '5px',
      border: kind === 'start' ? '5px solid #1b5e3f' : '3px solid #ffffff',
      background: kind === 'start' ? '#ffffff' : '#1b5e3f',
      boxShadow: '0 1px 4px rgb(0 0 0 / 0.35)',
    });
    element.appendChild(dot);
    if (label) {
      const text = document.createElement('span');
      text.textContent = label;
      Object.assign(text.style, {
        padding: '3px 8px',
        borderRadius: '6px',
        background: kind === 'start' ? '#ffffff' : '#1b5e3f',
        color: kind === 'start' ? '#1e2b24' : '#ffffff',
        border: '1px solid #1b5e3f',
        font: '600 12px/1.3 system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif',
        whiteSpace: 'nowrap',
        // Long place names stay short so they cover less of the map and of the route chips.
        maxWidth: '150px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: '0 1px 4px rgb(0 0 0 / 0.22)',
      });
      element.appendChild(text);
    }
    marker.onAdd = () => marker.getPanes()?.floatPane.appendChild(element);
    marker.draw = () => {
      const position = marker.getProjection()?.fromLatLngToDivPixel(point);
      if (!position) return;
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    };
    marker.onRemove = () => element.remove();
    marker.setMap(map);
    return marker;
  }

  private fitRoutes(
    map: google.maps.Map,
    routes: GoogleRouteData[],
    padding?: google.maps.Padding,
  ): void {
    const bounds = routes
      .map((route) => route.viewport?.toJSON?.())
      .filter((viewport): viewport is google.maps.LatLngBoundsLiteral => Boolean(viewport));
    const first = routes.find((route) => route.viewport)?.viewport;
    if (!first) return;
    const union = bounds.length
      ? bounds.reduce((all, viewport) => ({
          north: Math.max(all.north, viewport.north),
          south: Math.min(all.south, viewport.south),
          east: Math.max(all.east, viewport.east),
          west: Math.min(all.west, viewport.west),
        }))
      : first;
    const listener = map.addListener('idle', () => {
      listener.remove();
      if (this.map !== map) return;
      const zoom = map.getZoom?.();
      if (zoom !== undefined && zoom > 15) map.setZoom?.(15);
    });
    map.fitBounds(union, padding ?? { top: 64, right: 48, bottom: 48, left: 48 });
  }

  dispose(): void {
    this.waypointSelectionCleanup?.();
    this.clearWaypointMarkers();
    this.mapLifecycleCleanup?.();
    this.mapLifecycleCleanup = undefined;
    this.clearMapRoutes();
    this.clearUserLocation();
    this.sdkRoutes.clear();
    this.routeResponse.clear();
    this.responseOrder = [];
    this.map = undefined;
    this.overlayViewConstructor = undefined;
  }

  private async compute(request: GoogleComputeRequest): Promise<GoogleRouteData[]> {
    if (this.metrics.routeRequests >= (this.options.maxRouteRequests ?? 30)) {
      throw new RouteProviderError(
        'QUOTA_EXCEEDED',
        'The local session limit of route requests was reached. Manual Mode remains available.',
      );
    }
    const { Route } = (await this.load('routes')) as GoogleRoutesLibrary;
    this.metrics.routeRequests += 1;
    const response = await Route.computeRoutes(request);
    if (response.fallbackInfo)
      this.computationWarnings.push(
        'Google used fallback routing; these estimates may differ from the requested routing preference.',
      );
    if (!response.routes?.length)
      throw new RouteProviderError('NO_ROUTES', 'Google returned no routes for these inputs.');
    return response.routes;
  }

  private toLegs(
    route: GoogleRouteData,
    mode: 'drive' | 'transit',
    departureTime?: Date,
  ): TravelLeg[] {
    if (!nonnegative(route.durationMillis) || !nonnegative(route.distanceMeters)) {
      throw new RouteProviderError(
        'INCOMPLETE_RESULT',
        'Google did not return a usable route distance and duration. Enter measurements manually.',
      );
    }
    if (mode === 'drive') {
      const delay = nonnegative(route.staticDurationMillis)
        ? Math.max(0, route.durationMillis - route.staticDurationMillis) / 60000
        : undefined;
      return [
        {
          mode: 'drive',
          distanceKm: route.distanceMeters / 1000,
          durationMinutes: route.durationMillis / 60000,
          ...(delay !== undefined ? { congestionMinutes: delay } : {}),
          source: 'google',
          estimated: true,
        },
      ];
    }
    const steps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
    if (!steps.length)
      throw new RouteProviderError('INCOMPLETE_RESULT', 'Google did not return transit steps.');
    let boardings = 0;
    const legs = steps.map((step): TravelLeg => {
      const travelMode = modeOf(step);
      let duration = step.staticDurationMillis;
      if (step.transitDetails?.departureTime && step.transitDetails.arrivalTime) {
        duration =
          step.transitDetails.arrivalTime.getTime() - step.transitDetails.departureTime.getTime();
      }
      if (!nonnegative(duration))
        throw new RouteProviderError('INCOMPLETE_RESULT', 'A transit step has no usable duration.');
      const transit = travelMode === 'bus' || travelMode === 'train';
      const transfers = transit ? (boardings++ > 0 ? 1 : 0) : undefined;
      const details = step.transitDetails;
      return {
        mode: travelMode,
        distanceKm: nonnegative(step.distanceMeters) ? step.distanceMeters / 1000 : undefined,
        durationMinutes: duration / 60000,
        transfers,
        transit: transit
          ? {
              stopCount:
                Number.isInteger(details?.stopCount) && nonnegative(details?.stopCount)
                  ? details.stopCount
                  : undefined,
              departureStop: details?.departureStop?.name,
              arrivalStop: details?.arrivalStop?.name,
              lineName: details?.transitLine?.name,
              lineShortName: details?.transitLine?.shortName,
              agencyNames: details?.transitLine?.agencies?.flatMap((agency) =>
                agency.name ? [agency.name] : [],
              ),
            }
          : undefined,
        source: 'google',
        estimated: true,
      };
    });
    const waiting =
      route.durationMillis / 60000 - legs.reduce((total, leg) => total + leg.durationMinutes, 0);
    if (waiting > 0.001)
      legs.push({ mode: 'wait', durationMinutes: waiting, source: 'google', estimated: true });
    if (waiting < -0.1)
      throw new RouteProviderError(
        'INCOMPLETE_RESULT',
        'Google transit step durations exceed the route duration.',
      );
    const amount =
      this.options.useGoogleTransitFare === false
        ? undefined
        : completeNZDFare(route.travelAdvisory);
    const firstTransit = legs.find((leg) => leg.mode === 'bus' || leg.mode === 'train');
    if (!firstTransit) return legs;
    if (nonnegative(amount)) {
      firstTransit.fare = amount;
      firstTransit.fareSource = 'google';
    } else if (this.options.estimateMissingTransitFare) {
      firstTransit.fareRange = estimateATFare(steps, departureTime, this.fareZones);
      firstTransit.fareSource = 'at-estimate';
    } else {
      throw new RouteProviderError(
        'INCOMPLETE_RESULT',
        'Google did not return a complete NZD fare. Enter a manual journey fare or use AT rules with a verified zone count; missing fare is not free travel.',
      );
    }
    // Google quotes one whole-direction fare; the range also covers the whole
    // direction. Explicit zeroes mean these boardings are already included,
    // never that a missing fare was silently interpreted as free travel.
    for (const leg of legs) {
      if (leg !== firstTransit && (leg.mode === 'bus' || leg.mode === 'train')) {
        leg.fare = 0;
        leg.fareSource = firstTransit.fareSource;
      }
    }
    return legs;
  }

  async getRoutes(request: RouteRequest): Promise<RouteResult> {
    if (this.busy) throw new RouteProviderError('BUSY', 'A route request is already running.');
    this.busy = true;
    try {
      this.computationWarnings = [];
      // Zones are only counted for AT estimates; a missing zone file keeps the plain envelope.
      if (request.mode === 'transit' && this.options.estimateMissingTransitFare)
        this.fareZones ??= await loadATFareZones().catch(() => undefined);
      const origin = locationValue(request.origin);
      const destination = locationValue(request.destination);
      const waypoints = request.waypoints ?? [];
      if (waypoints.length > 10)
        throw new RouteProviderError(
          'INVALID_INPUT',
          'This low-cost adapter supports at most 10 waypoints.',
        );
      if (request.mode === 'transit' && waypoints.length)
        throw new RouteProviderError(
          'UNSUPPORTED',
          'Transit routing does not support intermediate waypoints. Request separate legs or enter a manual hybrid journey.',
        );
      for (const date of [request.departureTime, request.returnTime]) {
        if (date && !Number.isFinite(date.getTime()))
          throw new RouteProviderError('INVALID_INPUT', 'Choose a valid departure date and time.');
        if (
          date &&
          request.mode === 'drive' &&
          this.options.trafficAware &&
          date.getTime() < Date.now()
        ) {
          throw new RouteProviderError(
            'INVALID_INPUT',
            'Traffic-aware driving requires a future departure time.',
          );
        }
        if (date && request.mode === 'transit') {
          const daysFromNow = (date.getTime() - Date.now()) / 86400000;
          if (daysFromNow < -7 || daysFromNow > 100)
            throw new RouteProviderError(
              'INVALID_INPUT',
              'Google transit departures must be within 7 days in the past or 100 days in the future.',
            );
        }
      }
      const warnings = [
        'Route durations are estimates. Parking price, legality and availability, and toll amounts must be supplied and verified separately.',
      ];
      const base: GoogleComputeRequest = {
        origin,
        destination,
        travelMode: request.mode === 'drive' ? 'DRIVING' : 'TRANSIT',
        fields: [
          'description',
          'distanceMeters',
          'durationMillis',
          'path',
          'viewport',
          'legs',
          'warnings',
        ],
        computeAlternativeRoutes: waypoints.length === 0,
        language: 'en',
        region: 'NZ',
      };
      if (request.mode === 'drive') {
        base.routingPreference = this.options.trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE';
        // Free-flow time is in the same SKU; the difference is the traffic delay.
        if (this.options.trafficAware) base.fields.push('staticDurationMillis');
      } else {
        // The JavaScript Route SDK accepts Route property names here. Its field
        // validation rejects the REST-style nested travelAdvisory.transitFare mask.
        if (this.options.useGoogleTransitFare !== false) base.fields.push('travelAdvisory');
        base.transitPreference = { allowedTransitModes: ['BUS', 'RAIL'] };
      }
      if (waypoints.length)
        base.intermediates = waypoints.map((location) => ({ location: locationValue(location) }));
      const timeAware = request.mode === 'transit' || this.options.trafficAware === true;
      if (request.mode === 'drive' && !timeAware)
        warnings.push(
          'This request uses traffic-unaware driving to limit API costs. Selected departure and return times do not affect traffic estimates.',
        );
      if (request.departureTime && timeAware) base.departureTime = request.departureTime;
      if (request.roundTrip && !request.returnTime)
        throw new RouteProviderError(
          'INVALID_INPUT',
          'Choose an independent return departure time for a round trip.',
        );
      if (
        this.metrics.routeRequests + (request.roundTrip ? 2 : 1) >
        (this.options.maxRouteRequests ?? 30)
      ) {
        throw new RouteProviderError(
          'QUOTA_EXCEEDED',
          'The local session has insufficient route requests left for this journey. Continue with Manual Mode.',
        );
      }
      const outbound = await this.compute(base);
      let inbound: GoogleRouteData[] = [];
      let returnStatus: RouteResult['returnStatus'];
      if (request.roundTrip) {
        try {
          inbound = await this.compute({
            ...base,
            origin: destination,
            destination: origin,
            intermediates: base.intermediates ? [...base.intermediates].reverse() : undefined,
            departureTime: timeAware ? request.returnTime : undefined,
          });
          returnStatus = 'routed';
          warnings.push(
            'Outbound alternatives are paired with the primary independently requested return route. Return alternatives are not exhaustively combined.',
          );
        } catch (error) {
          // A found outbound route stays useful when no return exists at the chosen time.
          const readable = readableError(error);
          if (readable.code !== 'NO_ROUTES') throw readable;
          returnStatus = 'no-routes';
          this.metrics.routeErrors += 1;
          this.metrics.lastError = readable.code;
        }
      }
      warnings.push(...this.computationWarnings);
      // Responses are kept by request; the map is left as it is until a route is drawn.
      const response = `response-${this.metrics.routeRequests}`;
      this.responseOrder.push(response);
      for (const stale of this.responseOrder.splice(0, Math.max(0, this.responseOrder.length - 8)))
        for (const [routeId, owner] of this.routeResponse)
          if (owner === stale) {
            this.routeResponse.delete(routeId);
            this.sdkRoutes.delete(routeId);
          }
      const routes = outbound.map((route, index): JourneyOption => {
        const id = `google-${request.mode}-${this.metrics.routeRequests}-${index}`;
        this.sdkRoutes.set(id, route);
        this.routeResponse.set(id, response);
        warnings.push(...(route.warnings ?? []));
        const inboundRoute = inbound[0];
        if (inboundRoute) warnings.push(...(inboundRoute.warnings ?? []));
        const outboundLegs = this.toLegs(route, request.mode, request.departureTime);
        const inboundLegs = inboundRoute
          ? this.toLegs(inboundRoute, request.mode, request.returnTime)
          : [];
        return {
          id,
          name: route.description ?? `Google ${request.mode} route ${index + 1}`,
          mode: request.mode,
          outbound: outboundLegs,
          inbound: inboundLegs,
          parkingCost: 0,
          parkingVerified: false,
          waypoints,
          ...(inboundRoute ? { returnBasis: 'routed' as const } : {}),
        };
      });
      const agencies = [...outbound, ...inbound].flatMap(
        (route) =>
          route.legs?.flatMap(
            (leg) =>
              leg.steps?.flatMap((step) => step.transitDetails?.transitLine?.agencies ?? []) ?? [],
          ) ?? [],
      );
      const safeAgencyLinks = agencies.flatMap((agency) => {
        if (!agency.name || !agency.url) return [];
        try {
          const url = new URL(String(agency.url));
          return ['https:', 'http:'].includes(url.protocol)
            ? [{ label: agency.name, url: url.href }]
            : [];
        } catch {
          return [];
        }
      });
      const attributionLinks = [
        ...new Map(safeAgencyLinks.map((link) => [link.url, link])).values(),
      ];
      const agencyNames = [
        ...new Set(agencies.flatMap((agency) => (agency.name ? [agency.name] : []))),
      ];
      return {
        routes,
        warnings: [...new Set(warnings)],
        attribution: ['Google Maps', ...agencyNames].join(' · '),
        attributionLinks,
        requestCount: this.metrics.routeRequests,
        ...(returnStatus ? { returnStatus } : {}),
      };
    } catch (error) {
      const readable = readableError(error);
      this.metrics.routeErrors += 1;
      this.metrics.lastError = readable.code;
      throw readable;
    } finally {
      this.busy = false;
    }
  }
}
