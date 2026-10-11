import { useEffect, useState } from 'react';
import {
  AUCKLAND_CITY_CENTRE,
  roundCoordinate,
  weatherAt,
  WeatherService,
  type WeatherForecast,
  type WeatherMoment,
  type WeatherResult,
} from '@smart-commute/providers';

const sharedWeather = new WeatherService();
const REFRESH_WINDOW = 10 * 60_000;

export interface WeatherInput {
  /** Origin coordinates when known; otherwise the Auckland city centre is used and labelled. */
  coordinates?: { lat: number; lng: number };
  leaveNow: boolean;
  /** Absolute departure instant for a scheduled trip. */
  departureAt?: number;
  /** Current time at minute resolution; drives leave-now selection and periodic refresh. */
  now: number;
  /** A labelled demo forecast; no network request is made. */
  fixture?: WeatherForecast;
  service?: WeatherService;
}

export type WeatherPlace = 'origin' | 'city';
export type WeatherState =
  | { status: 'loading'; place: WeatherPlace }
  | { status: 'error'; place: WeatherPlace }
  | {
      status: 'ready';
      place: WeatherPlace;
      forecast: WeatherForecast;
      moment: WeatherMoment | { kind: 'need-time' };
      stale: boolean;
      demo: boolean;
    };

/**
 * Loads weather for the departure place. Requests depend only on the rounded place and a
 * ten-minute refresh window, so map movement, route selection and typing do not refetch.
 * A response for a previous place is ignored, so a slow old request cannot overwrite a new one.
 */
export function useWeather({
  coordinates,
  leaveNow,
  departureAt,
  now,
  fixture,
  service = sharedWeather,
}: WeatherInput): WeatherState {
  const place: WeatherPlace = coordinates ? 'origin' : 'city';
  const point = coordinates ?? AUCKLAND_CITY_CENTRE;
  const key = `${roundCoordinate(point.lat)},${roundCoordinate(point.lng)}`;
  const refreshSlot = Math.floor(now / REFRESH_WINDOW);
  const [loaded, setLoaded] = useState<{ key: string; result?: WeatherResult; failed?: boolean }>();

  useEffect(() => {
    if (fixture) return;
    const [latitude, longitude] = key.split(',').map(Number) as [number, number];
    const controller = new AbortController();
    let active = true;
    service.get(latitude, longitude, controller.signal).then(
      (result) => {
        if (active) setLoaded({ key, result });
      },
      (error: unknown) => {
        const aborted = (error as { code?: string } | null)?.code === 'ABORTED';
        if (active && !aborted) setLoaded({ key, failed: true });
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, refreshSlot, fixture, service]);

  const forecast = fixture ?? (loaded?.key === key ? loaded.result?.forecast : undefined);
  if (!forecast)
    return loaded?.key === key && loaded.failed
      ? { status: 'error', place }
      : { status: 'loading', place };
  const moment =
    !leaveNow && departureAt === undefined
      ? ({ kind: 'need-time' } as const)
      : weatherAt(
          forecast,
          leaveNow ? { leaveNow: true, now } : { leaveNow: false, at: departureAt! },
        );
  return {
    status: 'ready',
    place,
    forecast,
    moment,
    stale: !fixture && Boolean(loaded?.result?.stale),
    demo: Boolean(fixture),
  };
}
