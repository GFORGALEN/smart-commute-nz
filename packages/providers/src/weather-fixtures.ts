import type { WeatherForecast } from './weather';

/**
 * Deterministic weather for tests and labelled development demos. Never shown as real data:
 * the planner marks any fixture-driven weather as a demo.
 */
export type WeatherFixtureKind =
  'clear-day' | 'clear-night' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog' | 'unknown';

const FIXTURES: Record<
  WeatherFixtureKind,
  { code: number; isDay: boolean; temperature: number; precipitation: number; wind: number }
> = {
  'clear-day': { code: 0, isDay: true, temperature: 19, precipitation: 0, wind: 11 },
  'clear-night': { code: 0, isDay: false, temperature: 12, precipitation: 0, wind: 6 },
  cloudy: { code: 3, isDay: true, temperature: 16, precipitation: 10, wind: 14 },
  rain: { code: 63, isDay: true, temperature: 14, precipitation: 80, wind: 24 },
  snow: { code: 73, isDay: true, temperature: -1, precipitation: 70, wind: 9 },
  storm: { code: 95, isDay: true, temperature: 17, precipitation: 90, wind: 38 },
  fog: { code: 45, isDay: true, temperature: 11, precipitation: 5, wind: 3 },
  unknown: { code: 42, isDay: true, temperature: 15, precipitation: 20, wind: 12 },
};

export function createWeatherFixture(
  kind: WeatherFixtureKind,
  now = Date.now(),
  timezone = 'Pacific/Auckland',
): WeatherForecast {
  const fixture = FIXTURES[kind];
  const start = Math.floor(now / 3_600_000) * 3_600_000 - 2 * 3_600_000;
  return {
    latitude: -36.85,
    longitude: 174.76,
    timezone,
    fetchedAt: now,
    current: {
      time: Math.floor(now / 900_000) * 900_000,
      temperatureC: fixture.temperature,
      weatherCode: fixture.code,
      isDay: fixture.isDay,
      windKmh: fixture.wind,
    },
    // Daylight agrees with is_day: day fixtures sit mid-day, the night fixture after sunset.
    daylight: [-1, 0, 1].map((day) => {
      const offset = day * 86_400_000;
      return fixture.isDay
        ? { sunrise: now - 5 * 3_600_000 + offset, sunset: now + 6 * 3_600_000 + offset }
        : { sunrise: now - 16 * 3_600_000 + offset, sunset: now - 3 * 3_600_000 + offset };
    }),
    hourly: Array.from({ length: 48 }, (_, index) => ({
      time: start + index * 3_600_000,
      temperatureC: fixture.temperature + (index % 6) - 2,
      weatherCode: fixture.code,
      isDay: fixture.isDay,
      windKmh: fixture.wind,
      precipitationProbability: fixture.precipitation,
      snowfallCm: kind === 'snow' ? 0.4 : 0,
    })),
  };
}
