import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  Bookmark,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Fuel,
  House,
  Info,
  Layers3,
  Leaf,
  LocateFixed,
  MapPin,
  Moon,
  Plus,
  RotateCcw,
  Route,
  Settings2,
  ShieldCheck,
  Sun,
  TrainFront,
  Trash2,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import {
  compareOptions,
  createExampleOptions,
  DEFAULT_SETTINGS,
  type CommuteSettings,
  type JourneyOption,
  type Location,
  type RouteComparison,
  type RouteResult,
  type TravelLeg,
} from '@smart-commute/core';
import {
  GoogleRouteProvider,
  DATA_SOURCES,
  type RouteResult as ProviderRouteResult,
} from '@smart-commute/providers';
import { createTranslator, formatMoney, type Locale, type MessageKey } from '@smart-commute/i18n';
import { ATFareHelper } from './ATFareHelper';

export interface SmartCommutePlannerProps {
  destination: Location | string;
  origin?: Location | string;
  locale?: Locale;
  fuelPrice?: number;
  fuelConsumption?: number;
  theme?: 'light' | 'dark';
  onRouteSelected?: (result: RouteResult) => void;
  /** Optional restricted browser key. Google loads only after an explicit user action. */
  googleApiKey?: string;
}

type Screen = 'planner' | 'comparison' | 'breakdown' | 'settings' | 'about';
type Direction = 'outbound' | 'inbound';
type Translator = ReturnType<typeof createTranslator>;
interface PlannerState {
  origin: Location;
  destination: Location;
  settings: CommuteSettings;
  options: JourneyOption[];
  places: Location[];
  savedRoutes: JourneyOption[];
  departure: string;
  returnTime: string;
  leaveNow: boolean;
}
const STORAGE_KEY = 'smart-commute-nz:v1';
const directionKeys = { outbound: 'outbound', inbound: 'inbound' } as const;
const legKeys = {
  drive: 'drive',
  bus: 'bus',
  train: 'train',
  walk: 'walk',
  wait: 'wait',
  parking: 'parkingTime',
} as const;
const warningKeys = {
  'estimated-data': 'estimatedWarning',
  'unverified-parking': 'parkingWarning',
  'missing-return': 'returnWarning',
} as const;
const toLocation = (value: Location | string): Location =>
  typeof value === 'string' ? { label: value } : value;
const cloneOption = (option: JourneyOption): JourneyOption => ({
  ...option,
  outbound: option.outbound.map((leg) => ({ ...leg })),
  inbound: option.inbound.map((leg) => ({ ...leg })),
  waypoints: option.waypoints.map((place) => ({ ...place })),
});
const shortNumber = (value: number) =>
  new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 1 }).format(value);
const hasGoogleProvenance = (option: JourneyOption) =>
  option.id.startsWith('google-') ||
  [...option.outbound, ...option.inbound].some((leg) => leg.source === 'google');
const usesATFare = (option: JourneyOption, roundTrip: boolean) =>
  [...option.outbound, ...(roundTrip ? option.inbound : [])].some(
    (leg) => (leg.mode === 'bus' || leg.mode === 'train') && leg.source === 'at-rule',
  );
const atFareContext = (option: JourneyOption, state: PlannerState, currentMinute: number) =>
  JSON.stringify({
    origin: state.origin,
    destination: state.destination,
    leaveNow: state.leaveNow,
    departure: state.leaveNow ? currentMinute : state.departure,
    returnTime: state.returnTime,
    roundTrip: state.settings.roundTrip,
    waypoints: option.waypoints,
    outbound: option.outbound.map((leg) => [
      leg.mode,
      leg.durationMinutes,
      leg.distanceKm,
      leg.transfers,
    ]),
    inbound: option.inbound.map((leg) => [
      leg.mode,
      leg.durationMinutes,
      leg.distanceKm,
      leg.transfers,
    ]),
  });

function initialState(props: SmartCommutePlannerProps): PlannerState {
  const fallback: PlannerState = {
    origin: toLocation(props.origin ?? '4 Fong Road, Auckland'),
    destination: toLocation(props.destination),
    settings: {
      ...DEFAULT_SETTINGS,
      fuelPrice: props.fuelPrice ?? DEFAULT_SETTINGS.fuelPrice,
      fuelConsumption: props.fuelConsumption ?? DEFAULT_SETTINGS.fuelConsumption,
    },
    options: createExampleOptions(),
    places: [],
    savedRoutes: [],
    departure: '',
    returnTime: '',
    leaveNow: true,
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const saved = parsed as Partial<PlannerState>;
    if (!saved.settings || !Array.isArray(saved.options) || !saved.origin || !saved.destination)
      return fallback;
    saved.options = saved.options.filter((option) => !hasGoogleProvenance(option));
    if (!saved.options.length) saved.options = createExampleOptions();
    compareOptions(saved.options, saved.settings);
    if (typeof saved.origin.label !== 'string' || typeof saved.destination.label !== 'string')
      return fallback;
    return {
      ...fallback,
      ...saved,
      origin: props.origin ? toLocation(props.origin) : saved.origin,
      destination: toLocation(props.destination),
      settings: {
        ...saved.settings,
        fuelPrice: props.fuelPrice ?? saved.settings.fuelPrice,
        fuelConsumption: props.fuelConsumption ?? saved.settings.fuelConsumption,
      },
      places: Array.isArray(saved.places)
        ? saved.places.filter((place) => place && typeof place.label === 'string')
        : [],
      savedRoutes: Array.isArray(saved.savedRoutes)
        ? saved.savedRoutes.filter((option) => {
            try {
              compareOptions([option], saved.settings!);
              return !hasGoogleProvenance(option);
            } catch {
              return false;
            }
          })
        : [],
    };
  } catch {
    return fallback;
  }
}

function NumberField({
  label,
  value,
  onChange,
  t,
  step = '0.1',
  max,
  suffix,
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  t: Translator;
  step?: string;
  max?: number;
  suffix?: string;
  integer?: boolean;
}) {
  const id = useId();
  const invalid =
    !Number.isFinite(value) ||
    value < 0 ||
    (max !== undefined && value > max) ||
    (integer && !Number.isInteger(value));
  return (
    <div className={`sc-field ${invalid ? 'sc-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="sc-number-wrap">
        <input
          id={id}
          type="number"
          min="0"
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
          }
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {invalid && (
        <small id={`${id}-error`} className="sc-error">
          {t('invalidNumber')}
        </small>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="sc-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ModeIcon({ mode, size = 19 }: { mode: JourneyOption['mode']; size?: number }) {
  return mode === 'drive' ? (
    <Car size={size} />
  ) : mode === 'transit' ? (
    <TrainFront size={size} />
  ) : (
    <Layers3 size={size} />
  );
}

export function SmartCommutePlanner(props: SmartCommutePlannerProps) {
  const plannerId = useId();
  const [state, setState] = useState<PlannerState>(() => initialState(props));
  const [locale, setLocale] = useState<Locale>(props.locale ?? 'en');
  const [theme, setTheme] = useState<'light' | 'dark'>(props.theme ?? 'light');
  const [screen, setScreen] = useState<Screen>('planner');
  const [editingMode, setEditingMode] = useState<JourneyOption['mode']>('drive');
  const [selectedId, setSelectedId] = useState('drive');
  const [notice, setNotice] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [waypointDraft, setWaypointDraft] = useState('');
  const [inputsOpen, setInputsOpen] = useState(false);
  const [googleConsent, setGoogleConsent] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<
    'idle' | 'loading' | 'ready' | 'routes' | 'error'
  >('idle');
  const [googleRequests, setGoogleRequests] = useState(0);
  const [googleError, setGoogleError] = useState('');
  const [googleResponse, setGoogleResponse] = useState<ProviderRouteResult | null>(null);
  const [addressSearchEnabled, setAddressSearchEnabled] = useState(false);
  const [addressSearchPending, setAddressSearchPending] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  // AT verification is session-only: no Google Places content enters new storage
  // metadata, and restored AT-derived amounts require explicit re-verification.
  const [atFareContexts, setATFareContexts] = useState<Record<string, string>>({});
  const [currentMinute, setCurrentMinute] = useState(() => Math.floor(Date.now() / 60000));
  const googleMapRef = useRef<HTMLDivElement>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const originSearchRef = useRef<HTMLDivElement>(null);
  const destinationSearchRef = useRef<HTMLDivElement>(null);
  const autocompleteCleanup = useRef<(() => void)[]>([]);
  const autocompleteGeneration = useRef(0);
  const autocompletePending = useRef(false);
  const routePending = useRef(false);
  const googlePlaceSignatures = useRef(new Set<string>());
  const manualLocations = useRef({ origin: state.origin, destination: state.destination });
  const provider = useMemo(
    () => new GoogleRouteProvider({ apiKey: props.googleApiKey }),
    [props.googleApiKey],
  );
  const activeProvider = useRef(provider);
  activeProvider.current = provider;
  const liveQueryFingerprint = JSON.stringify({
    origin: state.origin,
    destination: state.destination,
    roundTrip: state.settings.roundTrip,
    leaveNow: state.leaveNow,
    departure: state.departure,
    returnTime: state.returnTime,
    waypoints: state.options
      .filter((option) => !hasGoogleProvenance(option) && option.mode === 'drive')
      .map((option) => ({ id: option.id, waypoints: option.waypoints })),
  });
  const activeQuery = useRef(liveQueryFingerprint);
  activeQuery.current = liveQueryFingerprint;
  const t = useMemo(() => createTranslator(locale), [locale]);
  const money = (value: number) => formatMoney(value, locale);
  const nameOf = (option: JourneyOption | RouteResult) =>
    option.id === 'drive'
      ? t('driveName')
      : option.id === 'transit'
        ? t('transitName')
        : option.id === 'hybrid'
          ? t('hybridName')
          : option.name;
  const comparison = useMemo<{
    result: RouteComparison | null;
    error: boolean;
    incompleteOptions: JourneyOption[];
    staleFareOptions: JourneyOption[];
  }>(() => {
    try {
      if (!state.origin.label.trim() || !state.destination.label.trim())
        return { result: null, error: true, incompleteOptions: [], staleFareOptions: [] };
      const all = compareOptions(state.options, state.settings);
      // Core exposes partial totals with a warning for callers that need them.
      // A planner must not rank those as complete round trips or project them.
      const incompleteOptions = all.results
        .filter((result) => result.warnings.includes('missing-return'))
        .map((result) => result.option);
      const staleFareOptions = all.results
        .filter(
          (result) =>
            usesATFare(result.option, state.settings.roundTrip) &&
            atFareContexts[result.id] !== atFareContext(result.option, state, currentMinute),
        )
        .map((result) => result.option);
      if (!incompleteOptions.length && !staleFareOptions.length)
        return { result: all, error: false, incompleteOptions, staleFareOptions };
      const excluded = new Set(
        [...incompleteOptions, ...staleFareOptions].map((option) => option.id),
      );
      const completeOptions = all.results
        .filter((result) => !excluded.has(result.id))
        .map((result) => result.option);
      return {
        result: completeOptions.length ? compareOptions(completeOptions, state.settings) : null,
        error: false,
        incompleteOptions,
        staleFareOptions,
      };
    } catch {
      return { result: null, error: true, incompleteOptions: [], staleFareOptions: [] };
    }
  }, [state, atFareContexts, currentMinute]);
  const noComparableRoutesKey = comparison.staleFareOptions.length
    ? 'noComparableRoutes'
    : 'noCompleteRoutes';
  const selected =
    comparison.result?.results.find((result) => result.id === selectedId) ??
    comparison.result?.results[0];

  useEffect(() => {
    if (props.locale) setLocale(props.locale);
  }, [props.locale]);
  useEffect(() => {
    if (props.theme) setTheme(props.theme);
  }, [props.theme]);
  useEffect(() => {
    const destination = toLocation(props.destination);
    setState((current) =>
      JSON.stringify(current.destination) === JSON.stringify(destination)
        ? current
        : { ...current, destination },
    );
  }, [props.destination]);
  useEffect(() => {
    if (props.origin === undefined) return;
    const origin = toLocation(props.origin);
    setState((current) =>
      JSON.stringify(current.origin) === JSON.stringify(origin) ? current : { ...current, origin },
    );
  }, [props.origin]);
  useEffect(() => {
    setState((current) => {
      const fuelPrice = props.fuelPrice ?? current.settings.fuelPrice;
      const fuelConsumption = props.fuelConsumption ?? current.settings.fuelConsumption;
      return fuelPrice === current.settings.fuelPrice &&
        fuelConsumption === current.settings.fuelConsumption
        ? current
        : { ...current, settings: { ...current.settings, fuelPrice, fuelConsumption } };
    });
  }, [props.fuelPrice, props.fuelConsumption]);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  useEffect(() => {
    // Update leave-now eligibility at minute boundaries, without any API request.
    let minuteTimer: number | undefined;
    const firstTimer = window.setTimeout(
      () => {
        setCurrentMinute(Math.floor(Date.now() / 60000));
        minuteTimer = window.setInterval(
          () => setCurrentMinute(Math.floor(Date.now() / 60000)),
          60000,
        );
      },
      60000 - (Date.now() % 60000),
    );
    return () => {
      window.clearTimeout(firstTimer);
      if (minuteTimer !== undefined) window.clearInterval(minuteTimer);
    };
  }, []);
  useEffect(() => {
    // Reattach the existing Google map after tab navigation; no new map/API request.
    if (screen === 'planner' && googleMapRef.current && mapElementRef.current) {
      googleMapRef.current.replaceChildren(mapElementRef.current);
    }
  }, [screen]);
  useEffect(() => {
    autocompleteGeneration.current += 1;
    autocompleteCleanup.current.forEach((cleanup) => cleanup());
    autocompleteCleanup.current = [];
    autocompletePending.current = false;
    setAddressSearchEnabled(false);
    setAddressSearchPending(false);
  }, [screen, googleConsent, provider]);
  useEffect(() => {
    setState((current) =>
      current.options.some(hasGoogleProvenance)
        ? { ...current, options: current.options.filter((option) => !hasGoogleProvenance(option)) }
        : current,
    );
    setGoogleResponse(null);
    provider.clearMapRoutes();
  }, [liveQueryFingerprint, provider]);
  useEffect(() => {
    mapElementRef.current = null;
    setGoogleStatus('idle');
    setGoogleRequests(0);
    setGoogleError('');
    return () => {
      autocompleteGeneration.current += 1;
      autocompleteCleanup.current.forEach((cleanup) => cleanup());
      autocompleteCleanup.current = [];
    };
  }, [provider]);
  useEffect(() => () => provider.dispose(), [provider]);
  useEffect(() => {
    if (comparison.error) return;
    try {
      const manualOptions = state.options.filter((option) => !hasGoogleProvenance(option));
      for (const direction of ['origin', 'destination'] as const) {
        if (!googlePlaceSignatures.current.has(JSON.stringify(state[direction])))
          manualLocations.current[direction] = state[direction];
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...state,
          origin: manualLocations.current.origin,
          destination: manualLocations.current.destination,
          options: manualOptions.length ? manualOptions : createExampleOptions(),
          savedRoutes: state.savedRoutes.filter((option) => !hasGoogleProvenance(option)),
        }),
      );
      localStorage.setItem('smart-commute-nz:appearance', JSON.stringify({ locale, theme }));
    } catch {
      /* A private browser or full storage still supports the calculator. */
    }
  }, [state, comparison.error, locale, theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updateSettings = (patch: Partial<CommuteSettings>) =>
    setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  const updateOption = (id: string, patch: Partial<JourneyOption>) =>
    setState((current) => ({
      ...current,
      options: current.options.map((option) =>
        option.id === id ? { ...option, ...patch } : option,
      ),
    }));
  const updateLeg = (id: string, direction: Direction, index: number, patch: Partial<TravelLeg>) =>
    setState((current) => ({
      ...current,
      options: current.options.map((option) =>
        option.id === id
          ? {
              ...option,
              [direction]: option[direction].map((leg, legIndex) => {
                if (legIndex === index) {
                  const explicitFare = Object.keys(patch).length === 1 && 'fare' in patch;
                  const stillTransit =
                    (patch.mode ?? leg.mode) === 'bus' || (patch.mode ?? leg.mode) === 'train';
                  return {
                    ...leg,
                    ...patch,
                    source:
                      leg.source === 'at-rule' && !explicitFare && stillTransit
                        ? 'at-rule'
                        : 'manual',
                    estimated: true,
                  };
                }
                // An explicit fare edit is the user's manual total for this
                // direction, including the zero-priced integrated segments.
                if (
                  Object.keys(patch).length === 1 &&
                  'fare' in patch &&
                  leg.source === 'at-rule' &&
                  (leg.mode === 'bus' || leg.mode === 'train')
                )
                  return { ...leg, source: 'manual', estimated: true };
                return leg;
              }),
            }
          : option,
      ),
    }));
  const selectResult = (result: RouteResult) => {
    setSelectedId(result.id);
    props.onRouteSelected?.(result);
    if (hasGoogleProvenance(result.option)) provider.renderRoute(result.id);
    else provider.clearMapRoutes();
  };
  const savePlace = (place: Location) => {
    if (!place.label.trim()) return;
    if (googlePlaceSignatures.current.has(JSON.stringify(place))) {
      setNotice(t('googlePlaceNotSaved'));
      return;
    }
    setState((current) => ({
      ...current,
      places: [...current.places.filter((saved) => saved.label !== place.label), place],
    }));
    setNotice(t('savedPlaceAdded'));
  };
  const useLocation = () => {
    setLocationError(false);
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState((current) => ({
          ...current,
          origin: {
            label: `${t('currentLocation')} (${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)})`,
            coordinates: { lat: position.coords.latitude, lng: position.coords.longitude },
          },
        }));
        setLocationLoading(false);
      },
      () => {
        setLocationLoading(false);
        setLocationError(true);
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };
  const addDrivingRoute = () => {
    const first = state.options.find(
      (option) => option.mode === 'drive' && !hasGoogleProvenance(option),
    );
    if (!first) return;
    const count = state.options.filter((option) => option.mode === 'drive').length;
    const option = {
      ...cloneOption(first),
      id: `drive-${Date.now()}`,
      name: t('routeNumber', { number: count + 1 }),
    };
    setState((current) => ({ ...current, options: [...current.options, option] }));
  };
  const addWaypoint = (option: JourneyOption) => {
    if (!waypointDraft.trim()) return;
    updateOption(option.id, { waypoints: [...option.waypoints, { label: waypointDraft.trim() }] });
    setWaypointDraft('');
  };
  const saveRoute = (option: JourneyOption) => {
    if (hasGoogleProvenance(option) || comparison.error) return;
    setState((current) => ({
      ...current,
      savedRoutes: [
        ...current.savedRoutes.filter((route) => route.id !== option.id),
        cloneOption(option),
      ],
    }));
    setNotice(t('routeSaved'));
  };
  const loadGoogle = async () => {
    if (!googleConsent || !props.googleApiKey || !googleMapRef.current) return;
    setGoogleError('');
    setGoogleStatus('loading');
    try {
      mapElementRef.current ??= document.createElement('div');
      mapElementRef.current.style.width = '100%';
      mapElementRef.current.style.height = '100%';
      googleMapRef.current.replaceChildren(mapElementRef.current);
      await provider.initializeMap(mapElementRef.current);
      if (activeProvider.current !== provider) {
        provider.dispose();
        return;
      }
      provider.renderRoute(selectedId);
      setGoogleStatus('ready');
    } catch (error) {
      if (activeProvider.current !== provider) return;
      setGoogleError(error instanceof Error ? error.message : t('googleError'));
      setGoogleStatus('error');
    }
  };
  const enableAddressSearch = async () => {
    if (
      !googleConsent ||
      autocompletePending.current ||
      addressSearchEnabled ||
      !originSearchRef.current ||
      !destinationSearchRef.current
    )
      return;
    autocompletePending.current = true;
    setAddressSearchPending(true);
    const generation = ++autocompleteGeneration.current;
    const originElement = originSearchRef.current;
    const destinationElement = destinationSearchRef.current;
    const isCurrent = () =>
      generation === autocompleteGeneration.current &&
      activeProvider.current === provider &&
      originSearchRef.current === originElement &&
      destinationSearchRef.current === destinationElement &&
      originElement.isConnected &&
      destinationElement.isConnected;
    setGoogleError('');
    const onError = (error: Error) => setGoogleError(error.message);
    try {
      const attach = async (field: 'origin' | 'destination', element: HTMLElement) => {
        const cleanup = await provider.attachAutocomplete(
          element,
          (location) => {
            if (!isCurrent()) return;
            googlePlaceSignatures.current.add(JSON.stringify(location));
            setState((current) => ({ ...current, [field]: location }));
          },
          onError,
        );
        if (!isCurrent()) {
          cleanup();
          return false;
        }
        autocompleteCleanup.current.push(cleanup);
        return true;
      };
      if (!(await attach('origin', originElement))) return;
      if (!(await attach('destination', destinationElement))) return;
      setAddressSearchEnabled(true);
    } catch (error) {
      if (!isCurrent()) return;
      autocompleteCleanup.current.forEach((cleanup) => cleanup());
      autocompleteCleanup.current = [];
      setGoogleError(error instanceof Error ? error.message : t('googleError'));
    } finally {
      if (generation === autocompleteGeneration.current) {
        autocompletePending.current = false;
        setAddressSearchPending(false);
      }
    }
  };
  const getGoogleRoutes = async (mode: 'drive' | 'transit' = 'drive') => {
    if (!googleConsent || comparison.error || routePending.current) return;
    if (state.settings.roundTrip && !state.returnTime) {
      setNotice(t('googleMissingReturn'));
      return;
    }
    setGoogleStatus('routes');
    routePending.current = true;
    const query = activeQuery.current;
    setGoogleError('');
    try {
      const response = await provider.getRoutes({
        origin: state.origin,
        destination: state.destination,
        mode,
        waypoints:
          mode === 'drive'
            ? (state.options.find((option) => option.id === selectedId && option.mode === 'drive')
                ?.waypoints ?? [])
            : [],
        departureTime: state.leaveNow || !state.departure ? new Date() : new Date(state.departure),
        returnTime: state.settings.roundTrip ? new Date(state.returnTime) : undefined,
        roundTrip: state.settings.roundTrip,
      });
      if (activeProvider.current !== provider || activeQuery.current !== query) {
        provider.clearMapRoutes();
        return;
      }
      setGoogleResponse(response);
      setState((current) => ({
        ...current,
        options: [
          ...current.options.filter((option) => !hasGoogleProvenance(option)),
          ...response.routes,
        ],
      }));
      setGoogleRequests(provider.getMetrics().routeRequests);
      setGoogleStatus('ready');
      setNotice(t('googleRouteAdded'));
      if (response.routes[0]) {
        setSelectedId(response.routes[0].id);
        provider.renderRoute(response.routes[0].id);
      }
    } catch (error) {
      if (activeProvider.current !== provider || activeQuery.current !== query) return;
      setGoogleRequests(provider.getMetrics().routeRequests);
      setGoogleError(error instanceof Error ? error.message : t('googleError'));
    } finally {
      routePending.current = false;
      if (activeProvider.current === provider) {
        setGoogleRequests(provider.getMetrics().routeRequests);
        setGoogleStatus('ready');
      }
    }
  };

  const renderDriveLeg = (option: JourneyOption, direction: Direction, index: number) => {
    const leg = option[direction][index];
    const directionName = t(directionKeys[direction]);
    const primary = option.id === 'drive';
    return (
      <div className="sc-driving-fields" key={`${direction}-${index}`}>
        <div className="sc-field-grid">
          <NumberField
            label={
              primary
                ? t(direction === 'outbound' ? 'outboundDistance' : 'inboundDistance')
                : `${option.name} · ${t('legDistance', { direction: directionName })}`
            }
            value={leg.distanceKm ?? 0}
            onChange={(distanceKm) => updateLeg(option.id, direction, index, { distanceKm })}
            t={t}
          />
          <NumberField
            label={t('legDuration', { direction: directionName })}
            value={leg.durationMinutes}
            onChange={(durationMinutes) =>
              updateLeg(option.id, direction, index, { durationMinutes })
            }
            t={t}
            step="1"
          />
          <NumberField
            label={t('legConsumption', { direction: directionName })}
            value={leg.fuelConsumption ?? state.settings.fuelConsumption}
            onChange={(fuelConsumption) =>
              updateLeg(option.id, direction, index, { fuelConsumption })
            }
            t={t}
          />
          <NumberField
            label={t('legToll', { direction: directionName })}
            value={leg.toll ?? 0}
            onChange={(toll) => updateLeg(option.id, direction, index, { toll })}
            t={t}
          />
        </div>
        {leg.fuelConsumption !== undefined && (
          <button
            className="sc-text-button"
            onClick={() => updateLeg(option.id, direction, index, { fuelConsumption: undefined })}
          >
            {t('useDefaultConsumption')}
          </button>
        )}
      </div>
    );
  };

  const renderTransitLeg = (option: JourneyOption, direction: Direction, index: number) => {
    const leg = option[direction][index];
    const transitIndex = option[direction].findIndex(
      (segment) => segment.mode === 'bus' || segment.mode === 'train',
    );
    const fareLabel =
      index === transitIndex
        ? option.mode === 'transit'
          ? t(direction === 'outbound' ? 'outboundFare' : 'inboundFare')
          : t(direction === 'outbound' ? 'hybridOutboundFare' : 'hybridInboundFare')
        : t('segmentFare', { mode: t(legKeys[leg.mode]) });
    return (
      <div className="sc-transit-segment" key={`${direction}-${index}`}>
        <div className="sc-segment-head">
          <label>
            {t('legType')}
            <select
              value={leg.mode}
              onChange={(event) =>
                updateLeg(option.id, direction, index, {
                  mode: event.target.value as TravelLeg['mode'],
                  fare: ['bus', 'train'].includes(event.target.value) ? (leg.fare ?? 0) : undefined,
                  transfers: 0,
                })
              }
            >
              {(['bus', 'train', 'walk', 'wait', 'parking'] as const).map((mode) => (
                <option value={mode} key={mode}>
                  {t(legKeys[mode])}
                </option>
              ))}
            </select>
          </label>
          <button
            className="sc-icon-button"
            aria-label={t('removeSegment')}
            onClick={() =>
              updateOption(option.id, {
                [direction]: option[direction].filter((_, segmentIndex) => segmentIndex !== index),
              })
            }
          >
            <X size={15} />
          </button>
        </div>
        <div className="sc-field-grid">
          <NumberField
            label={t('segmentDuration', { mode: t(legKeys[leg.mode]) })}
            value={leg.durationMinutes}
            onChange={(durationMinutes) =>
              updateLeg(option.id, direction, index, { durationMinutes })
            }
            t={t}
            step="1"
          />
          {['bus', 'train'].includes(leg.mode) && (
            <>
              <NumberField
                label={fareLabel}
                value={leg.fare ?? 0}
                onChange={(fare) => updateLeg(option.id, direction, index, { fare })}
                t={t}
              />
              <NumberField
                label={t('transfers')}
                value={leg.transfers ?? 0}
                onChange={(transfers) => updateLeg(option.id, direction, index, { transfers })}
                t={t}
                step="1"
                integer
              />
            </>
          )}
        </div>
      </div>
    );
  };

  const renderOptionEditor = (option: JourneyOption) => (
    <div key={option.id} className="sc-option-editor" data-testid={`route-editor-${option.id}`}>
      <div className="sc-editor-title">
        <h3>{nameOf(option)}</h3>
        {option.id !== 'drive' && option.mode === 'drive' && (
          <button
            className="sc-icon-button"
            aria-label={t('removeRoute')}
            onClick={() =>
              setState((current) => ({
                ...current,
                options: current.options.filter((route) => route.id !== option.id),
              }))
            }
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {!['drive', 'transit', 'hybrid'].includes(option.id) && (
        <TextField
          label={t('routeName')}
          value={option.name}
          onChange={(name) => updateOption(option.id, { name })}
        />
      )}
      {option.mode === 'hybrid' && (
        <>
          <TextField
            label={t('hub')}
            value={option.waypoints[0]?.label ?? ''}
            onChange={(label) =>
              updateOption(option.id, {
                waypoints: [{ label }, ...option.waypoints.slice(1)],
                parkingVerified: false,
              })
            }
          />
          <div className="sc-parking-alert">
            <Info size={16} />
            <span>{t('parkingUnknown')}</span>
          </div>
          <label className="sc-checkbox">
            <input
              type="checkbox"
              checked={Boolean(option.parkingVerified)}
              onChange={(event) =>
                updateOption(option.id, { parkingVerified: event.target.checked })
              }
            />
            <span>{t('parkingAcknowledgment')}</span>
          </label>
        </>
      )}
      {(['outbound', 'inbound'] as const)
        .filter((direction) => direction === 'outbound' || state.settings.roundTrip)
        .map((direction) => (
          <details className="sc-direction" open={direction === 'outbound'} key={direction}>
            <summary>
              {t(directionKeys[direction])}
              <ChevronDown size={15} />
            </summary>
            <div className="sc-direction-body">
              {option[direction].map((leg, index) =>
                leg.mode === 'drive'
                  ? renderDriveLeg(option, direction, index)
                  : renderTransitLeg(option, direction, index),
              )}
              {option.mode !== 'drive' && (
                <button
                  className="sc-small-button"
                  onClick={() =>
                    updateOption(option.id, {
                      [direction]: [
                        ...option[direction],
                        { mode: 'walk', durationMinutes: 5, source: 'manual', estimated: true },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  {t('addSegment')}
                </button>
              )}
            </div>
          </details>
        ))}
      {option.mode !== 'transit' && (
        <NumberField
          label={t(option.mode === 'hybrid' ? 'stationParking' : 'parking')}
          value={option.parkingCost}
          onChange={(parkingCost) =>
            updateOption(option.id, { parkingCost, parkingVerified: false })
          }
          t={t}
        />
      )}
      {option.mode !== 'drive' && !hasGoogleProvenance(option) && (
        <ATFareHelper
          option={option}
          locale={locale}
          roundTrip={state.settings.roundTrip}
          locationContext={JSON.stringify([state.origin, state.destination])}
          departureTime={state.leaveNow ? new Date() : new Date(state.departure)}
          returnTime={state.returnTime ? new Date(state.returnTime) : undefined}
          onApply={(outboundFare, returnFare) => {
            setATFareContexts((current) => ({
              ...current,
              [option.id]: atFareContext(option, state, currentMinute),
            }));
            const assign = (legs: TravelLeg[], fare: number) => {
              const first = legs.findIndex((leg) => leg.mode === 'bus' || leg.mode === 'train');
              return legs.map((leg, index): TravelLeg =>
                leg.mode === 'bus' || leg.mode === 'train'
                  ? { ...leg, fare: index === first ? fare : 0, source: 'at-rule', estimated: true }
                  : leg,
              );
            };
            updateOption(option.id, {
              outbound: assign(option.outbound, outboundFare),
              ...(state.settings.roundTrip ? { inbound: assign(option.inbound, returnFare) } : {}),
            });
          }}
        />
      )}
      {option.mode === 'drive' && !hasGoogleProvenance(option) && (
        <div className="sc-waypoints">
          <h4>{t('waypoints')}</h4>
          <p>{t('waypointNote')}</p>
          {option.waypoints.map((place, index) => (
            <div className="sc-waypoint-chip" key={`${index}-${place.label}`}>
              <MapPin size={14} />
              <span>{place.label}</span>
              <button
                className="sc-icon-button"
                aria-label={`${t('removeWaypoint')} ${place.label}`}
                onClick={() =>
                  updateOption(option.id, {
                    waypoints: option.waypoints.filter((_, placeIndex) => placeIndex !== index),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="sc-inline-field">
            <input
              aria-label={t('waypoints')}
              placeholder={t('waypointPlaceholder')}
              value={waypointDraft}
              onChange={(event) => setWaypointDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addWaypoint(option);
              }}
            />
            <button
              className="sc-icon-button sc-solid"
              aria-label={t('addWaypoint')}
              disabled={!waypointDraft.trim()}
              onClick={() => addWaypoint(option)}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
      )}
      {!hasGoogleProvenance(option) && (
        <button
          className="sc-text-button"
          disabled={comparison.error}
          onClick={() => saveRoute(option)}
        >
          <Bookmark size={14} />
          {t('saveRoute')}
        </button>
      )}
    </div>
  );

  const renderInputs = () => (
    <aside className={`sc-input-panel ${inputsOpen ? 'sc-inputs-open' : ''}`}>
      <button
        className="sc-mobile-input-toggle"
        onClick={() => setInputsOpen(!inputsOpen)}
        aria-expanded={inputsOpen}
      >
        <Settings2 size={18} />
        {t(inputsOpen ? 'collapseInputs' : 'editInputs')}
        <ChevronDown size={17} />
      </button>
      <div className="sc-input-content">
        <div className="sc-panel-heading">
          <span className="sc-icon-tile">
            <Route size={18} />
          </span>
          <div>
            <h2>{t('yourJourney')}</h2>
            <span>{t('region')}</span>
          </div>
        </div>
        <div className="sc-location-fields">
          <div className="sc-location-row">
            <span className="sc-route-dot" />
            <TextField
              label={t('origin')}
              value={state.origin.label}
              onChange={(label) => setState((current) => ({ ...current, origin: { label } }))}
            />
            <button
              className="sc-icon-button"
              aria-label={t('saveOrigin')}
              onClick={() => savePlace(state.origin)}
            >
              <Bookmark size={16} />
            </button>
          </div>
          <div className="sc-location-row">
            <MapPin className="sc-destination-pin" size={19} />
            <TextField
              label={t('destination')}
              value={state.destination.label}
              onChange={(label) => setState((current) => ({ ...current, destination: { label } }))}
            />
            <button
              className="sc-icon-button"
              aria-label={t('saveDestination')}
              onClick={() => savePlace(state.destination)}
            >
              <Bookmark size={16} />
            </button>
          </div>
          <button
            className="sc-swap"
            aria-label={t('swap')}
            onClick={() =>
              setState((current) => ({
                ...current,
                origin: current.destination,
                destination: current.origin,
              }))
            }
          >
            <ArrowDownUp size={15} />
          </button>
        </div>
        {(!state.origin.label.trim() || !state.destination.label.trim()) && (
          <p className="sc-error">{t('invalidLocation')}</p>
        )}
        <button className="sc-text-button" onClick={useLocation} disabled={locationLoading}>
          <LocateFixed size={14} />
          {t(locationLoading ? 'locating' : 'useLocation')}
        </button>
        <p className="sc-help">{t('manualLocationNote')}</p>
        {props.googleApiKey && (
          <div
            className="sc-address-search"
            style={{ display: addressSearchEnabled && googleConsent ? 'block' : 'none' }}
          >
            <p>{t('googleOriginSearch')}</p>
            <div ref={originSearchRef} />
            <p>{t('googleDestinationSearch')}</p>
            <div ref={destinationSearchRef} />
            <p className="sc-help">{t('googlePlaceNotSaved')}</p>
          </div>
        )}
        {locationError && (
          <p role="alert" className="sc-error">
            {t('locationFailed')}
          </p>
        )}
        <details className="sc-saved-places">
          <summary>
            {t('savedPlaces')}
            <ChevronDown size={14} />
          </summary>
          {state.places.length === 0 ? (
            <p>{t('noSavedPlaces')}</p>
          ) : (
            state.places.map((place) => (
              <div className="sc-saved-place" key={place.label}>
                <span>{place.label}</span>
                <button
                  title={t('applyOrigin')}
                  aria-label={`${t('applyOrigin')} ${place.label}`}
                  onClick={() => setState((current) => ({ ...current, origin: place }))}
                >
                  <House size={14} />
                </button>
                <button
                  title={t('applyDestination')}
                  aria-label={`${t('applyDestination')} ${place.label}`}
                  onClick={() => setState((current) => ({ ...current, destination: place }))}
                >
                  <MapPin size={14} />
                </button>
                <button
                  aria-label={`${t('removePlace')} ${place.label}`}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      places: current.places.filter((saved) => saved.label !== place.label),
                    }))
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </details>
        <div className="sc-schedule">
          <label className="sc-checkbox">
            <input
              type="checkbox"
              checked={state.settings.roundTrip}
              onChange={(event) => updateSettings({ roundTrip: event.target.checked })}
            />
            <span>{t('roundTrip')}</span>
          </label>
          <label className="sc-checkbox">
            <input
              type="checkbox"
              checked={state.leaveNow}
              onChange={(event) =>
                setState((current) => ({ ...current, leaveNow: event.target.checked }))
              }
            />
            <span>{t('leaveNow')}</span>
          </label>
          {!state.leaveNow && (
            <label className="sc-field">
              {t('departure')}
              <input
                type="datetime-local"
                value={state.departure}
                onChange={(event) =>
                  setState((current) => ({ ...current, departure: event.target.value }))
                }
              />
            </label>
          )}
          {state.settings.roundTrip && (
            <label className="sc-field">
              {t('returnTime')}
              <input
                type="datetime-local"
                value={state.returnTime}
                onChange={(event) =>
                  setState((current) => ({ ...current, returnTime: event.target.value }))
                }
              />
            </label>
          )}
          <p className="sc-help">
            {t('browserTimezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
          </p>
        </div>
        <div className="sc-divider" />
        <div className="sc-section-title">
          <Fuel size={17} />
          <h3>{t('carParameters')}</h3>
        </div>
        <div className="sc-field-grid">
          <NumberField
            label={t('fuelPrice')}
            value={state.settings.fuelPrice}
            onChange={(fuelPrice) => updateSettings({ fuelPrice })}
            t={t}
          />
          <NumberField
            label={t('fuelConsumption')}
            value={state.settings.fuelConsumption}
            onChange={(fuelConsumption) => updateSettings({ fuelConsumption })}
            t={t}
          />
        </div>
        <div className="sc-divider" />
        <h3 className="sc-section-heading">{t('routeParameters')}</h3>
        <p className="sc-help">{t('routeHint')}</p>
        <div className="sc-mode-switch" role="group" aria-label={t('routeParameters')}>
          {(['drive', 'transit', 'hybrid'] as const).map((mode) => (
            <button
              key={mode}
              className={editingMode === mode ? 'is-active' : ''}
              onClick={() => setEditingMode(mode)}
              aria-pressed={editingMode === mode}
            >
              <ModeIcon mode={mode} size={16} />
              <span>{t(mode)}</span>
            </button>
          ))}
        </div>
        {state.options.filter((option) => option.mode === editingMode).map(renderOptionEditor)}
        {editingMode === 'drive' && (
          <button className="sc-small-button sc-full-width" onClick={addDrivingRoute}>
            <Plus size={15} />
            {t('alternativeRoute')}
          </button>
        )}
        {state.savedRoutes.length > 0 && (
          <details className="sc-saved-places">
            <summary>
              {t('savedRoutes')}
              <ChevronDown size={14} />
            </summary>
            {state.savedRoutes.map((option) => (
              <div className="sc-saved-place" key={option.id}>
                <span>{nameOf(option)}</span>
                <button
                  aria-label={`${t('loadRoute')} ${nameOf(option)}`}
                  onClick={() => {
                    if (usesATFare(option, state.settings.roundTrip))
                      setATFareContexts((current) => {
                        const next = { ...current };
                        delete next[option.id];
                        return next;
                      });
                    setState((current) => ({
                      ...current,
                      options: [
                        ...current.options.filter((route) => route.id !== option.id),
                        cloneOption(option),
                      ],
                    }));
                    setEditingMode(option.mode);
                  }}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  aria-label={`${t('deleteSavedRoute')} ${nameOf(option)}`}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      savedRoutes: current.savedRoutes.filter((route) => route.id !== option.id),
                    }))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </details>
        )}
        <p className="sc-help sc-return-note">
          <Info size={13} />
          {t('estimatedReturn')}
        </p>
      </div>
    </aside>
  );

  const renderSchematic = () => (
    <section className="sc-map-panel" aria-label={t('schematic')}>
      <div className="sc-map-toolbar">
        <span>
          <Compass size={17} />
          {t('schematic')}
        </span>
        <span className="sc-tag">
          <WifiOff size={12} />
          {t('manualMode')}
        </span>
      </div>
      <div className="sc-schematic-canvas">
        <div className="sc-map-contour contour-one" />
        <div className="sc-map-contour contour-two" />
        <div className="sc-map-contour contour-three" />
        <div className="sc-diagram-line" />
        <div className="sc-diagram-node sc-node-start">
          <div className="sc-node-icon">
            <House size={23} />
          </div>
          <div className="sc-node-label">
            <span>{t('start')}</span>
            <strong>{state.origin.label || '—'}</strong>
          </div>
        </div>
        <div className="sc-diagram-node sc-node-hub">
          <div className="sc-node-icon">
            <TrainFront size={22} />
          </div>
          <div className="sc-node-label">
            <span>{t('interchange')}</span>
            <strong>
              {state.options.find((option) => option.mode === 'hybrid')?.waypoints[0]?.label ||
                t('hub')}
            </strong>
            <small>{t('hybrid')}</small>
          </div>
        </div>
        <div className="sc-diagram-node sc-node-end">
          <div className="sc-node-icon">
            <MapPin size={24} />
          </div>
          <div className="sc-node-label">
            <span>{t('finish')}</span>
            <strong>{state.destination.label || '—'}</strong>
          </div>
        </div>
        <span className="sc-schematic-note">{t('schematicNote')}</span>
      </div>
      <div className="sc-map-explainer">
        <span className="sc-icon-tile">
          <Leaf size={20} />
        </span>
        <div>
          <h3>{t('manualMapTitle')}</h3>
          <p>{t('manualMapBody')}</p>
        </div>
      </div>
      <p className="sc-map-footnote">{t('mapFooter')}</p>
      {props.googleApiKey && (
        <div className="sc-google-controls">
          <p>{t('googleSourceDescription')}</p>
          <label className="sc-checkbox">
            <input
              type="checkbox"
              checked={googleConsent}
              onChange={(event) => setGoogleConsent(event.target.checked)}
            />
            <span>{t('googleConsent')}</span>
          </label>
          {(googleStatus === 'idle' || googleStatus === 'loading' || googleStatus === 'error') && (
            <button
              className="sc-small-button"
              disabled={!googleConsent || googleStatus === 'loading'}
              onClick={loadGoogle}
            >
              {t(googleStatus === 'loading' ? 'googleLoading' : 'enableMap')}
            </button>
          )}
          {googleStatus === 'ready' && (
            <>
              <button
                className="sc-small-button"
                onClick={() => void getGoogleRoutes('drive')}
                disabled={!googleConsent || comparison.error}
              >
                {t('getGoogleRoutes')}
              </button>
              <button
                className="sc-small-button"
                onClick={() => void getGoogleRoutes('transit')}
                disabled={!googleConsent || comparison.error}
              >
                {t('getGoogleTransit')}
              </button>
              {!addressSearchEnabled && (
                <button
                  className="sc-small-button"
                  disabled={!googleConsent || addressSearchPending}
                  onClick={() => void enableAddressSearch()}
                >
                  {t(addressSearchPending ? 'googleLoading' : 'enableAddressSearch')}
                </button>
              )}
            </>
          )}
          {googleStatus === 'routes' && <p role="status">{t('googleRoutesLoading')}</p>}
          {googleError && (
            <p className="sc-error" role="alert">
              {t('googleError')} {googleError}
            </p>
          )}
          <small>{t('googleMetrics', { count: googleRequests })}</small>
        </div>
      )}
      <div
        className={`sc-google-map ${googleStatus === 'idle' ? 'sc-google-map-hidden' : ''}`}
        ref={googleMapRef}
        aria-label={t('googleMapDescription')}
      />
    </section>
  );

  const renderResults = () => (
    <aside className="sc-results-panel">
      <div className="sc-results-heading">
        <div>
          <h2>{t('yourOptions')}</h2>
          <p>{t('optionCount', { count: comparison.result?.results.length ?? 0 })}</p>
        </div>
        <span className="sc-mini-pill">
          {t(state.settings.roundTrip ? 'returnIncluded' : 'oneWay')}
        </span>
      </div>
      {comparison.error && (
        <div className="sc-empty-state" role="alert">
          <Info size={26} />
          <h3>{t('validationSummary')}</h3>
          <p>{t('noResults')}</p>
        </div>
      )}
      {!comparison.error && !comparison.result && (
        <div className="sc-empty-state">
          <Info size={26} />
          <h3>{t(noComparableRoutesKey)}</h3>
        </div>
      )}
      {comparison.result?.results.map((result) => (
        <button
          key={result.id}
          className={`sc-result-card ${selected?.id === result.id ? 'is-selected' : ''}`}
          onClick={() => selectResult(result)}
          aria-label={t('selectRoute', { name: nameOf(result) })}
          aria-pressed={selected?.id === result.id}
          data-testid={`route-card-${result.id}`}
        >
          <div className="sc-result-top">
            <span className={`sc-mode-icon sc-mode-${result.mode}`}>
              <ModeIcon mode={result.mode} />
            </span>
            <div>
              <strong>{nameOf(result)}</strong>
              <span className="sc-result-source">
                {hasGoogleProvenance(result.option)
                  ? t('googleVerifiedGeometry')
                  : [...result.option.outbound, ...result.option.inbound].some(
                        (leg) => leg.source === 'at-rule',
                      )
                    ? t('atFareSource')
                    : t('manual')}
              </span>
            </div>
            {selected?.id === result.id && <Check size={16} className="sc-selection-check" />}
          </div>
          <div className="sc-result-value">
            <span className="sc-money" data-testid={`cost-${result.id}`}>
              {money(result.totalCost)}
            </span>
            <span>{t('perCommute')}</span>
          </div>
          <div className="sc-result-meta">
            <span>
              <Clock3 size={13} />
              {t('minutes', { count: shortNumber(result.totalMinutes) })}
            </span>
            <span>{t('km', { count: shortNumber(result.distanceKm) })}</span>
            <span>{t('transferCount', { count: result.transfers })}</span>
          </div>
          <div className="sc-result-badges">
            {comparison.result?.cheapest.id === result.id && (
              <span className="sc-badge sc-badge-green">
                <Wallet size={11} />
                {t('cheapest')}
              </span>
            )}
            {comparison.result?.fastest.id === result.id && (
              <span className="sc-badge sc-badge-blue">
                <Clock3 size={11} />
                {t('fastest')}
              </span>
            )}
            {comparison.result?.bestValue.id === result.id && (
              <span className="sc-badge sc-badge-neutral">{t('bestValue')}</span>
            )}
            {comparison.result?.fewestTransfers.id === result.id && (
              <span className="sc-badge sc-badge-neutral">{t('fewestTransfers')}</span>
            )}
          </div>
          {result.warnings.includes('unverified-parking') && (
            <span className="sc-result-warning">
              <Info size={12} />
              {t('parkingWarning')}
            </span>
          )}
        </button>
      ))}
      {selected && (
        <div className="sc-projection">
          <span>
            <Wallet size={16} />
            {t('monthlyProjection')}
          </span>
          <strong>{money(selected.monthlyCost)}</strong>
          <p>
            {t('basedOn', {
              days: state.settings.daysPerWeek,
              weeks: state.settings.weeksPerMonth,
            })}
          </p>
        </div>
      )}
      {comparison.result && comparison.result.results.length > 1 && (
        <div className="sc-recommendation">
          <span className="sc-recommend-icon">
            <Leaf size={18} />
          </span>
          <div>
            <h3>{t('recommendation')}</h3>
            <p>
              {t('savingReason', {
                cheapest: nameOf(comparison.result.cheapest),
                other: nameOf(comparison.result.results[comparison.result.results.length - 1]),
                saving: money(
                  comparison.result.results[comparison.result.results.length - 1].totalCost -
                    comparison.result.cheapest.totalCost,
                ),
              })}
            </p>
            {comparison.result.cheapest.totalMinutes > comparison.result.fastest.totalMinutes && (
              <p>
                {t('slowerReason', {
                  minutes: shortNumber(
                    comparison.result.cheapest.totalMinutes -
                      comparison.result.fastest.totalMinutes,
                  ),
                })}
              </p>
            )}
            <p>
              {t('valueReason', {
                value: money(state.settings.valueOfTime),
                name: nameOf(comparison.result.bestValue),
              })}
            </p>
          </div>
        </div>
      )}
      <button className="sc-text-button sc-results-link" onClick={() => setScreen('comparison')}>
        {t('comparison')}
        <ArrowRight size={15} />
      </button>
    </aside>
  );

  const renderComparison = () => (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('comparison')}</span>
        <h1>{t('compareHeading')}</h1>
        <p>{t('compareDescription')}</p>
      </div>
      {comparison.result ? (
        <>
          <div className="sc-comparison-highlights">
            {(['cheapest', 'fastest', 'fewestTransfers', 'bestValue'] as const).map((kind) => {
              const result = comparison.result![kind];
              return (
                <button key={kind} onClick={() => selectResult(result)}>
                  <span>{t(kind)}</span>
                  <strong>{nameOf(result)}</strong>
                  <small>
                    {kind === 'fastest'
                      ? t('minutes', { count: shortNumber(result.totalMinutes) })
                      : kind === 'fewestTransfers'
                        ? t('transferCount', { count: result.transfers })
                        : money(kind === 'bestValue' ? result.generalizedCost : result.totalCost)}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="sc-table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      'route',
                      'cost',
                      'time',
                      'transfers',
                      'weekly',
                      'monthly',
                      'costWithTime',
                    ] as const
                  ).map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.result.results.map((result) => (
                  <tr key={result.id} className={selected?.id === result.id ? 'is-selected' : ''}>
                    <td>
                      <button className="sc-table-route" onClick={() => selectResult(result)}>
                        <ModeIcon mode={result.mode} size={17} />
                        {nameOf(result)}
                        {selected?.id === result.id && <Check size={14} />}
                      </button>
                    </td>
                    <td>
                      <strong>{money(result.totalCost)}</strong>
                    </td>
                    <td>{t('minutes', { count: shortNumber(result.totalMinutes) })}</td>
                    <td>{result.transfers}</td>
                    <td>{money(result.weeklyCost)}</td>
                    <td>{money(result.monthlyCost)}</td>
                    <td>{money(result.generalizedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sc-help">{t('timeValueExplanation')}</p>
          <button className="sc-primary-button" onClick={() => setScreen('breakdown')}>
            {t('breakdown')}
            <ChevronRight size={16} />
          </button>
        </>
      ) : (
        <p role="alert">{t(comparison.error ? 'validationSummary' : noComparableRoutesKey)}</p>
      )}
    </section>
  );

  const renderBreakdown = () => {
    const pieces: { key: MessageKey; value: number; color: string }[] = selected
      ? [
          { key: 'fuel', value: selected.fuelCost, color: '#007f6d' },
          { key: 'fares', value: selected.fareCost, color: '#a4bd73' },
          { key: 'parkingLabel', value: selected.parkingCost, color: '#dfba73' },
          { key: 'tolls', value: selected.tollCost, color: '#839daf' },
          { key: 'maintenance', value: selected.maintenanceCost, color: '#ad97b6' },
        ]
      : [];
    return (
      <section className="sc-page-content">
        <div className="sc-page-title">
          <span className="sc-eyebrow">{t('breakdown')}</span>
          <h1>{t('breakdownHeading')}</h1>
          <p>{t('breakdownDescription')}</p>
        </div>
        {selected ? (
          <>
            <div className="sc-breakdown-switch">
              {comparison.result?.results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => selectResult(result)}
                  className={selected.id === result.id ? 'is-active' : ''}
                >
                  <ModeIcon mode={result.mode} size={16} />
                  {nameOf(result)}
                </button>
              ))}
            </div>
            <div className="sc-breakdown-grid">
              <div className="sc-surface">
                <h2>{t('components')}</h2>
                <div className="sc-breakdown-total">
                  <strong>{money(selected.totalCost)}</strong>
                  <span>{t('perCommute')}</span>
                </div>
                <div
                  className="sc-stacked-bar"
                  role="img"
                  aria-label={pieces
                    .map((piece) => `${t(piece.key)}: ${money(piece.value)}`)
                    .join(', ')}
                >
                  {pieces
                    .filter((piece) => piece.value > 0)
                    .map((piece) => (
                      <span
                        key={piece.key}
                        style={{ flex: piece.value, background: piece.color }}
                      />
                    ))}
                </div>
                <dl className="sc-cost-lines">
                  {pieces.map((piece) => (
                    <div key={piece.key}>
                      <dt>
                        <i style={{ background: piece.color }} />
                        {t(piece.key)}
                      </dt>
                      <dd>{money(piece.value)}</dd>
                    </div>
                  ))}
                  <div className="sc-cost-total">
                    <dt>{t('total')}</dt>
                    <dd>{money(selected.totalCost)}</dd>
                  </div>
                </dl>
                <p className="sc-help">{t('formula')}</p>
              </div>
              <div className="sc-surface sc-budget-surface">
                <h2>{t('commutingPattern')}</h2>
                <div className="sc-budget-number">
                  <span>{t('weekly')}</span>
                  <strong>{money(selected.weeklyCost)}</strong>
                </div>
                <div className="sc-budget-number">
                  <span>{t('monthly')}</span>
                  <strong>{money(selected.monthlyCost)}</strong>
                </div>
                <p>
                  {t('basedOn', {
                    days: state.settings.daysPerWeek,
                    weeks: state.settings.weeksPerMonth,
                  })}
                </p>
                <div className="sc-divider" />
                <dl className="sc-cost-lines">
                  <div>
                    <dt>{t('timeValue')}</dt>
                    <dd>{money(selected.generalizedCost - selected.totalCost)}</dd>
                  </div>
                  <div>
                    <dt>{t('generalizedCost')}</dt>
                    <dd>{money(selected.generalizedCost)}</dd>
                  </div>
                </dl>
                <p className="sc-help">{t('timeValueExplanation')}</p>
              </div>
            </div>
            <div className="sc-surface sc-segments-surface">
              <h2>{t('journeySegments')}</h2>
              {(['outbound', 'inbound'] as const)
                .filter((direction) => direction === 'outbound' || state.settings.roundTrip)
                .map((direction) => (
                  <div className="sc-segment-list" key={direction}>
                    <h3>
                      {t(directionKeys[direction])}
                      <span>
                        {money(selected.breakdown[direction].totalCost)} ·{' '}
                        {t('minutes', {
                          count: shortNumber(selected.breakdown[direction].totalMinutes),
                        })}
                      </span>
                    </h3>
                    {selected.option[direction].map((leg, index) => (
                      <div className="sc-segment-item" key={index}>
                        <span className="sc-segment-count">{index + 1}</span>
                        <strong>{t(legKeys[leg.mode])}</strong>
                        <span>{t('minutes', { count: shortNumber(leg.durationMinutes) })}</span>
                        <span>
                          {leg.distanceKm !== undefined
                            ? t('km', { count: shortNumber(leg.distanceKm) })
                            : '—'}
                        </span>
                        <span className="sc-tag">
                          {leg.source === 'google'
                            ? 'Google'
                            : leg.source === 'at-rule'
                              ? t('atFareSource')
                              : t('manual')}{' '}
                          · {t(leg.estimated ? 'estimated' : 'verified')}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
            <div className="sc-warnings">
              {selected.warnings.map((warning) => (
                <p key={warning}>
                  <Info size={15} />
                  {t(warningKeys[warning])}
                </p>
              ))}
            </div>
          </>
        ) : (
          <p role="alert">{t(comparison.error ? 'validationSummary' : noComparableRoutesKey)}</p>
        )}
      </section>
    );
  };

  const renderSettings = () => (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('settings')}</span>
        <h1>{t('settingsHeading')}</h1>
        <p>{t('settingsDescription')}</p>
      </div>
      <div className="sc-settings-grid">
        <div className="sc-surface">
          <div className="sc-section-title">
            <Fuel size={20} />
            <h2>{t('carParameters')}</h2>
          </div>
          <div className="sc-field-grid">
            <NumberField
              label={t('fuelPrice')}
              value={state.settings.fuelPrice}
              onChange={(fuelPrice) => updateSettings({ fuelPrice })}
              t={t}
            />
            <NumberField
              label={t('fuelConsumption')}
              value={state.settings.fuelConsumption}
              onChange={(fuelConsumption) => updateSettings({ fuelConsumption })}
              t={t}
            />
          </div>
          <NumberField
            label={t('maintenancePerKm')}
            value={state.settings.maintenancePerKm}
            onChange={(maintenancePerKm) => updateSettings({ maintenancePerKm })}
            t={t}
            step="0.01"
          />
          <p className="sc-help">{t('upkeepExplanation')}</p>
        </div>
        <div className="sc-surface">
          <div className="sc-section-title">
            <Clock3 size={20} />
            <h2>{t('commutingPattern')}</h2>
          </div>
          <div className="sc-field-grid">
            <NumberField
              label={t('daysPerWeek')}
              value={state.settings.daysPerWeek}
              onChange={(daysPerWeek) => updateSettings({ daysPerWeek })}
              t={t}
              step="1"
              max={7}
            />
            <NumberField
              label={t('weeksPerMonth')}
              value={state.settings.weeksPerMonth}
              onChange={(weeksPerMonth) => updateSettings({ weeksPerMonth })}
              t={t}
              step="0.01"
            />
          </div>
          <NumberField
            label={t('valueOfTime')}
            value={state.settings.valueOfTime}
            onChange={(valueOfTime) => updateSettings({ valueOfTime })}
            t={t}
          />
          <p className="sc-help">{t('timeValueExplanation')}</p>
        </div>
        <div className="sc-surface">
          <h2>{t('theme')}</h2>
          <div className="sc-appearance-buttons">
            <button
              aria-pressed={theme === 'light'}
              className={theme === 'light' ? 'is-active' : ''}
              onClick={() => setTheme('light')}
            >
              <Sun size={20} />
              {t('light')}
            </button>
            <button
              aria-pressed={theme === 'dark'}
              className={theme === 'dark' ? 'is-active' : ''}
              onClick={() => setTheme('dark')}
            >
              <Moon size={20} />
              {t('dark')}
            </button>
          </div>
          <label className="sc-field">
            {t('language')}
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
        </div>
        <div className="sc-surface">
          <span className="sc-icon-tile">
            <ShieldCheck size={23} />
          </span>
          <h2>{t('privacy')}</h2>
          <p>{t('storageNote')}</p>
          <button
            className="sc-small-button"
            onClick={() => {
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {
                /* Storage is optional. */
              }
              setState({
                origin: toLocation(props.origin ?? '4 Fong Road, Auckland'),
                destination: toLocation(props.destination),
                settings: { ...DEFAULT_SETTINGS },
                options: createExampleOptions(),
                places: [],
                savedRoutes: [],
                departure: '',
                returnTime: '',
                leaveNow: true,
              });
              setSelectedId('drive');
              setNotice(t('resetDone'));
            }}
          >
            <RotateCcw size={15} />
            {t('reset')}
          </button>
        </div>
      </div>
    </section>
  );

  const renderAbout = () => (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('about')}</span>
        <h1>{t('aboutHeading')}</h1>
        <p>{t('aboutDescription')}</p>
      </div>
      <div className="sc-about-grid">
        <div className="sc-surface sc-about-formula">
          <span className="sc-icon-tile">
            <Wallet size={23} />
          </span>
          <h2>{t('howItWorks')}</h2>
          <strong>{t('formula')}</strong>
          <p>{t('formulaExplanation')}</p>
          <p>{t('timeValueExplanation')}</p>
        </div>
        <div className="sc-surface">
          <span className="sc-icon-tile">
            <ShieldCheck size={23} />
          </span>
          <h2>{t('privacy')}</h2>
          <p>{t('privacyDescription')}</p>
        </div>
      </div>
      <div className="sc-surface sc-data-sources">
        <h2>{t('dataSources')}</h2>
        {(['exampleSource', 'atSource', 'parkingSource', 'googleSource'] as const).map((key) => (
          <div className="sc-source-row" key={key}>
            <span className="sc-source-dot" />
            <div>
              <h3>{t(key)}</h3>
              <p>{t(`${key}Description` as MessageKey)}</p>
              {key === 'googleSource' && (
                <span className="sc-tag">
                  {t(props.googleApiKey ? 'googleReady' : 'googleNoKey')}
                </span>
              )}
              {key === 'atSource' && (
                <div className="sc-source-links">
                  <a
                    href="https://at.govt.nz/bus-train-ferry/fares-discounts"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('officialFares')}
                    <ArrowRight size={13} />
                  </a>
                  <a href="https://dev-portal.at.govt.nz/" target="_blank" rel="noreferrer">
                    {t('officialDeveloper')}
                    <ArrowRight size={13} />
                  </a>
                </div>
              )}
              {key === 'parkingSource' && (
                <a
                  href="https://at.govt.nz/driving-and-parking/park-ride"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('officialParking')}
                  <ArrowRight size={13} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  const tabs: { key: Screen; label: MessageKey }[] = [
    { key: 'planner', label: 'planner' },
    { key: 'comparison', label: 'comparison' },
    { key: 'breakdown', label: 'breakdown' },
    { key: 'settings', label: 'settings' },
    { key: 'about', label: 'about' },
  ];
  return (
    <div className={`smart-commute sc-theme-${theme}`} lang={locale}>
      <header className="sc-header">
        <a
          className="sc-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setScreen('planner');
          }}
        >
          <span className="sc-brand-symbol">
            <Route size={26} />
          </span>
          <span>
            <strong>
              {t('appName')}
              <span className="sc-brand-nz">NZ</span>
            </strong>
            <small>{t('appTagline')}</small>
          </span>
        </a>
        <div className="sc-header-region">
          <MapPin size={14} />
          {t('region')}
        </div>
        <div className="sc-header-actions">
          <span className="sc-status-dot" />
          <span className="sc-header-status">{t('manualMode')}</span>
          <select
            aria-label={t('language')}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            <option value="en">EN</option>
            <option value="zh-CN">简体中文</option>
          </select>
          <button
            className="sc-icon-button"
            aria-label={t(theme === 'light' ? 'dark' : 'light')}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>
      <nav className="sc-navigation" role="tablist" aria-label={t('appName')}>
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={screen === tab.key}
            aria-controls={`${plannerId}-screen`}
            id={`${plannerId}-tab-${tab.key}`}
            tabIndex={screen === tab.key ? 0 : -1}
            className={screen === tab.key ? 'is-active' : ''}
            onClick={() => setScreen(tab.key)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setScreen(tabs[next].key);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              buttons?.[next]?.focus();
            }}
          >
            {t(tab.label)}
          </button>
        ))}
      </nav>
      <main
        id={`${plannerId}-screen`}
        role="tabpanel"
        aria-labelledby={`${plannerId}-tab-${screen}`}
        tabIndex={0}
      >
        {!online && (
          <p className="sc-connection-banner" role="status">
            <WifiOff size={16} />
            {t('offlineConnection')}
          </p>
        )}
        {comparison.incompleteOptions.length > 0 && (
          <section className="sc-connection-banner sc-incomplete-warning" role="alert">
            <Info size={16} />
            <div>
              <p>{t('incompleteReturnNotice')}</p>
              <ul>
                {comparison.incompleteOptions.map((option) => (
                  <li key={option.id}>
                    <strong>{nameOf(option)}</strong> — {t('returnWarning')}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
        {comparison.staleFareOptions.length > 0 && (
          <section className="sc-connection-banner sc-incomplete-warning" role="alert">
            <Info size={16} />
            <div>
              <p>{t('staleFareNotice')}</p>
              <ul>
                {comparison.staleFareOptions.map((option) => (
                  <li key={option.id}>
                    <strong>{nameOf(option)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
        {screen === 'planner' && (
          <>
            <section className="sc-planner-intro">
              <div>
                <span className="sc-eyebrow">
                  <span />
                  {t('region')}
                </span>
                <h1>{t('headline')}</h1>
                <p>{t('subheadline')}</p>
              </div>
              <span className="sc-intro-note">
                <Leaf size={20} />
                {t('offlineStatus')}
              </span>
            </section>
            <div className="sc-demo-banner">
              <Info size={17} />
              <p>{t('demoNotice')}</p>
              <span className="sc-tag">{t('demoData')}</span>
            </div>
            <div className="sc-workspace">
              {renderInputs()}
              {renderSchematic()}
              {renderResults()}
            </div>
          </>
        )}
        {screen === 'comparison' && renderComparison()}
        {screen === 'breakdown' && renderBreakdown()}
        {screen === 'settings' && renderSettings()}
        {screen === 'about' && renderAbout()}
        {googleResponse && (
          <section className="sc-google-attribution" aria-label={t('googleDetails')}>
            <strong>{googleResponse.attribution}</strong>
            <span>{t('googleDetails')}</span>
            {googleResponse.attributionLinks?.map((link) =>
              link.url ? (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ) : (
                <span key={link.label}>{link.label}</span>
              ),
            )}
            {googleResponse.warnings.map((warning) => (
              <p key={warning}>
                <Info size={14} />
                {warning}
              </p>
            ))}
          </section>
        )}
        {screen === 'about' && (
          <section className="sc-page-content sc-registry">
            <div className="sc-surface">
              <h2>{t('sourceRegistry')}</h2>
              {DATA_SOURCES.map((source) => (
                <div className="sc-source-row" key={source.id}>
                  <div>
                    <strong>{source.name}</strong>
                    <p>{t('sourceReviewed', { date: source.verifiedOn, status: source.status })}</p>
                    {source.url && (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {t('openOfficial')}
                      </a>
                    )}
                  </div>
                </div>
              ))}
              <div className="sc-source-links">
                <a href={`${import.meta.env.BASE_URL}privacy.html`}>{t('privacyPolicy')}</a>
                <a href={`${import.meta.env.BASE_URL}terms.html`}>{t('termsOfUse')}</a>
              </div>
            </div>
          </section>
        )}
      </main>
      <footer className="sc-footer">
        <span>
          <Leaf size={13} />
          {t('footer')}
        </span>
        <span>{t('offlineStatus')}</span>
      </footer>
      {notice && (
        <div className="sc-toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="sc-icon-button"
            aria-label={t('dismissNotice')}
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
