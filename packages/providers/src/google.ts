import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { JourneyOption, Location, TravelLeg } from '@smart-commute/core';
import type { ProviderMetrics, RouteProvider, RouteRequest, RouteResult } from './types';
import { RouteProviderError } from './types';

type LibraryName = 'maps' | 'core' | 'routes' | 'places' | 'geocoding';
export type GoogleLibraryLoader = (name: LibraryName) => Promise<unknown>;

/** Projections of the official SDK response, also usable as deterministic fixtures. */
export interface GoogleRouteStep {
  distanceMeters?: number;
  staticDurationMillis?: number;
  travelMode?: string;
  transitDetails?: {
    departureTime?: Date;
    arrivalTime?: Date;
    transitLine?: {
      vehicle?: { vehicleType?: string };
      agencies?: { name?: string; url?: URL | string }[];
    };
  };
}
export interface GoogleRouteData {
  description?: string;
  distanceMeters?: number;
  durationMillis?: number;
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
  /** Injectable SDK loader for deterministic tests without paid requests. */
  loadLibrary?: GoogleLibraryLoader;
  maxRouteRequests?: number;
}

let configuredKey: string | undefined;

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
  const raw = error instanceof Error ? error.message : String(error);
  if (/quota|resource.exhausted|over.query.limit|429/i.test(raw)) {
    return new RouteProviderError(
      'QUOTA_EXCEEDED',
      'Google quota was reached. Continue with Manual Mode or check the project quota.',
    );
  }
  if (/denied|invalid.key|not.authorized|billing|403|api.key/i.test(raw)) {
    return new RouteProviderError(
      'REQUEST_DENIED',
      'Google rejected the request. Check key restrictions, enabled APIs and the account configuration. Manual Mode remains available.',
    );
  }
  if (/zero.results|not.found|no.route/i.test(raw))
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

/** Maps and route responses are kept only in memory for the active planning session. */
export class GoogleRouteProvider implements RouteProvider {
  readonly id = 'google';
  private readonly options: GoogleRouteProviderOptions;
  private sdkLoad?: Promise<void>;
  private busy = false;
  private map?: google.maps.Map;
  private polylines: google.maps.Polyline[] = [];
  private sdkRoutes = new Map<string, GoogleRouteData>();
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

  async initializeMap(element: HTMLElement): Promise<void> {
    try {
      const maps = (await this.load('maps')) as google.maps.MapsLibrary;
      this.map = new maps.Map(element, {
        center: { lat: -36.8485, lng: 174.7633 },
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });
      this.metrics.mapLoads += 1;
    } catch (error) {
      throw readableError(error);
    }
  }

  async attachAutocomplete(
    element: HTMLElement,
    onSelect: (location: Location) => void,
    onError?: (error: RouteProviderError) => void,
  ): Promise<() => void> {
    const places = (await this.load('places')) as google.maps.PlacesLibrary;
    const widget = new places.PlaceAutocompleteElement({ includedRegionCodes: ['nz'] });
    let active = true;
    widget.setAttribute('aria-label', 'Search a New Zealand address');
    const listener = (event: Event) => {
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
          if (active)
            onSelect({ label: place.formattedAddress ?? '', coordinates: place.location.toJSON() });
        } catch (error) {
          if (active) onError?.(readableError(error));
        }
      })();
    };
    const errorListener = () =>
      onError?.(
        new RouteProviderError(
          'NETWORK_ERROR',
          'Address search failed. Enter the address manually.',
        ),
      );
    widget.addEventListener('gmp-select', listener);
    widget.addEventListener('gmp-error', errorListener);
    element.appendChild(widget);
    return () => {
      active = false;
      widget.removeEventListener('gmp-select', listener);
      widget.removeEventListener('gmp-error', errorListener);
      widget.remove();
    };
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

  clearMapRoutes(): void {
    for (const polyline of this.polylines) polyline.setMap(null);
    this.polylines = [];
  }

  renderRoute(id: string): void {
    this.clearMapRoutes();
    const route = this.sdkRoutes.get(id);
    if (!this.map || !route) return;
    this.polylines =
      route.createPolylines?.({ polylineOptions: { strokeColor: '#166a5b', strokeWeight: 5 } }) ??
      [];
    for (const polyline of this.polylines) polyline.setMap(this.map);
    if (route.viewport) this.map.fitBounds(route.viewport);
  }

  dispose(): void {
    this.clearMapRoutes();
    this.sdkRoutes.clear();
    this.map = undefined;
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

  private toLegs(route: GoogleRouteData, mode: 'drive' | 'transit'): TravelLeg[] {
    if (!nonnegative(route.durationMillis) || !nonnegative(route.distanceMeters)) {
      throw new RouteProviderError(
        'INCOMPLETE_RESULT',
        'Google did not return a usable route distance and duration. Enter measurements manually.',
      );
    }
    if (mode === 'drive')
      return [
        {
          mode: 'drive',
          distanceKm: route.distanceMeters / 1000,
          durationMinutes: route.durationMillis / 60000,
          source: 'google',
          estimated: true,
        },
      ];
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
      return {
        mode: travelMode,
        distanceKm: nonnegative(step.distanceMeters) ? step.distanceMeters / 1000 : undefined,
        durationMinutes: duration / 60000,
        transfers,
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
    const fare = route.travelAdvisory?.transitFare;
    const amount =
      fare?.currencyCode === 'NZD' ? (fare.units ?? 0) + (fare.nanos ?? 0) / 1e9 : undefined;
    const firstTransit = legs.find((leg) => leg.mode === 'bus' || leg.mode === 'train');
    if (firstTransit && nonnegative(amount)) firstTransit.fare = amount;
    else
      throw new RouteProviderError(
        'INCOMPLETE_RESULT',
        'Google did not return a complete NZD fare. Enter a manual journey fare or use AT rules with a verified zone count; missing fare is not free travel.',
      );
    return legs;
  }

  async getRoutes(request: RouteRequest): Promise<RouteResult> {
    if (this.busy) throw new RouteProviderError('BUSY', 'A route request is already running.');
    this.busy = true;
    try {
      this.computationWarnings = [];
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
          'travelAdvisory.transitFare',
        ],
        computeAlternativeRoutes: waypoints.length === 0,
        language: 'en',
        region: 'NZ',
      };
      if (request.mode === 'drive')
        base.routingPreference = this.options.trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE';
      else base.transitPreference = { allowedTransitModes: ['BUS', 'RAIL'] };
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
      if (request.roundTrip) {
        inbound = await this.compute({
          ...base,
          origin: destination,
          destination: origin,
          intermediates: base.intermediates ? [...base.intermediates].reverse() : undefined,
          departureTime: timeAware ? request.returnTime : undefined,
        });
        warnings.push(
          'Outbound alternatives are paired with the primary independently requested return route. Return alternatives are not exhaustively combined.',
        );
      }
      this.sdkRoutes.clear();
      this.clearMapRoutes();
      warnings.push(...this.computationWarnings);
      const routes = outbound.map((route, index): JourneyOption => {
        const id = `google-${request.mode}-${this.metrics.routeRequests}-${index}`;
        this.sdkRoutes.set(id, route);
        warnings.push(...(route.warnings ?? []));
        const inboundRoute = inbound[0];
        if (inboundRoute) warnings.push(...(inboundRoute.warnings ?? []));
        return {
          id,
          name: route.description ?? `Google ${request.mode} route ${index + 1}`,
          mode: request.mode,
          outbound: this.toLegs(route, request.mode),
          inbound: inboundRoute ? this.toLegs(inboundRoute, request.mode) : [],
          parkingCost: 0,
          parkingVerified: false,
          waypoints,
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
      };
    } catch (error) {
      const readable = readableError(error);
      this.sdkRoutes.clear();
      this.clearMapRoutes();
      this.metrics.routeErrors += 1;
      this.metrics.lastError = readable.code;
      throw readable;
    } finally {
      this.busy = false;
    }
  }
}
