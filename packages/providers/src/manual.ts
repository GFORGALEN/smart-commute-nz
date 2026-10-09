import { compareOptions, DEFAULT_SETTINGS } from '@smart-commute/core';
import type { RouteProvider, RouteRequest, RouteResult } from './types';
import { RouteProviderError } from './types';

/** Offline adapter: it accepts only explicit, user supplied measurements. */
export class ManualRouteProvider implements RouteProvider {
  readonly id = 'manual';

  getRoutes(request: RouteRequest): Promise<RouteResult> {
    if (!request.manualRoutes?.length) {
      return Promise.reject(
        new RouteProviderError(
          'INVALID_INPUT',
          'Enter manual route distance, duration and fare first.',
        ),
      );
    }
    try {
      // Share the cost engine's structural and numeric validation contract.
      compareOptions(request.manualRoutes, {
        ...DEFAULT_SETTINGS,
        roundTrip: request.roundTrip ?? false,
      });
    } catch (error) {
      return Promise.reject(
        new RouteProviderError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Manual route inputs are invalid.',
        ),
      );
    }
    const routes = request.manualRoutes.map((route) => ({
      ...route,
      waypoints: route.waypoints.map((location) => ({ ...location })),
      outbound: route.outbound.map((leg) => ({
        ...leg,
        source: 'manual' as const,
        estimated: true,
      })),
      inbound: route.inbound.map((leg) => ({ ...leg, source: 'manual' as const, estimated: true })),
    }));
    return Promise.resolve({
      routes,
      warnings: [
        'Manual inputs are estimates. Parking legality, availability, price and fare eligibility must be checked independently.',
      ],
      attribution: 'User supplied measurements — Manual Mode',
      requestCount: 0,
    });
  }
}
