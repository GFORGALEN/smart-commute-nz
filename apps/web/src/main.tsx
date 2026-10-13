import React from 'react';
import ReactDOM from 'react-dom/client';
import { EXAMPLE_DESTINATION, isExamplePlace } from '@smart-commute/core';
import { SmartCommutePlanner } from '@smart-commute/react';
import { createWeatherFixture, type WeatherFixtureKind } from '@smart-commute/providers';
import './styles.css';

const parameters = new URLSearchParams(window.location.search);
const embedded = parameters.get('embed') === '1';
document.documentElement.dataset.embedded = String(embedded);
function savedAppearance(): { locale?: 'en' | 'zh-CN'; theme?: 'light' | 'dark' } {
  if (embedded) return {};
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem('smart-commute-nz:appearance') || 'null',
    );
    if (stored && typeof stored === 'object') {
      return {
        locale: 'locale' in stored && stored.locale === 'zh-CN' ? 'zh-CN' : 'en',
        theme: 'theme' in stored && stored.theme === 'dark' ? 'dark' : 'light',
      };
    }
  } catch {
    /* Appearance is optional. */
  }
  return {};
}
const appearance = savedAppearance();
const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || undefined;
function savedDestination(): string | undefined {
  if (embedded) return undefined;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('smart-commute-nz:v1') || 'null');
    if (saved && typeof saved === 'object' && 'destination' in saved) {
      const destination = saved.destination;
      if (
        destination &&
        typeof destination === 'object' &&
        'label' in destination &&
        typeof destination.label === 'string' &&
        // Live planning starts empty rather than at the sample destination saved earlier.
        !(googleApiKey && isExamplePlace(destination as { label: string }))
      )
        return destination.label;
    }
  } catch {
    /* Malformed or unavailable storage falls back to the sample. */
  }
  return undefined;
}

// Development only: ?weatherDemo=rain previews a labelled demo forecast. Production uses live data.
const demoKinds: WeatherFixtureKind[] = [
  'clear-day',
  'clear-night',
  'cloudy',
  'rain',
  'snow',
  'storm',
  'fog',
  'unknown',
];
const demoKind = parameters.get('weatherDemo') as WeatherFixtureKind | null;
const weatherFixture =
  import.meta.env.DEV && demoKind && demoKinds.includes(demoKind)
    ? createWeatherFixture(demoKind)
    : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SmartCommutePlanner
      origin={parameters.get('origin') || undefined}
      destination={
        parameters.get('destination') ||
        savedDestination() ||
        (googleApiKey ? '' : EXAMPLE_DESTINATION)
      }
      locale={
        parameters.has('locale')
          ? parameters.get('locale') === 'zh-CN'
            ? 'zh-CN'
            : 'en'
          : appearance.locale || 'en'
      }
      theme={
        parameters.has('theme')
          ? parameters.get('theme') === 'dark'
            ? 'dark'
            : 'light'
          : appearance.theme || 'light'
      }
      googleApiKey={googleApiKey}
      weatherFixture={weatherFixture}
    />
  </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // The manual calculator still works when storage or service workers are unavailable.
    });
  });
}
