import { describe, expect, it } from 'vitest';
import type { JourneyOption } from '@smart-commute/core';
import {
  RouteProviderError,
  type RouteResult as ProviderRouteResult,
} from '@smart-commute/providers';
import {
  failedRouteOutcome,
  liveOptions,
  RouteCache,
  routeQueryKey,
  RouteRequestQueue,
  statusForQuery,
  type RouteQuery,
} from './routeRequests';

const query: RouteQuery = {
  origin: { label: '4 Fong Road', coordinates: { lat: -36.95, lng: 174.93 } },
  destination: { label: 'Britomart' },
  waypoints: [{ label: 'Sylvia Park' }],
  mode: 'drive',
  leaveNow: true,
  routedReturn: false,
};

function googleDrive(overrides: Partial<JourneyOption> = {}): JourneyOption {
  return {
    id: 'google-drive-0',
    name: 'Google drive',
    mode: 'drive',
    parkingCost: 0,
    waypoints: [],
    outbound: [
      { mode: 'drive', distanceKm: 19, durationMinutes: 30, source: 'google', estimated: true },
    ],
    inbound: [],
    ...overrides,
  };
}

const response = (routes: JourneyOption[], extra: Partial<ProviderRouteResult> = {}) =>
  ({
    routes,
    warnings: [],
    attribution: 'Google',
    requestCount: 1,
    ...extra,
  }) as ProviderRouteResult;

describe('routeQueryKey', () => {
  it('separates modes so one mode never reuses the other mode’s routes', () => {
    expect(routeQueryKey(query)).not.toBe(routeQueryKey({ ...query, mode: 'transit' }));
  });

  it('ignores driving stops for transit, which cannot take them', () => {
    expect(routeQueryKey({ ...query, mode: 'transit' })).toBe(
      routeQueryKey({ ...query, mode: 'transit', waypoints: [] }),
    );
    expect(routeQueryKey(query)).not.toBe(routeQueryKey({ ...query, waypoints: [] }));
  });

  it('keys leave-now by intent, and a scheduled trip by its instant', () => {
    expect(routeQueryKey({ ...query, departureAt: 1 })).toBe(
      routeQueryKey({ ...query, departureAt: 2 }),
    );
    const scheduled = { ...query, leaveNow: false };
    expect(routeQueryKey({ ...scheduled, departureAt: 1 })).not.toBe(
      routeQueryKey({ ...scheduled, departureAt: 2 }),
    );
  });

  it('includes the return time only when the return is routed', () => {
    expect(routeQueryKey({ ...query, returnAt: 5 })).toBe(routeQueryKey(query));
    const routed = { ...query, routedReturn: true };
    expect(routeQueryKey({ ...routed, returnAt: 5 })).not.toBe(
      routeQueryKey({ ...routed, returnAt: 6 }),
    );
  });

  it('ignores surrounding spaces in place names', () => {
    expect(routeQueryKey({ ...query, destination: { label: '  Britomart ' } })).toBe(
      routeQueryKey(query),
    );
  });
});

describe('statusForQuery', () => {
  it('reports a status only for the conditions it was requested for', () => {
    const loading = { state: 'loading', key: 'a', mode: 'drive' } as const;
    expect(statusForQuery(loading, 'a')).toBe(loading);
    expect(statusForQuery(loading, 'b')).toEqual({ state: 'idle' });
    expect(statusForQuery({ state: 'idle' }, 'a')).toEqual({ state: 'idle' });
  });
});

describe('RouteCache', () => {
  it('expires leave-now results but keeps scheduled ones', () => {
    const cache = new RouteCache(8, 1000);
    cache.store('now', response([googleDrive()]), true, 0);
    cache.store('later', response([googleDrive()]), false, 0);
    expect(cache.fresh('now', 1000)).toBeDefined();
    expect(cache.fresh('now', 1001)).toBeUndefined();
    expect(cache.fresh('later', 10_000_000)).toBeDefined();
  });

  it('drops the oldest entries beyond its size', () => {
    const cache = new RouteCache(2);
    for (const key of ['a', 'b', 'c']) cache.store(key, response([]), false);
    expect(cache.fresh('a')).toBeUndefined();
    expect(cache.fresh('b')).toBeDefined();
    expect(cache.fresh('c')).toBeDefined();
  });

  it('remembers the chosen alternative for its conditions', () => {
    const cache = new RouteCache();
    cache.select('a', 'ignored');
    cache.store('a', response([googleDrive()]), false);
    cache.select('a', 'google-drive-1');
    expect(cache.fresh('a')?.selectedId).toBe('google-drive-1');
    cache.clear();
    expect(cache.fresh('a')).toBeUndefined();
  });
});

describe('RouteRequestQueue', () => {
  it('runs one request at a time and only the latest queued choice', () => {
    const queue = new RouteRequestQueue();
    expect(queue.begin('drive-key', 'drive')).toBe('start');
    // Drive → transit → drive while the first request runs: only the last choice is kept.
    expect(queue.begin('transit-key', 'transit')).toBe('queued');
    expect(queue.begin('drive-key', 'drive')).toBe('queued');
    expect(queue.finish()).toBe('drive');
    expect(queue.finish()).toBeNull();
    expect(queue.begin('transit-key', 'transit')).toBe('start');
  });

  it('holds a choice made before requests can run', () => {
    const queue = new RouteRequestQueue();
    queue.defer('transit');
    expect(queue.take()).toBe('transit');
    expect(queue.take()).toBeNull();
  });

  it('forgets everything on reset', () => {
    const queue = new RouteRequestQueue();
    queue.begin('a', 'drive');
    queue.begin('b', 'transit');
    queue.reset();
    expect(queue.take()).toBeNull();
    expect(queue.begin('c', 'drive')).toBe('start');
  });
});

describe('failedRouteOutcome', () => {
  it('treats an explicit empty answer as no routes, not a failure', () => {
    expect(failedRouteOutcome(new RouteProviderError('NO_ROUTES', 'none'))).toEqual({
      state: 'no-routes',
    });
  });

  it('offers manual mode only when live routing cannot work for now', () => {
    for (const code of ['NETWORK_ERROR', 'REQUEST_DENIED', 'QUOTA_EXCEEDED'] as const)
      expect(failedRouteOutcome(new RouteProviderError(code, code))).toEqual({
        state: 'error',
        code,
        useManualFallback: true,
      });
    expect(failedRouteOutcome(new RouteProviderError('INVALID_INPUT', 'bad'))).toEqual({
      state: 'error',
      code: 'INVALID_INPUT',
      useManualFallback: false,
    });
    expect(failedRouteOutcome(new Error('unknown'))).toEqual({
      state: 'error',
      code: undefined,
      useManualFallback: false,
    });
  });
});

describe('liveOptions', () => {
  it('estimates a return from the outbound route when none was requested', () => {
    const [option] = liveOptions(response([googleDrive()]));
    expect(option?.returnBasis).toBe('estimated-from-outbound');
    expect(option?.inbound).toHaveLength(1);
  });

  it('never invents a return when a requested return found no routes', () => {
    const [option] = liveOptions(response([googleDrive()], { returnStatus: 'no-routes' }));
    expect(option?.returnBasis).toBeUndefined();
    expect(option?.inbound).toEqual([]);
  });

  it('applies the person’s parking and tolls to live driving routes', () => {
    const costs = googleDrive({
      id: 'drive',
      parkingCost: 12,
      outbound: [
        { mode: 'drive', toll: 2.4, durationMinutes: 1, source: 'manual', estimated: true },
      ],
      inbound: [
        { mode: 'drive', toll: 2.6, durationMinutes: 1, source: 'manual', estimated: true },
      ],
    });
    const [option] = liveOptions(response([googleDrive()]), costs);
    expect(option?.parkingCost).toBe(12);
    expect(option?.outbound[0]?.toll).toBe(2.4);
    expect(option?.inbound[0]?.toll).toBe(2.6);
  });

  it('leaves transit routes without driving costs', () => {
    const transit = googleDrive({
      id: 'google-transit-0',
      mode: 'transit',
      parkingCost: 0,
      outbound: [
        { mode: 'bus', fare: 4.9, durationMinutes: 40, source: 'google', estimated: true },
      ],
    });
    const [option] = liveOptions(response([transit]), googleDrive({ parkingCost: 12 }));
    expect(option?.parkingCost).toBe(0);
  });
});
