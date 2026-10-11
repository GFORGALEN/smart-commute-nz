import { describe, expect, it, vi } from 'vitest';
import {
  sunAt,
  createWeatherFixture,
  describeWeatherCode,
  fetchForecast,
  forecastUrl,
  parseForecast,
  weatherAt,
  WeatherError,
  WeatherService,
} from './index';

const HOUR = 3_600_000;
// 2026-10-12 08:00 NZDT (UTC+13).
const MORNING = Date.UTC(2026, 9, 11, 19, 0);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function openMeteoBody(start = MORNING, overrides: Record<string, unknown> = {}) {
  const times = Array.from({ length: 6 }, (_, index) => (start + index * HOUR) / 1000);
  return {
    latitude: -36.86,
    longitude: 174.76,
    timezone: 'Pacific/Auckland',
    utc_offset_seconds: 46800,
    current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
    current: {
      time: start / 1000,
      interval: 900,
      temperature_2m: 14.6,
      weather_code: 61,
      is_day: 1,
      wind_speed_10m: 21.4,
    },
    hourly_units: {
      temperature_2m: '°C',
      precipitation_probability: '%',
      wind_speed_10m: 'km/h',
      snowfall: 'cm',
    },
    hourly: {
      time: times,
      temperature_2m: [14, 15, 16, 17, 18, 19],
      precipitation_probability: [10, 60, 80, 40, 20, 0],
      weather_code: [61, 63, 65, 3, 2, 0],
      is_day: [1, 1, 1, 1, 1, 1],
      wind_speed_10m: [10, 12, 14, 16, 18, 20],
      snowfall: [0, 0, 0, 0, 0, 0],
    },
    ...overrides,
  };
}

describe('Open-Meteo request and parsing', () => {
  it('requests only the documented fields with unix times and a rounded location', () => {
    const url = new URL(forecastUrl(-36.848461, 174.763336));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('-36.85');
    expect(url.searchParams.get('longitude')).toBe('174.76');
    expect(url.searchParams.get('current')).toBe(
      'temperature_2m,weather_code,is_day,wind_speed_10m',
    );
    expect(url.searchParams.get('hourly')).toBe(
      'temperature_2m,precipitation_probability,weather_code,is_day,wind_speed_10m,snowfall',
    );
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('timezone')).toBe('auto');
  });

  it('parses current and hourly values in the returned units', () => {
    const forecast = parseForecast(openMeteoBody(), 1000);
    expect(forecast.timezone).toBe('Pacific/Auckland');
    expect(forecast.current).toMatchObject({
      time: MORNING,
      temperatureC: 14.6,
      weatherCode: 61,
      isDay: true,
      windKmh: 21.4,
    });
    expect(forecast.hourly).toHaveLength(6);
    expect(forecast.hourly[2]).toMatchObject({
      time: MORNING + 2 * HOUR,
      precipitationProbability: 80,
      weatherCode: 65,
    });
  });

  it('converts Fahrenheit, m/s and inches, and leaves unknown units and missing fields empty', () => {
    const body = openMeteoBody(MORNING, {
      current_units: { temperature_2m: '°F', wind_speed_10m: 'm/s' },
      current: {
        time: MORNING / 1000,
        temperature_2m: 50,
        weather_code: 0,
        is_day: 0,
        wind_speed_10m: 10,
      },
      hourly_units: { temperature_2m: 'K', snowfall: 'inch', precipitation_probability: '%' },
      hourly: {
        time: [MORNING / 1000],
        temperature_2m: [280],
        snowfall: [1],
        weather_code: [null],
      },
    });
    const forecast = parseForecast(body, 0);
    expect(forecast.current?.temperatureC).toBeCloseTo(10);
    expect(forecast.current?.windKmh).toBeCloseTo(36);
    expect(forecast.current?.isDay).toBe(false);
    expect(forecast.hourly[0]!.temperatureC).toBeUndefined();
    expect(forecast.hourly[0]!.snowfallCm).toBeCloseTo(2.54);
    expect(forecast.hourly[0]!.weatherCode).toBeUndefined();
  });

  it('maps official codes and keeps unknown codes unknown', () => {
    expect(describeWeatherCode(0)).toEqual({ code: 0, condition: 'clear' });
    expect(describeWeatherCode(65)).toEqual({ code: 65, condition: 'rain', intensity: 'heavy' });
    expect(describeWeatherCode(73).condition).toBe('snow');
    expect(describeWeatherCode(97)).toEqual({
      code: 97,
      condition: 'thunderstorm',
      intensity: 'heavy',
    });
    expect(describeWeatherCode(42)).toEqual({ code: 42, condition: 'unknown' });
  });

  it('reports rate limits, server errors, network failures, timeouts and cancellation', async () => {
    await expect(
      fetchForecast(0, 0, { fetchImpl: async () => response({}, 429) }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      fetchForecast(0, 0, {
        fetchImpl: async () => response({ error: true, reason: 'Bad latitude' }, 400),
      }),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE', message: 'Bad latitude' });
    await expect(
      fetchForecast(0, 0, {
        fetchImpl: async () => {
          throw new TypeError('offline');
        },
      }),
    ).rejects.toMatchObject({ code: 'NETWORK' });
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    await expect(fetchForecast(0, 0, { fetchImpl: hanging, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    const controller = new AbortController();
    const cancelled = fetchForecast(0, 0, { fetchImpl: hanging, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('weather cache', () => {
  it('reuses a download for ten minutes, shares in-flight requests and refreshes afterwards', async () => {
    let now = MORNING;
    const fetchImpl = vi.fn(async () => response(openMeteoBody()));
    const service = new WeatherService({ fetchImpl, now: () => now });
    const [first, second] = await Promise.all([
      service.get(-36.861, 174.764),
      service.get(-36.859, 174.762),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.forecast).toBe(first.forecast);
    now += 9 * 60_000;
    await service.get(-36.86, 174.76);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await service.get(-36.86, 174.76);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('labels an older download as stale when a refresh fails, and fails without one', async () => {
    let now = MORNING;
    let fail = false;
    const fetchImpl = vi.fn(async () => (fail ? response({}, 429) : response(openMeteoBody())));
    const service = new WeatherService({ fetchImpl, now: () => now });
    const fresh = await service.get(-36.86, 174.76);
    now += 30 * 60_000;
    fail = true;
    const stale = await service.get(-36.86, 174.76);
    expect(stale.stale).toBe(true);
    expect(stale.error).toBeInstanceOf(WeatherError);
    expect(stale.forecast.fetchedAt).toBe(fresh.forecast.fetchedAt);
    await expect(service.get(-41.29, 174.78)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('choosing the weather for a departure', () => {
  const forecast = parseForecast(openMeteoBody(), MORNING);

  it('uses current conditions to leave now, with the rain chance for the current hour', () => {
    const moment = weatherAt(forecast, { leaveNow: true, now: MORNING + 20 * 60_000 });
    expect(moment).toMatchObject({ kind: 'current', sample: { weatherCode: 61 } });
    expect(moment.kind === 'current' && moment.precipitation).toEqual({
      probability: 60,
      start: MORNING,
      end: MORNING + HOUR,
    });
  });

  it('uses the nearest hourly forecast for a scheduled departure and the hour it falls in for rain', () => {
    const moment = weatherAt(forecast, { leaveNow: false, at: MORNING + HOUR + 40 * 60_000 });
    expect(moment).toMatchObject({
      kind: 'forecast',
      sample: { time: MORNING + 2 * HOUR, weatherCode: 65 },
    });
    expect(moment.kind === 'forecast' && moment.precipitation).toEqual({
      probability: 80,
      start: MORNING + HOUR,
      end: MORNING + 2 * HOUR,
    });
  });

  it('reports departures beyond the forecast instead of substituting current weather', () => {
    expect(weatherAt(forecast, { leaveNow: false, at: MORNING + 30 * HOUR })).toEqual({
      kind: 'out-of-range',
      until: MORNING + 5 * HOUR,
    });
    expect(
      weatherAt({ ...forecast, current: undefined }, { leaveNow: true, now: MORNING }),
    ).toEqual({ kind: 'missing-current' });
  });

  it('formats unix forecast times in Auckland across the daylight-saving change', () => {
    // NZDT began 2026-09-27 at 02:00 NZST: 01:00 is followed by 03:00 local time.
    const beforeChange = Date.UTC(2026, 8, 26, 13, 0);
    const fixture = createWeatherFixture('clear-day', beforeChange);
    const clock = new Intl.DateTimeFormat('en-NZ', {
      timeZone: fixture.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const moment = weatherAt(fixture, { leaveNow: false, at: beforeChange + HOUR });
    expect(clock.format(beforeChange)).toBe('01:00');
    expect(moment.kind === 'forecast' && clock.format(moment.sample.time)).toBe('03:00');
  });
});

describe('sunrise and sunset', () => {
  const sunrise = Date.UTC(2026, 9, 11, 17, 30); // 06:30 NZDT
  const sunset = Date.UTC(2026, 9, 12, 6, 30); // 19:30 NZDT
  const forecast = { ...parseForecast(openMeteoBody(), 0), daylight: [{ sunrise, sunset }] };

  it('requests and parses daily sunrise and sunset times', () => {
    expect(new URL(forecastUrl(-36.85, 174.76)).searchParams.get('daily')).toBe('sunrise,sunset');
    const parsed = parseForecast(
      openMeteoBody(MORNING, {
        daily: { time: [0], sunrise: [sunrise / 1000], sunset: [sunset / 1000] },
      }),
      0,
    );
    expect(parsed.daylight).toEqual([{ sunrise, sunset }]);
  });

  it('classifies dawn, day, dusk and night around the local sunrise and sunset', () => {
    expect(sunAt(forecast, sunrise + 10 * 60_000)?.phase).toBe('dawn');
    expect(sunAt(forecast, sunrise + 6 * HOUR)).toMatchObject({ phase: 'day' });
    expect(sunAt(forecast, sunrise + 6 * HOUR)?.progress).toBeCloseTo(6 / 13);
    expect(sunAt(forecast, sunset - 20 * 60_000)?.phase).toBe('dusk');
    expect(sunAt(forecast, sunset + 3 * HOUR)?.phase).toBe('night');
    expect(sunAt({ ...forecast, daylight: [] }, sunrise)).toBeUndefined();
  });
});
