/**
 * Open-Meteo forecast client for commute weather. The free endpoint needs no key and is used
 * here for a non-commercial prototype; data is CC BY 4.0 and must be attributed in the UI.
 * Times are requested as Unix seconds and formatted later in the location's IANA timezone, so
 * daylight-saving changes inside the forecast window are handled by Intl, not a fixed offset.
 */

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_ATTRIBUTION_URL = 'https://open-meteo.com/';
export const AUCKLAND_CITY_CENTRE = { lat: -36.8485, lng: 174.7633 } as const;
const HOUR = 3_600_000;
const FORECAST_DAYS = 16;

export type WeatherCondition =
  | 'clear'
  | 'mainlyClear'
  | 'partlyCloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'freezingDrizzle'
  | 'rain'
  | 'freezingRain'
  | 'snow'
  | 'snowGrains'
  | 'rainShowers'
  | 'snowShowers'
  | 'thunderstorm'
  | 'thunderstormHail'
  | 'unknown';
export type WeatherIntensity = 'light' | 'moderate' | 'heavy';

/** WMO weather interpretation codes as documented by Open-Meteo. */
const WMO_CODES: Record<number, [WeatherCondition, WeatherIntensity?]> = {
  0: ['clear'],
  1: ['mainlyClear'],
  2: ['partlyCloudy'],
  3: ['overcast'],
  45: ['fog'],
  48: ['fog'],
  51: ['drizzle', 'light'],
  53: ['drizzle', 'moderate'],
  55: ['drizzle', 'heavy'],
  56: ['freezingDrizzle', 'light'],
  57: ['freezingDrizzle', 'heavy'],
  61: ['rain', 'light'],
  63: ['rain', 'moderate'],
  65: ['rain', 'heavy'],
  66: ['freezingRain', 'light'],
  67: ['freezingRain', 'heavy'],
  71: ['snow', 'light'],
  73: ['snow', 'moderate'],
  75: ['snow', 'heavy'],
  77: ['snowGrains', 'light'],
  80: ['rainShowers', 'light'],
  81: ['rainShowers', 'moderate'],
  82: ['rainShowers', 'heavy'],
  85: ['snowShowers', 'light'],
  86: ['snowShowers', 'heavy'],
  95: ['thunderstorm', 'moderate'],
  96: ['thunderstormHail', 'light'],
  97: ['thunderstorm', 'heavy'],
  99: ['thunderstormHail', 'heavy'],
};

export interface WeatherCodeInfo {
  code: number;
  condition: WeatherCondition;
  intensity?: WeatherIntensity;
}

/** Unknown codes stay unknown; they are never shown as clear weather. */
export function describeWeatherCode(code: number): WeatherCodeInfo {
  const entry = WMO_CODES[code];
  return entry
    ? { code, condition: entry[0], ...(entry[1] ? { intensity: entry[1] } : {}) }
    : { code, condition: 'unknown' };
}

export interface WeatherSample {
  /** Absolute instant in milliseconds since the epoch. */
  time: number;
  temperatureC?: number;
  weatherCode?: number;
  isDay?: boolean;
  windKmh?: number;
  /** Chance of more than 0.1 mm in the hour ending at `time` (Open-Meteo definition). */
  precipitationProbability?: number;
  snowfallCm?: number;
}

export interface WeatherForecast {
  latitude: number;
  longitude: number;
  /** IANA timezone returned for the coordinates, for example Pacific/Auckland. */
  timezone: string;
  /** When this client received the data. */
  fetchedAt: number;
  current?: WeatherSample;
  hourly: WeatherSample[];
  /** Local sunrise and sunset instants for each forecast day. */
  daylight: { sunrise: number; sunset: number }[];
}

export type WeatherErrorCode = 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'BAD_RESPONSE' | 'ABORTED';

export class WeatherError extends Error {
  constructor(
    public readonly code: WeatherErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WeatherError';
  }
}

/** Rounds to roughly 1 km: enough for weather, and the exact address is not sent. */
export const roundCoordinate = (value: number) => Math.round(value * 100) / 100;

export function forecastUrl(latitude: number, longitude: number): string {
  const parameters = new URLSearchParams({
    latitude: String(roundCoordinate(latitude)),
    longitude: String(roundCoordinate(longitude)),
    current: 'temperature_2m,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day,wind_speed_10m,snowfall',
    daily: 'sunrise,sunset',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: String(FORECAST_DAYS),
  });
  return `${OPEN_METEO_FORECAST_URL}?${parameters}`;
}

type Units = Record<string, string | undefined>;
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

// Each converter returns undefined for an unrecognised unit rather than guessing.
function celsius(value: unknown, unit: string | undefined): number | undefined {
  const number = finite(value);
  if (number === undefined) return undefined;
  if (unit === '°C' || unit === undefined) return number;
  if (unit === '°F') return ((number - 32) * 5) / 9;
  return undefined;
}
function kilometresPerHour(value: unknown, unit: string | undefined): number | undefined {
  const number = finite(value);
  if (number === undefined) return undefined;
  switch (unit) {
    case undefined:
    case 'km/h':
      return number;
    case 'm/s':
      return number * 3.6;
    case 'mph':
    case 'mp/h':
      return number * 1.609344;
    case 'kn':
    case 'kt':
      return number * 1.852;
    default:
      return undefined;
  }
}
function centimetres(value: unknown, unit: string | undefined): number | undefined {
  const number = finite(value);
  if (number === undefined) return undefined;
  if (unit === 'cm' || unit === undefined) return number;
  if (unit === 'inch' || unit === 'in') return number * 2.54;
  return undefined;
}
function percent(value: unknown, unit: string | undefined): number | undefined {
  const number = finite(value);
  return number !== undefined && (unit === '%' || unit === undefined) ? number : undefined;
}

function sample(values: Record<string, unknown>, units: Units, time: number): WeatherSample {
  const result: WeatherSample = { time };
  const assign = <K extends keyof WeatherSample>(key: K, value: WeatherSample[K] | undefined) => {
    if (value !== undefined) result[key] = value;
  };
  assign('temperatureC', celsius(values.temperature_2m, units.temperature_2m));
  const code = finite(values.weather_code);
  assign('weatherCode', code === undefined ? undefined : Math.round(code));
  const isDay = finite(values.is_day);
  assign('isDay', isDay === undefined ? undefined : isDay === 1);
  assign('windKmh', kilometresPerHour(values.wind_speed_10m, units.wind_speed_10m));
  assign(
    'precipitationProbability',
    percent(values.precipitation_probability, units.precipitation_probability),
  );
  assign('snowfallCm', centimetres(values.snowfall, units.snowfall));
  return result;
}

function validTimezone(zone: unknown): string {
  if (typeof zone !== 'string' || !zone) return 'Pacific/Auckland';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return 'Pacific/Auckland';
  }
}

/** Normalises an Open-Meteo response; missing fields stay undefined instead of becoming zero. */
export function parseForecast(body: unknown, fetchedAt: number): WeatherForecast {
  if (!body || typeof body !== 'object')
    throw new WeatherError('BAD_RESPONSE', 'Weather response was not an object.');
  const data = body as Record<string, unknown>;
  if (data.error === true)
    throw new WeatherError(
      'BAD_RESPONSE',
      typeof data.reason === 'string' ? data.reason : 'Weather request rejected.',
    );
  const latitude = finite(data.latitude);
  const longitude = finite(data.longitude);
  if (latitude === undefined || longitude === undefined)
    throw new WeatherError('BAD_RESPONSE', 'Weather response has no coordinates.');
  const forecast: WeatherForecast = {
    latitude,
    longitude,
    timezone: validTimezone(data.timezone),
    fetchedAt,
    hourly: [],
    daylight: [],
  };
  const current = data.current as Record<string, unknown> | undefined;
  const currentTime = finite(current?.time);
  if (current && currentTime !== undefined)
    forecast.current = sample(current, (data.current_units ?? {}) as Units, currentTime * 1000);
  const hourly = data.hourly as Record<string, unknown[] | undefined> | undefined;
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const units = (data.hourly_units ?? {}) as Units;
  times.forEach((time, index) => {
    const seconds = finite(time);
    if (seconds === undefined) return;
    const row: Record<string, unknown> = {};
    for (const [field, values] of Object.entries(hourly ?? {}))
      if (Array.isArray(values)) row[field] = values[index];
    forecast.hourly.push(sample(row, units, seconds * 1000));
  });
  forecast.hourly.sort((left, right) => left.time - right.time);
  const daily = data.daily as Record<string, unknown[] | undefined> | undefined;
  const sunrises = Array.isArray(daily?.sunrise) ? daily.sunrise : [];
  const sunsets = Array.isArray(daily?.sunset) ? daily.sunset : [];
  sunrises.forEach((sunrise, index) => {
    const rise = finite(sunrise);
    const set = finite(sunsets[index]);
    if (rise !== undefined && set !== undefined && set > rise)
      forecast.daylight.push({ sunrise: rise * 1000, sunset: set * 1000 });
  });
  return forecast;
}

export interface FetchForecastOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}

export async function fetchForecast(
  latitude: number,
  longitude: number,
  {
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = 8000,
    now = Date.now,
  }: FetchForecastOptions = {},
): Promise<WeatherForecast> {
  if (!fetchImpl) throw new WeatherError('NETWORK', 'Fetch is unavailable in this environment.');
  if (signal?.aborted) throw new WeatherError('ABORTED', 'Weather request was cancelled.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchImpl(forecastUrl(latitude, longitude), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
    } catch {
      if (timedOut) throw new WeatherError('TIMEOUT', 'Weather request timed out.');
      if (signal?.aborted) throw new WeatherError('ABORTED', 'Weather request was cancelled.');
      throw new WeatherError('NETWORK', 'Weather service could not be reached.');
    }
    if (response.status === 429)
      throw new WeatherError('RATE_LIMITED', 'Weather request limit reached.');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (timedOut) throw new WeatherError('TIMEOUT', 'Weather request timed out.');
      throw new WeatherError('BAD_RESPONSE', 'Weather response was not valid JSON.');
    }
    if (!response.ok) {
      const reason = (body as { reason?: unknown } | null)?.reason;
      throw new WeatherError(
        'BAD_RESPONSE',
        typeof reason === 'string' ? reason : `Weather request failed (${response.status}).`,
      );
    }
    return parseForecast(body, now());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export interface WeatherResult {
  forecast: WeatherForecast;
  /** True when a refresh failed and an older download is returned instead. */
  stale: boolean;
  error?: WeatherError;
}

export interface WeatherServiceOptions extends Omit<FetchForecastOptions, 'signal'> {
  /** Downloads are reused for this long; default ten minutes. */
  ttlMs?: number;
}

/**
 * Caches one forecast per rounded coordinate and forecast window. Concurrent callers for the
 * same place share a request; a caller's cancellation never cancels the shared download.
 */
export class WeatherService {
  private readonly cache = new Map<string, WeatherForecast>();
  private readonly pending = new Map<string, Promise<WeatherForecast>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: WeatherServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  static key(latitude: number, longitude: number): string {
    return `${roundCoordinate(latitude).toFixed(2)},${roundCoordinate(longitude).toFixed(2)}|${FORECAST_DAYS}d`;
  }

  /** The cached forecast and whether it is still within the reuse window. */
  peek(
    latitude: number,
    longitude: number,
  ): { forecast: WeatherForecast; fresh: boolean } | undefined {
    const forecast = this.cache.get(WeatherService.key(latitude, longitude));
    return forecast && { forecast, fresh: this.now() - forecast.fetchedAt < this.ttlMs };
  }

  async get(latitude: number, longitude: number, signal?: AbortSignal): Promise<WeatherResult> {
    const key = WeatherService.key(latitude, longitude);
    const cached = this.peek(latitude, longitude);
    if (cached?.fresh) return { forecast: cached.forecast, stale: false };
    let request = this.pending.get(key);
    if (!request) {
      request = fetchForecast(latitude, longitude, { ...this.options, now: this.now }).finally(() =>
        this.pending.delete(key),
      );
      this.pending.set(key, request);
    }
    try {
      const forecast = await withCancellation(request, signal);
      this.cache.set(key, forecast);
      return { forecast, stale: false };
    } catch (error) {
      const failure =
        error instanceof WeatherError
          ? error
          : new WeatherError('BAD_RESPONSE', 'Weather data could not be read.');
      if (failure.code === 'ABORTED' || !cached) throw failure;
      return { forecast: cached.forecast, stale: true, error: failure };
    }
  }
}

function withCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.reject(new WeatherError('ABORTED', 'Weather request was cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new WeatherError('ABORTED', 'Weather request was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export type SunPhase = 'night' | 'dawn' | 'day' | 'dusk';
export interface SunPosition {
  sunrise: number;
  sunset: number;
  phase: SunPhase;
  /** 0 at sunrise to 1 at sunset; only during the day and twilight. */
  progress?: number;
}
const TWILIGHT = 40 * 60_000;

/**
 * Sun position for an instant, using the forecast day whose solar noon is closest. Dawn and dusk
 * cover forty minutes either side of sunrise and sunset.
 */
export function sunAt(forecast: WeatherForecast, time: number): SunPosition | undefined {
  let best: { sunrise: number; sunset: number } | undefined;
  for (const day of forecast.daylight) {
    const noon = (day.sunrise + day.sunset) / 2;
    if (!best || Math.abs(time - noon) < Math.abs(time - (best.sunrise + best.sunset) / 2))
      best = day;
  }
  if (!best || Math.abs(time - (best.sunrise + best.sunset) / 2) > 18 * HOUR) return undefined;
  const progress = Math.min(1, Math.max(0, (time - best.sunrise) / (best.sunset - best.sunrise)));
  const phase: SunPhase =
    Math.abs(time - best.sunrise) <= TWILIGHT
      ? 'dawn'
      : Math.abs(time - best.sunset) <= TWILIGHT
        ? 'dusk'
        : time > best.sunrise && time < best.sunset
          ? 'day'
          : 'night';
  return { ...best, phase, ...(phase === 'night' ? {} : { progress }) };
}

export type WeatherMoment =
  | {
      kind: 'current' | 'forecast';
      sample: WeatherSample;
      sun?: SunPosition;
      /** The hour whose rain chance is shown, as [start, end). */
      precipitation?: { probability: number; start: number; end: number };
    }
  | { kind: 'missing-current' }
  | { kind: 'out-of-range'; until?: number };

const hourStart = (time: number) => Math.floor(time / HOUR) * HOUR;

/**
 * Picks the weather for a departure. Leave-now uses `current`; a scheduled time uses the nearest
 * hourly forecast. Rain chance comes from the hour that contains the departure, because
 * Open-Meteo reports it for the hour ending at each timestamp. Beyond the window is reported as
 * such and never replaced by current conditions.
 */
export function weatherAt(
  forecast: WeatherForecast,
  departure: { leaveNow: true; now: number } | { leaveNow: false; at: number },
): WeatherMoment {
  const byTime = new Map(forecast.hourly.map((entry) => [entry.time, entry]));
  const reference = departure.leaveNow ? departure.now : departure.at;
  const windowEnd = byTime.get(hourStart(reference) + HOUR);
  const precipitation =
    windowEnd?.precipitationProbability !== undefined
      ? {
          probability: windowEnd.precipitationProbability,
          start: hourStart(reference),
          end: hourStart(reference) + HOUR,
        }
      : undefined;
  if (departure.leaveNow) {
    if (!forecast.current || forecast.current.weatherCode === undefined)
      return { kind: 'missing-current' };
    return {
      kind: 'current',
      sample: forecast.current,
      precipitation,
      sun: sunAt(forecast, departure.now),
    };
  }
  const nearest = byTime.get(Math.round(departure.at / HOUR) * HOUR);
  const last = forecast.hourly.at(-1)?.time;
  if (!nearest || nearest.weatherCode === undefined) return { kind: 'out-of-range', until: last };
  return { kind: 'forecast', sample: nearest, precipitation, sun: sunAt(forecast, departure.at) };
}
