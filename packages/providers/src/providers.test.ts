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
  it.each([
    ['UNAUTHENTICATED', 'REQUEST_DENIED', 'key restrictions'],
    ['PERMISSION_DENIED', 'REQUEST_DENIED', 'enabled APIs'],
    ['RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED', 'quota'],
    ['INVALID_ARGUMENT', 'INVALID_INPUT', 'route inputs'],
    ['OUT_OF_RANGE', 'INVALID_INPUT', 'departure times'],
    ['NOT_FOUND', 'NO_ROUTES', 'no route'],
    ['ZERO_RESULTS', 'NO_ROUTES', 'no route'],
    ['UNAVAILABLE', 'NETWORK_ERROR', 'connectivity'],
  ])(
    'classifies SDK code %s even when the error message is generic',
    async (sdkCode, code, text) => {
      const { provider, computeRoutes } = mockGoogle([]);
      computeRoutes.mockRejectedValue(
        Object.assign(new Error('The SDK request failed.'), { code: sdkCode }),
      );
      await expect(provider.getRoutes(request)).rejects.toMatchObject({
        name: 'RouteProviderError',
        code,
        message: expect.stringContaining(text),
      });
      expect(provider.getMetrics()).toMatchObject({
        routeRequests: 1,
        routeErrors: 1,
        lastError: code,
      });
    },
  );
  it('recognizes structured SDK errors without relying on Error instanceof', async () => {
    const { provider, computeRoutes } = mockGoogle([]);
    computeRoutes.mockRejectedValue({ code: 'UNAUTHENTICATED', message: 'Request failed.' });
    await expect(provider.getRoutes(request)).rejects.toMatchObject({ code: 'REQUEST_DENIED' });
  });
  it('classifies SDK field validation failures without exposing raw URLs or credentials', async () => {
    const { provider, computeRoutes } = mockGoogle([]);
    computeRoutes.mockRejectedValue(
      Object.assign(
        new Error(
          'in property fields: contains invalid fields: travelAdvisory.transitFare https://example.test/?key=DO_NOT_DISPLAY',
        ),
        { name: 'InvalidValueError' },
      ),
    );
    const error = await provider.getRoutes(request).catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('SDK request fields'),
    });
    expect((error as Error).message).not.toContain('https://');
    expect((error as Error).message).not.toContain('DO_NOT_DISPLAY');
  });
  it('uses supported SDK Route field masks and requests transit advisory only for transit', async () => {
    const supportedFields = new Set([
      'description',
      'distanceMeters',
      'durationMillis',
      'path',
      'viewport',
      'legs',
      'warnings',
      'travelAdvisory',
    ]);
    const computeRoutes = vi.fn(async (input: GoogleComputeRequest) => {
      if (input.fields.some((field) => !supportedFields.has(field)))
        throw Object.assign(new Error('in property fields: contains invalid fields'), {
          name: 'InvalidValueError',
        });
      const transit: GoogleRouteData = {
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
        travelAdvisory: { transitFare: { currencyCode: 'NZD', units: 3 } },
      };
      return { routes: [input.travelMode === 'TRANSIT' ? transit : drive(1000)] };
    });
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({ Route: { computeRoutes } }),
    });
    expect((await provider.getRoutes(request)).routes).toHaveLength(1);
    const transit = await provider.getRoutes({ ...request, mode: 'transit' });
    expect(transit.routes[0]?.outbound[0]?.fare).toBe(3);
    expect(computeRoutes.mock.calls[0]?.[0].fields).not.toContain('travelAdvisory');
    expect(computeRoutes.mock.calls[1]?.[0].fields).toContain('travelAdvisory');
  });
  it('reports the autocomplete backend-denial event and removes its handler on cleanup', async () => {
    const widget = document.createElement('div');
    const onError = vi.fn();
    const loadLibrary = vi.fn().mockResolvedValue({
      PlaceAutocompleteElement: vi.fn(function () {
        return widget;
      }),
    });
    const provider = new GoogleRouteProvider({ apiKey: 'test-key', loadLibrary });
    const container = document.createElement('div');
    const cleanup = await provider.attachAutocomplete(container, vi.fn(), onError);
    widget.dispatchEvent(new Event('gmp-error'));
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: 'REQUEST_DENIED',
      message: expect.stringContaining('Places API (New)'),
    });
    expect(provider.getMetrics().routeRequests).toBe(0);
    cleanup();
    widget.dispatchEvent(new Event('gmp-error'));
    expect(onError).toHaveBeenCalledOnce();
    expect(container.childElementCount).toBe(0);
  });
  it('keeps canonical address text synchronized without reporting external updates as user input', async () => {
    const widget = Object.assign(document.createElement('div'), { value: '' });
    const onInput = vi.fn();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({
        PlaceAutocompleteElement: vi.fn(function () {
          return widget;
        }),
      }),
    });
    const container = document.createElement('div');
    const control = await provider.attachAutocomplete(container, vi.fn(), undefined, {
      initialValue: 'My saved origin',
      onInput,
      label: 'Origin',
    });
    expect(widget.value).toBe('My saved origin');
    expect(widget.getAttribute('aria-label')).toBe('Origin');
    control.setValue('My swapped destination');
    expect(widget.value).toBe('My swapped destination');
    expect(onInput).not.toHaveBeenCalled();
    widget.value = 'New typed address';
    widget.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(onInput).toHaveBeenCalledWith('New typed address');
    control();
    widget.value = 'After cleanup';
    widget.dispatchEvent(new Event('input'));
    control.setValue('Ignored');
    expect(onInput).toHaveBeenCalledOnce();
    expect(widget.value).toBe('After cleanup');
    expect(container.childElementCount).toBe(0);
  });
  it('does not overwrite a newer typed address when older Place details finish', async () => {
    const widget = Object.assign(document.createElement('div'), { value: '' });
    let completeDetails: () => void = () => undefined;
    const place = {
      formattedAddress: 'Old selected address',
      location: { toJSON: () => ({ lat: -36.84, lng: 174.76 }) },
      fetchFields: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            completeDetails = resolve;
          }),
      ),
    };
    const onSelect = vi.fn();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({
        PlaceAutocompleteElement: vi.fn(function () {
          return widget;
        }),
      }),
    });
    const control = await provider.attachAutocomplete(document.createElement('div'), onSelect);
    const select = Object.assign(new Event('gmp-select'), {
      placePrediction: { toPlace: () => place },
    });
    widget.dispatchEvent(select);
    widget.value = 'Newer typed address';
    widget.dispatchEvent(new Event('input'));
    completeDetails();
    await Promise.resolve();
    expect(onSelect).not.toHaveBeenCalled();
    expect(widget.value).toBe('Newer typed address');
    control();
  });
  it('sets selected formatted text and coordinates after the latest Place details resolve', async () => {
    const widget = Object.assign(document.createElement('div'), { value: '' });
    const place = {
      formattedAddress: 'Selected New Zealand address',
      location: { toJSON: () => ({ lat: -36.84, lng: 174.76 }) },
      fetchFields: vi.fn().mockResolvedValue(undefined),
    };
    const onSelect = vi.fn();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({
        PlaceAutocompleteElement: vi.fn(function () {
          return widget;
        }),
      }),
    });
    const control = await provider.attachAutocomplete(document.createElement('div'), onSelect);
    widget.dispatchEvent(
      Object.assign(new Event('gmp-select'), { placePrediction: { toPlace: () => place } }),
    );
    await Promise.resolve();
    expect(widget.value).toBe('Selected New Zealand address');
    expect(onSelect).toHaveBeenCalledWith({
      label: 'Selected New Zealand address',
      coordinates: { lat: -36.84, lng: 174.76 },
    });
    expect(place.fetchFields).toHaveBeenCalledWith({ fields: ['formattedAddress', 'location'] });
    control();
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
      addListener = vi.fn((_name: string, callback: () => void) => {
        queueMicrotask(callback);
        return { remove: vi.fn() };
      });
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
  it('waits for the first map idle event before declaring the map ready', async () => {
    let renderReady: (() => void) | undefined;
    const remove = vi.fn();
    class TestMap {
      addListener(name: string, callback: () => void) {
        expect(name).toBe('idle');
        renderReady = callback;
        return { remove };
      }
    }
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({ Map: TestMap }),
    });
    try {
      const ready = provider.initializeMap(document.createElement('div'));
      await vi.waitFor(() => expect(renderReady).toBeTypeOf('function'));
      expect(provider.getMetrics().mapLoads).toBe(0);
      renderReady?.();
      await ready;
      expect(provider.getMetrics().mapLoads).toBe(1);
      expect(remove).toHaveBeenCalled();
    } finally {
      provider.dispose();
    }
  });
  it('rejects authentication failures while the SDK is still loading', async () => {
    const page = window as Window & { gm_authFailure?: () => void };
    const previous = page.gm_authFailure;
    const onError = vi.fn();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: () => new Promise(() => undefined),
    });
    try {
      const ready = provider.initializeMap(document.createElement('div'), onError);
      page.gm_authFailure?.();
      await expect(ready).rejects.toMatchObject({ code: 'REQUEST_DENIED' });
      expect(onError).toHaveBeenCalledOnce();
      expect(provider.getMetrics()).toMatchObject({ mapLoads: 0, lastError: 'REQUEST_DENIED' });
      expect(page.gm_authFailure).toBe(previous);
    } finally {
      provider.dispose();
      page.gm_authFailure = previous;
    }
  });
  it('shares the authentication callback and preserves the previous integration across disposal', async () => {
    const page = window as Window & { gm_authFailure?: () => void };
    const original = page.gm_authFailure;
    const previous = vi.fn();
    page.gm_authFailure = previous;
    class TestMap {
      addListener(_name: string, callback: () => void) {
        queueMicrotask(callback);
        return { remove: vi.fn() };
      }
    }
    const providerA = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({ Map: TestMap }),
    });
    const providerB = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({ Map: TestMap }),
    });
    const firstError = vi.fn();
    const secondError = vi.fn();
    try {
      await Promise.all([
        providerA.initializeMap(document.createElement('div'), firstError),
        providerB.initializeMap(document.createElement('div'), secondError),
      ]);
      const callback = page.gm_authFailure;
      callback?.();
      expect(firstError).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUEST_DENIED' }));
      expect(secondError).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUEST_DENIED' }));
      expect(previous).toHaveBeenCalledOnce();
      providerA.dispose();
      expect(page.gm_authFailure).toBe(callback);
      providerB.dispose();
      expect(page.gm_authFailure).toBe(previous);
    } finally {
      providerA.dispose();
      providerB.dispose();
      page.gm_authFailure = original;
    }
  });
  it('preserves a replacement global authentication handler installed by another integration', async () => {
    const page = window as Window & { gm_authFailure?: () => void };
    const original = page.gm_authFailure;
    class TestMap {
      addListener(_name: string, callback: () => void) {
        queueMicrotask(callback);
        return { remove: vi.fn() };
      }
    }
    const previous = vi.fn();
    page.gm_authFailure = previous;
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({ Map: TestMap }),
    });
    try {
      await provider.initializeMap(document.createElement('div'));
      const installed = page.gm_authFailure;
      const replacement = vi.fn(() => installed?.());
      page.gm_authFailure = replacement;
      provider.dispose();
      expect(page.gm_authFailure).toBe(replacement);
      replacement();
      expect(previous).toHaveBeenCalledOnce();
    } finally {
      provider.dispose();
      page.gm_authFailure = original;
    }
  });
  it('times out a blocked SDK load and permits offline fallback', async () => {
    vi.useFakeTimers();
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: () => new Promise(() => undefined),
    });
    try {
      const result = provider
        .initializeMap(document.createElement('div'))
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(12000);
      expect(await result).toMatchObject({ code: 'NETWORK_ERROR' });
      expect(provider.getMetrics()).toMatchObject({ mapLoads: 0, lastError: 'NETWORK_ERROR' });
    } finally {
      provider.dispose();
      vi.useRealTimers();
    }
  });
  it('cancels pending map readiness and detaches listeners when disposed', async () => {
    const remove = vi.fn();
    const attached = vi.fn();
    class TestMap {
      addListener() {
        attached();
        return { remove };
      }
    }
    const provider = new GoogleRouteProvider({
      apiKey: 'test-key',
      loadLibrary: vi.fn().mockResolvedValue({ Map: TestMap }),
    });
    const result = provider
      .initializeMap(document.createElement('div'))
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(attached).toHaveBeenCalled());
    provider.dispose();
    expect(await result).toMatchObject({ code: 'NETWORK_ERROR' });
    expect(remove).toHaveBeenCalled();
    expect(provider.getMetrics().mapLoads).toBe(0);
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
