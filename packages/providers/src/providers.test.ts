import { describe, expect, it, vi } from 'vitest';
import type { JourneyOption } from '@smart-commute/core';
import {
  ATFareProvider,
  AT_FARE_RULES,
  DATA_SOURCES,
  GoogleRouteProvider,
  ManualRouteProvider,
  sourceNeedsReview,
} from './index';
import type {
  FarePayment,
  GoogleComputeRequest,
  GoogleRouteData,
  PassengerType,
  RouteRequest,
} from './index';

const request: RouteRequest = {
  origin: { label: 'User origin' },
  destination: { label: 'User destination' },
  mode: 'drive',
};
const example: JourneyOption = {
  id: 'user-route',
  name: 'My route',
  mode: 'drive',
  outbound: [
    { mode: 'drive', durationMinutes: 20, distanceKm: 10, source: 'manual', estimated: true },
  ],
  inbound: [],
  parkingCost: 0,
  waypoints: [],
};
const drive = (distanceMeters: number, durationMillis = 1200000): GoogleRouteData => ({
  distanceMeters,
  durationMillis,
  warnings: ['Test response warning'],
});
const nzWeekday = new Date('2026-10-09T08:00:00+13:00');

function mockGoogle(responses: GoogleRouteData[][]) {
  const computeRoutes =
    vi.fn<(input: GoogleComputeRequest) => Promise<{ routes: GoogleRouteData[] }>>();
  for (const routes of responses) computeRoutes.mockResolvedValueOnce({ routes });
  const loadLibrary = vi.fn().mockResolvedValue({ Route: { computeRoutes } });
  const provider = new GoogleRouteProvider({ apiKey: 'test-key-never-sent', loadLibrary });
  return { provider, computeRoutes, loadLibrary };
}

describe('manual adapter', () => {
  it('requires explicit measurements and never synthesizes an API route', async () => {
    await expect(new ManualRouteProvider().getRoutes(request)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    const result = await new ManualRouteProvider().getRoutes({
      ...request,
      manualRoutes: [example],
    });
    expect(result.routes[0]?.outbound[0]?.distanceKm).toBe(10);
    expect(result.requestCount).toBe(0);
    expect(result.attribution).toContain('Manual');
    expect(result.routes[0]).not.toBe(example);
  });
  it('rejects invalid manual measurements', async () => {
    await expect(
      new ManualRouteProvider().getRoutes({
        ...request,
        manualRoutes: [{ ...example, parkingCost: -1 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it.each([
    ['empty outbound', [{ ...example, outbound: [] }]],
    [
      'missing driving distance',
      [{ ...example, outbound: [{ ...example.outbound[0]!, distanceKm: undefined }] }],
    ],
    [
      'fractional transfers',
      [{ ...example, outbound: [{ ...example.outbound[0]!, transfers: 0.5 }] }],
    ],
    [
      'invalid waypoint coordinates',
      [
        {
          ...example,
          waypoints: [{ label: 'Invalid waypoint', coordinates: { lat: 91, lng: 0 } }],
        },
      ],
    ],
    ['duplicate identifiers', [example, example]],
  ])('rejects %s before returning a route to the cost engine', async (_case, routes) => {
    await expect(
      new ManualRouteProvider().getRoutes({ ...request, manualRoutes: routes as JourneyOption[] }),
    ).rejects.toMatchObject({ name: 'RouteProviderError', code: 'INVALID_INPUT' });
  });
});

describe('Google adapter without external paid requests', () => {
  it('does not load or request anything without a key', async () => {
    const loadLibrary = vi.fn();
    const provider = new GoogleRouteProvider({ loadLibrary });
    await expect(provider.getRoutes(request)).rejects.toMatchObject({ code: 'MISSING_KEY' });
    expect(loadLibrary).not.toHaveBeenCalled();
    expect(provider.getMetrics().routeRequests).toBe(0);
  });
  it('maps alternatives and fetches the return independently, reversing waypoints', async () => {
    const { provider, computeRoutes } = mockGoogle([
      [drive(19000), drive(21000)],
      [drive(22000, 1800000)],
    ]);
    const result = await provider.getRoutes({
      ...request,
      roundTrip: true,
      returnTime: nzWeekday,
      waypoints: [{ label: 'My waypoint' }],
    });
    expect(computeRoutes).toHaveBeenCalledTimes(2);
    expect(computeRoutes.mock.calls[0]?.[0].computeAlternativeRoutes).toBe(false);
    expect(computeRoutes.mock.calls[0]?.[0].departureTime).toBeUndefined();
    expect(computeRoutes.mock.calls[1]?.[0].departureTime).toBeUndefined();
    expect(computeRoutes.mock.calls[1]?.[0].origin).toBe('User destination');
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]?.outbound[0]?.distanceKm).toBe(19);
    expect(result.routes[0]?.inbound[0]?.distanceKm).toBe(22);
    expect(result.routes[0]?.inbound[0]?.durationMinutes).toBe(30);
    expect(result.warnings).toContain('Test response warning');
    expect(result.attribution).toBe('Google Maps');
  });
  it('requires a return time before making any paid requests', async () => {
    const { provider, computeRoutes } = mockGoogle([[drive(1000)]]);
    await expect(provider.getRoutes({ ...request, roundTrip: true })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(computeRoutes).not.toHaveBeenCalled();
  });
  it('rejects transit waypoints and invalid coordinates before requesting', async () => {
    const { provider, computeRoutes } = mockGoogle([]);
    await expect(
      provider.getRoutes({ ...request, mode: 'transit', waypoints: [{ label: 'Station' }] }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(
      provider.getRoutes({
        ...request,
        origin: { label: 'Invalid', coordinates: { lat: 91, lng: 0 } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(computeRoutes).not.toHaveBeenCalled();
  });
  it('reports an absent route and counts the request/error', async () => {
    const { provider } = mockGoogle([[]]);
    await expect(provider.getRoutes(request)).rejects.toMatchObject({ code: 'NO_ROUTES' });
    expect(provider.getMetrics()).toMatchObject({
      routeRequests: 1,
      routeErrors: 1,
      lastError: 'NO_ROUTES',
    });
  });
  it('turns denied and quota API errors into actionable manual fallback messages', async () => {
    for (const [message, code] of [
      ['REQUEST_DENIED invalid API key', 'REQUEST_DENIED'],
      ['429 RESOURCE_EXHAUSTED quota', 'QUOTA_EXCEEDED'],
    ]) {
      const { provider, computeRoutes } = mockGoogle([]);
      computeRoutes.mockRejectedValue(new Error(message));
      await expect(provider.getRoutes(request)).rejects.toMatchObject({ code });
      expect(provider.getMetrics().routeRequests).toBe(1);
    }
  });
  it('models walking and waiting, assigns one complete fare, and counts transfers', async () => {
    const { provider } = mockGoogle([
      [
        {
          distanceMeters: 12000,
          durationMillis: 2400000,
          legs: [
            {
              steps: [
                { travelMode: 'WALKING', staticDurationMillis: 300000, distanceMeters: 500 },
                {
                  travelMode: 'TRANSIT',
                  staticDurationMillis: 600000,
                  transitDetails: { transitLine: { vehicle: { vehicleType: 'BUS' } } },
                },
                {
                  travelMode: 'TRANSIT',
                  staticDurationMillis: 900000,
                  transitDetails: { transitLine: { vehicle: { vehicleType: 'HEAVY_RAIL' } } },
                },
              ],
            },
          ],
          travelAdvisory: { transitFare: { currencyCode: 'NZD', units: 4, nanos: 900000000 } },
        },
      ],
    ]);
    const result = await provider.getRoutes({ ...request, mode: 'transit' });
    const legs = result.routes[0]!.outbound;
    expect(legs.map((leg) => leg.mode)).toEqual(['walk', 'bus', 'train', 'wait']);
    expect(legs.reduce((sum, leg) => sum + leg.durationMinutes, 0)).toBe(40);
    expect(legs.reduce((sum, leg) => sum + (leg.fare ?? 0), 0)).toBe(4.9);
    expect(legs.reduce((sum, leg) => sum + (leg.transfers ?? 0), 0)).toBe(1);
  });
  it('never invents an absent transit fare', async () => {
    const { provider } = mockGoogle([
      [
        {
          distanceMeters: 1000,
          durationMillis: 600000,
          legs: [
            {
              steps: [
                {
                  travelMode: 'TRANSIT',
                  staticDurationMillis: 600000,
                  transitDetails: { transitLine: { vehicle: { vehicleType: 'BUS' } } },
                },
              ],
            },
          ],
        },
      ],
    ]);
    await expect(provider.getRoutes({ ...request, mode: 'transit' })).rejects.toMatchObject({
      code: 'INCOMPLETE_RESULT',
    });
  });
  it('preserves agency attribution and emits only safe HTTP(S) links', async () => {
    const { provider } = mockGoogle([
      [
        {
          distanceMeters: 1000,
          durationMillis: 600000,
          legs: [
            {
              steps: [
                {
                  travelMode: 'TRANSIT',
                  staticDurationMillis: 600000,
                  transitDetails: {
                    transitLine: {
                      vehicle: { vehicleType: 'BUS' },
                      agencies: [
                        { name: 'Safe agency', url: 'https://at.govt.nz/' },
                        { name: 'Plain attribution', url: 'javascript:alert(1)' },
                      ],
                    },
                  },
                },
              ],
            },
          ],
          travelAdvisory: { transitFare: { currencyCode: 'NZD', units: 3 } },
        },
      ],
    ]);
    const result = await provider.getRoutes({ ...request, mode: 'transit' });
    expect(result.attribution).toContain('Plain attribution');
    expect(result.attributionLinks).toEqual([{ label: 'Safe agency', url: 'https://at.govt.nz/' }]);
  });
  it('preflights the round-trip session limit instead of spending on a partial journey', async () => {
    const loadLibrary = vi.fn();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary,
      maxRouteRequests: 1,
    });
    await expect(
      provider.getRoutes({ ...request, roundTrip: true, returnTime: nzWeekday }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(loadLibrary).not.toHaveBeenCalled();
  });
  it('uses the official nested polyline options and clears Google map overlays on disposal', async () => {
    const setMap = vi.fn();
    const createPolylines = vi.fn().mockReturnValue([{ setMap }]);
    class TestMap {
      fitBounds = vi.fn();
    }
    const loadLibrary = vi.fn().mockImplementation(async (name: string) =>
      name === 'maps'
        ? { Map: TestMap }
        : {
            Route: {
              computeRoutes: async () => ({ routes: [{ ...drive(1000), createPolylines }] }),
            },
          },
    );
    const provider = new GoogleRouteProvider({ apiKey: 'test-key', loadLibrary });
    await provider.initializeMap(document.createElement('div'));
    const result = await provider.getRoutes(request);
    provider.renderRoute(result.routes[0]!.id);
    expect(createPolylines).toHaveBeenCalledWith({
      polylineOptions: { strokeColor: '#166a5b', strokeWeight: 5 },
    });
    expect(setMap.mock.calls[0]?.[0]).toBeInstanceOf(TestMap);
    provider.dispose();
    expect(setMap).toHaveBeenLastCalledWith(null);
  });
  it('rejects past traffic-aware driving and out-of-range transit before requesting', async () => {
    const loadLibrary = vi.fn();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary,
      trafficAware: true,
    });
    await expect(
      provider.getRoutes({ ...request, departureTime: new Date(Date.now() - 86400000) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      provider.getRoutes({
        ...request,
        mode: 'transit',
        departureTime: new Date(Date.now() + 101 * 86400000),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(loadLibrary).not.toHaveBeenCalled();
  });
});

describe('verified AT rule snapshot', () => {
  const provider = new ATFareProvider();
  it('uses dated zone fares and caps 4+ zones without charging each transfer separately', () => {
    expect(AT_FARE_RULES.effectiveFrom).toBe('2026-02-01');
    expect(
      provider.getFare(
        {
          zones: 2,
          payment: 'hop',
          samePaymentMethod: true,
          transferGapsMinutes: [20],
          journeyDurationMinutes: 60,
        },
        'adult',
        nzWeekday,
      ).amount,
    ).toBe(4.9);
    expect(provider.getFare({ zones: 9, payment: 'hop' }, 'adult', nzWeekday).amount).toBe(7.9);
  });
  it('uses published concession tables, including Community Connect', () => {
    expect(
      provider.getFare(
        { zones: 1, payment: 'hop', concessionRegistered: true },
        'tertiary',
        nzWeekday,
      ).amount,
    ).toBe(1.55);
    expect(
      provider.getFare(
        { zones: 2, payment: 'hop', concessionRegistered: true },
        'community',
        nzWeekday,
      ).amount,
    ).toBe(2.45);
    expect(
      provider.getFare(
        { zones: 2, payment: 'contactless', concessionRegistered: true },
        'community',
        nzWeekday,
      ).amount,
    ).toBe(4.9);
  });
  it('applies only the supplied spend in the appropriate cap period', () => {
    expect(
      provider.getFare(
        { zones: 4, payment: 'hop', hopSpendInCurrentPeriod: 48 },
        'adult',
        nzWeekday,
      ).amount,
    ).toBe(2);
    expect(
      provider.getFare(
        { zones: 4, payment: 'contactless', contactlessSpendToday: 19 },
        'adult',
        nzWeekday,
      ).amount,
    ).toBe(1);
    expect(
      provider.getFare(
        { zones: 4, payment: 'cash', hopSpendInCurrentPeriod: 50 },
        'adult',
        nzWeekday,
      ).amount,
    ).toBe(10);
  });
  it('requires manual fares for unknown zones, expired snapshots and ineligible transfers', () => {
    expect(provider.getFare({ payment: 'hop' }, 'adult', nzWeekday).requiresManualInput).toBe(true);
    expect(
      provider.getFare(
        {
          zones: 2,
          payment: 'hop',
          samePaymentMethod: true,
          transferGapsMinutes: [31],
          journeyDurationMinutes: 60,
        },
        'adult',
        nzWeekday,
      ).amount,
    ).toBeNull();
    expect(
      provider.getFare({ zones: 2, payment: 'hop' }, 'adult', new Date('2027-02-01T09:00:00+13:00'))
        .amount,
    ).toBeNull();
  });
  it('uses Auckland local time for SuperGold and weekend child travel', () => {
    expect(
      provider.getFare(
        { zones: 2, payment: 'hop', concessionRegistered: true },
        'supergold',
        new Date('2026-10-09T09:00:00+13:00'),
      ).amount,
    ).toBe(0);
    expect(
      provider.getFare(
        { zones: 2, payment: 'hop', concessionRegistered: true },
        'supergold',
        nzWeekday,
      ).amount,
    ).toBe(4.9);
    expect(
      provider.getFare(
        { zones: 2, payment: 'hop', concessionRegistered: true },
        'child',
        new Date('2026-10-10T08:00:00+13:00'),
      ).amount,
    ).toBe(0);
    expect(
      provider.getFare(
        { zones: 2, payment: 'cash' },
        'child',
        new Date('2026-10-10T08:00:00+13:00'),
      ).amount,
    ).toBe(3.5);
    expect(
      provider.getFare(
        { zones: 2, payment: 'contactless' },
        'child',
        new Date('2026-10-10T08:00:00+13:00'),
      ).amount,
    ).toBe(4.9);
  });
  it('requires manual verification for paper-ticket concessions and rejects unknown runtime categories', () => {
    expect(
      provider.getFare({ zones: 2, payment: 'cash' }, 'secondary', nzWeekday).amount,
    ).toBeNull();
    expect(
      provider.getFare({ zones: 2, payment: 'cash' }, 'accessible', nzWeekday).amount,
    ).toBeNull();
    expect(
      provider.getFare({ zones: 2, payment: 'unknown' as FarePayment }, 'adult', nzWeekday).amount,
    ).toBeNull();
    expect(
      provider.getFare(
        { zones: 2, payment: 'hop', concessionRegistered: true },
        'unknown' as PassengerType,
        nzWeekday,
      ).amount,
    ).toBeNull();
  });
  it('lets explicitly supplied manual fares override rule inference without representing them as official', () => {
    const quote = provider.getFare(
      { zones: 2, payment: 'hop', manualFare: 6.5 },
      'adult',
      nzWeekday,
    );
    expect(quote).toMatchObject({ amount: 6.5, source: 'manual', estimated: true });
    expect(
      provider.getFare({ payment: 'hop', manualFare: -1 }, 'adult', nzWeekday).amount,
    ).toBeNull();
  });
  it('distinguishes researched catalogs from integrated datasets and tracks freshness', () => {
    const gis = DATA_SOURCES.find((source) => source.id === 'at-gis')!;
    expect(gis.status).toBe('catalog-only');
    expect(gis.redistribution).toBe('unverified');
    expect(sourceNeedsReview(gis, new Date('2027-02-01'))).toBe(true);
  });
});
