import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWeatherFixture, WeatherService } from '@smart-commute/providers';
import { SmartCommutePlanner } from './SmartCommutePlanner';
import { useWeather } from './useWeather';

const props = { destination: 'Britomart, Auckland' };
const weatherBar = () => screen.getByRole('region', { name: 'Weather' });
const art = () => weatherBar().querySelector('.sc-weather-art') as HTMLElement;
const localDateTime = (time: number) => {
  const date = new Date(time);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
};

beforeEach(() => localStorage.clear());

describe('weather bar with labelled demo fixtures', () => {
  it('shows a clear day with the sun art, temperature, place and a demo label', () => {
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('clear-day')} />);
    expect(weatherBar()).toHaveTextContent('19°C');
    expect(weatherBar()).toHaveTextContent('Clear sky');
    expect(weatherBar()).toHaveTextContent('Auckland city centre weather');
    expect(weatherBar()).toHaveTextContent('Demo');
    expect(art()).toHaveAttribute('data-art', 'sun');
    expect(art()).toHaveAttribute('aria-hidden', 'true');
  });

  it('follows is_day for a clear night', () => {
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('clear-night')} />);
    expect(art()).toHaveAttribute('data-art', 'moon');
  });

  it('draws rain lines by intensity and snow only for snow codes', () => {
    const { unmount } = render(
      <SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('rain')} />,
    );
    expect(weatherBar()).toHaveTextContent('Moderate rain');
    expect(art()).toHaveAttribute('data-art', 'rain');
    expect(art().querySelectorAll('.sc-weather-particle')).toHaveLength(7);
    expect(weatherBar()).toHaveTextContent('Rain chance 80%');
    expect(weatherBar()).toHaveTextContent('Wind 24 km/h');
    unmount();
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('snow')} />);
    expect(weatherBar()).toHaveTextContent('Moderate snowfall');
    expect(art()).toHaveAttribute('data-art', 'snow');
  });

  it('keeps an unknown code neutral instead of guessing clear weather', () => {
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('unknown')} />);
    expect(weatherBar()).toHaveTextContent('Unrecognised weather code 42');
    expect(art()).toHaveAttribute('data-art', 'none');
    expect(art().querySelectorAll('.sc-weather-particle')).toHaveLength(0);
  });

  it('uses the hourly forecast for a scheduled departure and reports out-of-range times', () => {
    const now = Date.now();
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('rain', now)} />);
    fireEvent.click(screen.getByLabelText('Leave now', { exact: true }));
    expect(weatherBar()).toHaveTextContent('Choose a departure time to see its forecast.');
    fireEvent.change(screen.getByLabelText('Departure time', { exact: true }), {
      target: { value: localDateTime(now + 3 * 3_600_000) },
    });
    expect(weatherBar()).toHaveTextContent('Forecast for');
    fireEvent.change(screen.getByLabelText('Departure time', { exact: true }), {
      target: { value: localDateTime(now + 5 * 24 * 3_600_000) },
    });
    expect(weatherBar()).toHaveTextContent('Beyond the forecast range');
    expect(weatherBar()).not.toHaveTextContent('Moderate rain');
  });

  it('lets people turn the animation off and remembers it', () => {
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('rain')} />);
    const toggle = screen.getByRole('button', { name: 'Weather animation' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(weatherBar()).toHaveAttribute('data-motion', 'off');
    expect(localStorage.getItem('smart-commute-nz:weather-motion')).toBe('off');
  });
});

describe('weather loading', () => {
  it('shows weather as unavailable when the request fails while planning keeps working', async () => {
    render(<SmartCommutePlanner {...props} />);
    await waitFor(() => expect(weatherBar()).toHaveTextContent('Weather unavailable'));
    expect(screen.getByTestId('cost-drive')).toHaveTextContent('10.91');
  });

  it('ignores a slow response for a previous origin', async () => {
    const pending = new Map<string, (body: unknown) => void>();
    const fetchImpl = vi.fn(
      (url: string | URL | Request) =>
        new Promise<Response>((resolve) => {
          const latitude = new URL(String(url)).searchParams.get('latitude')!;
          pending.set(latitude, (body) => resolve(new Response(JSON.stringify(body))));
        }),
    );
    const service = new WeatherService({ fetchImpl: fetchImpl as typeof fetch });
    const body = (latitude: number) => ({
      latitude,
      longitude: 174.7,
      timezone: 'Pacific/Auckland',
      current: { time: Math.floor(Date.now() / 1000), weather_code: 0, is_day: 1 },
      hourly: { time: [] },
    });
    const { result, rerender } = renderHook(
      ({ lat }) =>
        useWeather({ coordinates: { lat, lng: 174.7 }, leaveNow: true, now: Date.now(), service }),
      { initialProps: { lat: -36.9 } },
    );
    rerender({ lat: -37.8 });
    await act(async () => pending.get('-37.8')!(body(-37.8)));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => pending.get('-36.9')!(body(-36.9)));
    expect(result.current.status === 'ready' && result.current.forecast.latitude).toBe(-37.8);
  });

  it('reuses downloaded hours when only the departure hour changes', async () => {
    const now = Date.now();
    const fixture = createWeatherFixture('cloudy', now);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            latitude: -36.85,
            longitude: 174.76,
            timezone: 'Pacific/Auckland',
            current: { time: now / 1000, weather_code: 3, is_day: 1 },
            hourly: {
              time: fixture.hourly.map((entry) => entry.time / 1000),
              weather_code: fixture.hourly.map(() => 3),
            },
          }),
        ),
    );
    const service = new WeatherService({ fetchImpl: fetchImpl as typeof fetch });
    const { result, rerender } = renderHook(
      ({ at }) => useWeather({ leaveNow: false, departureAt: at, now, service }),
      { initialProps: { at: now + 3_600_000 } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ at: now + 5 * 3_600_000 });
    rerender({ at: now + 9 * 3_600_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.status === 'ready' && result.current.moment.kind).toBe('forecast');
  });
});

describe('sunrise and sunset', () => {
  it('shows sunrise and sunset times with the sun arc', () => {
    render(<SmartCommutePlanner {...props} weatherFixture={createWeatherFixture('clear-day')} />);
    expect(weatherBar()).toHaveTextContent(/Sunrise \d{2}:\d{2} · Sunset \d{2}:\d{2}/);
    expect(weatherBar().querySelector('.sc-sun-arc')).toHaveAttribute('aria-hidden', 'true');
  });
});
