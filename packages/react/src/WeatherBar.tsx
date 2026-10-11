import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  CircleDashed,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudOff,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';
import {
  describeWeatherCode,
  OPEN_METEO_ATTRIBUTION_URL,
  type SunPosition,
  type WeatherCodeInfo,
} from '@smart-commute/providers';
import { createTranslator, weatherDescription, type Locale } from '@smart-commute/i18n';
import type { WeatherState } from './useWeather';

const MOTION_KEY = 'smart-commute-nz:weather-motion';
type Art = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'fog' | 'storm' | 'none';

/** Phones start static; a saved choice wins on every device. */
function initialMotion(): boolean {
  try {
    const saved = localStorage.getItem(MOTION_KEY);
    if (saved === 'on' || saved === 'off') return saved === 'on';
  } catch {
    /* Storage is optional. */
  }
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return !window.matchMedia('(max-width: 760px)').matches;
}

/** The art follows the WMO code and is_day only; temperature and season are never used. */
function artFor(info: WeatherCodeInfo, isDay: boolean | undefined): { art: Art; icon: ReactNode } {
  const night = isDay === false;
  switch (info.condition) {
    case 'clear':
      return night ? { art: 'moon', icon: <Moon /> } : { art: 'sun', icon: <Sun /> };
    case 'mainlyClear':
      return night ? { art: 'moon', icon: <CloudMoon /> } : { art: 'sun', icon: <CloudSun /> };
    case 'partlyCloudy':
      return { art: 'cloud', icon: night ? <CloudMoon /> : <CloudSun /> };
    case 'overcast':
      return { art: 'cloud', icon: <Cloudy /> };
    case 'fog':
      return { art: 'fog', icon: <CloudFog /> };
    case 'drizzle':
    case 'freezingDrizzle':
      return { art: 'rain', icon: <CloudDrizzle /> };
    case 'rain':
    case 'rainShowers':
    case 'freezingRain':
      return { art: 'rain', icon: <CloudRain /> };
    case 'snow':
    case 'snowShowers':
    case 'snowGrains':
      return { art: 'snow', icon: <CloudSnow /> };
    case 'thunderstorm':
      return { art: 'storm', icon: <CloudLightning /> };
    case 'thunderstormHail':
      return { art: 'storm', icon: <CloudHail /> };
    default:
      return { art: 'none', icon: <CircleDashed /> };
  }
}

const particleCount = (art: Art, info?: WeatherCodeInfo) => {
  const level = info?.intensity === 'heavy' ? 2 : info?.intensity === 'moderate' ? 1 : 0;
  if (art === 'rain') return [4, 7, 11][level]!;
  if (art === 'snow') return [4, 6, 9][level]!;
  if (art === 'storm') return 7;
  if (art === 'fog') return 3;
  if (art === 'moon') return 3;
  return 0;
};

function WeatherArt({
  art,
  icon,
  info,
  phase,
}: {
  art: Art;
  icon: ReactNode;
  info?: WeatherCodeInfo;
  phase: SunPosition['phase'] | 'unknown';
}) {
  const count = particleCount(art, info);
  return (
    <span
      className="sc-weather-art"
      data-art={art}
      data-intensity={info?.intensity ?? 'none'}
      data-phase={phase}
      aria-hidden="true"
    >
      {art === 'sun' && <i className="sc-weather-rays" />}
      {(art === 'cloud' || art === 'sun') && <i className="sc-weather-cloudlet" />}
      {Array.from({ length: count }, (_, index) => (
        <i
          key={index}
          className="sc-weather-particle"
          style={{
            left: `${8 + ((index * 41) % 84)}%`,
            animationDelay: `${((index * 0.27) % 1.4).toFixed(2)}s`,
          }}
        />
      ))}
      <span className="sc-weather-icon">{icon}</span>
    </span>
  );
}

/** A small arc from sunrise to sunset with the sun placed at the departure time. */
function SunArc({ sun }: { sun: SunPosition }) {
  const progress = sun.progress ?? 0;
  // Quadratic curve from (6, 24) through control (36, -4) to (66, 24).
  const x = (1 - progress) ** 2 * 6 + 2 * (1 - progress) * progress * 36 + progress ** 2 * 66;
  const y = (1 - progress) ** 2 * 24 + 2 * (1 - progress) * progress * -4 + progress ** 2 * 24;
  return (
    <svg className="sc-sun-arc" data-phase={sun.phase} viewBox="0 0 72 28" aria-hidden="true">
      <path className="sc-sun-horizon" d="M2 24 H70" />
      <path className="sc-sun-path" d="M6 24 Q36 -4 66 24" />
      {sun.phase !== 'night' && (
        <>
          <circle className="sc-sun-glow" cx={x} cy={y} r="6" />
          <circle className="sc-sun-dot" cx={x} cy={y} r="3.2" />
        </>
      )}
    </svg>
  );
}

export function WeatherBar({
  state,
  locale,
  originLabel,
}: {
  state: WeatherState;
  locale: Locale;
  originLabel: string;
}) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [motion, setMotion] = useState(initialMotion);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  useEffect(() => {
    // Animations pause while the page is in the background.
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const toggleMotion = () =>
    setMotion((current) => {
      try {
        localStorage.setItem(MOTION_KEY, current ? 'off' : 'on');
      } catch {
        /* Storage is optional. */
      }
      return !current;
    });

  const zone = state.status === 'ready' ? state.forecast.timezone : 'Pacific/Auckland';
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en-NZ';
  const clock = (time: number) =>
    new Intl.DateTimeFormat(language, {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(time);
  const dayClock = (time: number) =>
    new Intl.DateTimeFormat(language, {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(time);
  const place = state.place === 'origin' ? originLabel : t('weatherCityCentre');

  let art: Art = 'none';
  let icon: ReactNode = <Cloud />;
  let info: WeatherCodeInfo | undefined;
  let headline: ReactNode = t('weatherLoading');
  let context = place;
  let sun: SunPosition | undefined;
  const details: ReactNode[] = [];
  if (state.status === 'error') {
    icon = <CloudOff />;
    headline = t('weatherUnavailable');
  } else if (state.status === 'ready') {
    const { moment } = state;
    if (moment.kind === 'need-time') {
      icon = <CircleDashed />;
      headline = t('weatherNeedTime');
    } else if (moment.kind === 'out-of-range') {
      icon = <CircleDashed />;
      headline = t('weatherOutOfRangeShort');
      if (moment.until !== undefined)
        context = `${place} · ${t('weatherOutOfRange', { time: dayClock(moment.until) })}`;
    } else if (moment.kind === 'missing-current') {
      icon = <CloudOff />;
      headline = t('weatherUnavailable');
    } else {
      const { sample } = moment;
      sun = moment.sun;
      info = describeWeatherCode(sample.weatherCode!);
      ({ art, icon } = artFor(info, sample.isDay));
      const description =
        weatherDescription(info.code, locale) ?? t('weatherUnknown', { code: info.code });
      headline = (
        <>
          <strong>
            {sample.temperatureC === undefined ? '—' : `${Math.round(sample.temperatureC)}°C`}
          </strong>
          <span>{description}</span>
        </>
      );
      context = `${place} · ${
        moment.kind === 'current'
          ? `${t('weatherNow')} · ${t('weatherModelEstimate', { time: clock(sample.time) })}`
          : t('weatherForecastAt', { time: dayClock(sample.time) })
      }`;
      if (moment.precipitation)
        details.push(
          t('weatherPrecip', {
            value: Math.round(moment.precipitation.probability),
            period: `${clock(moment.precipitation.start)}–${clock(moment.precipitation.end)}`,
          }),
        );
      if (sample.windKmh !== undefined)
        details.push(t('weatherWind', { value: Math.round(sample.windKmh) }));
      if (sun?.phase === 'dawn' || sun?.phase === 'dusk')
        context = `${context} · ${t(sun.phase === 'dawn' ? 'weatherDawn' : 'weatherDusk')}`;
    }
    if (state.stale) details.push(t('weatherStale', { time: clock(state.forecast.fetchedAt) }));
  }

  return (
    <section
      className={`sc-weather ${expanded ? 'is-expanded' : ''}`}
      aria-label={t('weatherTitle')}
      data-motion={motion ? 'on' : 'off'}
      data-paused={hidden ? 'true' : 'false'}
      data-condition={info?.condition ?? state.status}
    >
      <WeatherArt art={art} icon={icon} info={info} phase={sun?.phase ?? 'unknown'} />
      <div className="sc-weather-main">
        <p className="sc-weather-headline">
          {headline}
          {state.status === 'ready' && state.demo && (
            <span className="sc-tag">{t('weatherDemo')}</span>
          )}
        </p>
        <p className="sc-weather-context">{context}</p>
      </div>
      <div className="sc-weather-details" id={detailsId}>
        {sun && (
          <span className="sc-sun">
            <SunArc sun={sun} />
            <span>
              {t('weatherSunrise', { time: clock(sun.sunrise) })} ·{' '}
              {t('weatherSunset', { time: clock(sun.sunset) })}
            </span>
          </span>
        )}
        {details.map((item) => (
          <span key={item as string}>{item}</span>
        ))}
        <a href={OPEN_METEO_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
          {t('weatherSource')}
        </a>
      </div>
      <div className="sc-weather-actions">
        <button
          type="button"
          className="sc-icon-button"
          aria-label={t('weatherMotion')}
          title={t('weatherMotion')}
          aria-pressed={motion}
          onClick={toggleMotion}
        >
          <Sparkles size={16} />
        </button>
        <button
          type="button"
          className="sc-icon-button sc-weather-expand"
          aria-label={t('weatherDetails')}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronDown size={16} />
        </button>
      </div>
    </section>
  );
}
