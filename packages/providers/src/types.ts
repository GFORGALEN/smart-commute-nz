import type { JourneyOption, Location } from '@smart-commute/core';

export type RouteErrorCode =
  | 'MISSING_KEY'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED'
  | 'QUOTA_EXCEEDED'
  | 'REQUEST_DENIED'
  | 'NETWORK_ERROR'
  | 'NO_ROUTES'
  | 'INCOMPLETE_RESULT'
  | 'BUSY';

export class RouteProviderError extends Error {
  constructor(
    public readonly code: RouteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RouteProviderError';
  }
}

export interface RouteRequest {
  origin: Location;
  destination: Location;
  mode: 'drive' | 'transit';
  waypoints?: Location[];
  departureTime?: Date;
  returnTime?: Date;
  roundTrip?: boolean;
  /** Explicit user supplied routes, used only by ManualRouteProvider. */
  manualRoutes?: JourneyOption[];
}

export interface RouteResult {
  routes: JourneyOption[];
  warnings: string[];
  attribution: string;
  attributionLinks?: { label: string; url: string }[];
  requestCount: number;
}

export interface ProviderMetrics {
  routeRequests: number;
  routeErrors: number;
  mapLoads: number;
  placeDetailsRequests: number;
  geocodingRequests: number;
  /** The Google autocomplete widget manages prediction requests itself. */
  autocompleteRequests: 'not-observable';
  lastError?: RouteErrorCode;
}

export interface RouteProvider {
  readonly id: string;
  getRoutes(request: RouteRequest): Promise<RouteResult>;
}
