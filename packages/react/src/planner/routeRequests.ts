import { estimateReturnLegs, type JourneyOption, type Location } from '@smart-commute/core';
import {
  RouteProviderError,
  type RouteErrorCode,
  type RouteResult as ProviderRouteResult,
} from '@smart-commute/providers';
import { LEAVE_NOW_CACHE_MS, ROUTE_CACHE_SIZE } from './constants';
import { type Direction, type LiveMode, type RouteStatus } from './types';

const placeKey = (place: Location) => [
  place.label.trim(),
  place.coordinates?.lat ?? null,
  place.coordinates?.lng ?? null,
];

export interface RouteQuery {
  origin: Location;
  destination: Location;
  /** Driving stops; transit never takes them, so they do not change a transit query. */
  waypoints: Location[];
  mode: LiveMode;
  leaveNow: boolean;
  departureAt?: number;
  /** Set only when a return is routed at a chosen time rather than estimated. */
  routedReturn: boolean;
  returnAt?: number;
}

/** Everything that changes which routes come back; cost inputs only change prices. */
export const routeQueryKey = (query: RouteQuery) =>
  JSON.stringify({
    origin: placeKey(query.origin),
    destination: placeKey(query.destination),
    waypoints: query.mode === 'drive' ? query.waypoints.map(placeKey) : [],
    mode: query.mode,
    departure: query.leaveNow ? 'now' : (query.departureAt ?? null),
    return: query.routedReturn ? { at: query.returnAt ?? null } : 'outbound-only',
  });

/** A status describes the conditions it was for; for any other conditions nothing is known yet. */
export const statusForQuery = (status: RouteStatus, key: string): RouteStatus =>
  status.state !== 'idle' && status.key === key ? status : { state: 'idle' };

export interface CachedRoutes {
  response: ProviderRouteResult;
  requestedAt: number;
  leaveNow: boolean;
  selectedId?: string;
}

/**
 * Recent results by query key. A scheduled result stays valid for its instant; a leave-now
 * result goes stale, so it is never shown as today's routes long after it was requested.
 */
export class RouteCache {
  private readonly entries = new Map<string, CachedRoutes>();

  constructor(
    private readonly size = ROUTE_CACHE_SIZE,
    private readonly leaveNowMaxAge = LEAVE_NOW_CACHE_MS,
  ) {}

  fresh(key: string, now = Date.now()): CachedRoutes | undefined {
    const entry = this.entries.get(key);
    if (!entry || (entry.leaveNow && now - entry.requestedAt > this.leaveNowMaxAge)) return;
    return entry;
  }

  store(key: string, response: ProviderRouteResult, leaveNow: boolean, now = Date.now()) {
    this.entries.set(key, { response, requestedAt: now, leaveNow });
    for (const stale of [...this.entries.keys()].slice(0, -this.size)) this.entries.delete(stale);
  }

  /** Remembers the chosen alternative, so returning to these conditions reselects it. */
  select(key: string, routeId: string) {
    const entry = this.entries.get(key);
    if (entry) entry.selectedId = routeId;
  }

  clear() {
    this.entries.clear();
  }
}

/**
 * Requests run one at a time. A mode chosen while one runs, or before the map is ready,
 * waits here; only the latest choice runs next and anything chosen in between is dropped.
 */
export class RouteRequestQueue {
  private inFlight: string | null = null;
  private queued: LiveMode | null = null;

  /** Starts a request for this key, or queues the mode behind the running one. */
  begin(key: string, mode: LiveMode): 'start' | 'queued' {
    if (this.inFlight) {
      this.queued = mode;
      return 'queued';
    }
    this.inFlight = key;
    return 'start';
  }

  /** Holds a choice until requests can run, such as while the map is loading. */
  defer(mode: LiveMode) {
    this.queued = mode;
  }

  /** Ends the running request and hands back the choice to run next, if any. */
  finish(): LiveMode | null {
    this.inFlight = null;
    return this.take();
  }

  take(): LiveMode | null {
    const next = this.queued;
    this.queued = null;
    return next;
  }

  reset() {
    this.inFlight = null;
    this.queued = null;
  }
}

/** Failures that mean live routing cannot work for now, so the planner offers manual mode. */
const MANUAL_FALLBACK_CODES: readonly RouteErrorCode[] = [
  'NETWORK_ERROR',
  'REQUEST_DENIED',
  'QUOTA_EXCEEDED',
];

/** An explicit empty answer is not a failure; anything else is an error with its code. */
export const failedRouteOutcome = (
  error: unknown,
):
  | { state: 'no-routes' }
  | { state: 'error'; code?: RouteErrorCode; useManualFallback: boolean } => {
  const code = error instanceof RouteProviderError ? error.code : undefined;
  if (code === 'NO_ROUTES') return { state: 'no-routes' };
  return {
    state: 'error',
    code,
    useManualFallback: Boolean(code && MANUAL_FALLBACK_CODES.includes(code)),
  };
};

/** Live options for a response: cost preferences applied, and a budget return when none was routed. */
export const liveOptions = (response: ProviderRouteResult, costs?: JourneyOption) =>
  response.routes.map((route) => {
    const option: JourneyOption =
      route.inbound.length === 0 && response.returnStatus === undefined
        ? {
            ...route,
            inbound: estimateReturnLegs(route.outbound),
            returnBasis: 'estimated-from-outbound',
          }
        : route;
    if (option.mode !== 'drive') return option;
    const toll = (direction: Direction) =>
      costs?.[direction].find((segment) => segment.mode === 'drive')?.toll ?? 0;
    return {
      ...option,
      parkingCost: costs?.parkingCost ?? 0,
      outbound: option.outbound.map((leg) =>
        leg.mode === 'drive' ? { ...leg, toll: toll('outbound') } : leg,
      ),
      inbound: option.inbound.map((leg) =>
        leg.mode === 'drive' ? { ...leg, toll: toll('inbound') } : leg,
      ),
    };
  });
