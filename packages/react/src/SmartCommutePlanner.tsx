import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  ArrowDown,
  ArrowRight,
  ArrowUp,
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
  type CostRange,
  type JourneyOption,
  type Location,
  type RouteComparison,
  type RouteResult,
  type TravelLeg,
} from '@smart-commute/core';
import {
  GoogleRouteProvider,
  RouteProviderError,
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
  /** Optional restricted browser key. Online planners load the map and address search on mount. */
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
  'fare-range-estimate': 'fareRangeHelp',
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
    (leg) =>
      (leg.mode === 'bus' || leg.mode === 'train') &&
      (leg.fareSource === 'at-rule' || leg.source === 'at-rule'),
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

const defaultReturnTime = () => {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

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
    returnTime: props.googleApiKey ? defaultReturnTime() : '',
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
      returnTime: saved.returnTime || fallback.returnTime,
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
  allowEmpty = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  t: Translator;
  step?: string;
  max?: number;
  suffix?: string;
  integer?: boolean;
  allowEmpty?: boolean;
}) {
  const id = useId();
  const invalid =
    (!Number.isFinite(value) && !(allowEmpty && Number.isNaN(value))) ||
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
  const [stopoverSearchOpen, setStopoverSearchOpen] = useState(false);
  const [stopoverDraft, setStopoverDraft] = useState<Location>({ label: '' });
  const stopoverDraftRef = useRef(stopoverDraft);
  stopoverDraftRef.current = stopoverDraft;
  const [mapStopoverPicking, setMapStopoverPicking] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [manualRequested, setManualRequested] = useState(false);
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
  const stopoverSearchRef = useRef<HTMLDivElement>(null);
  const stopoverSearchControl = useRef<(() => void) | null>(null);
  const stopoverPickCleanup = useRef<(() => void) | null>(null);
  const autocompleteCleanup = useRef<(() => void)[]>([]);
  const autocompleteControls = useRef<
    { field: 'origin' | 'destination'; setValue: (value: string) => void }[]
  >([]);
  const autocompleteGeneration = useRef(0);
  const autocompletePending = useRef(false);
  const routePending = useRef(false);
  const mapLoadPending = useRef(false);
  const mapReadyProvider = useRef<GoogleRouteProvider | null>(null);
  const resetProvider = useRef<GoogleRouteProvider | null>(null);
  const mounted = useRef(true);
  const lastRequestedQuery = useRef('');
  const lastRequestedMode = useRef<'drive' | 'transit'>('drive');
  const googlePlaceSignatures = useRef(new Set<string>());
  const manualLocations = useRef({ origin: state.origin, destination: state.destination });
  const provider = useMemo(
    () =>
      new GoogleRouteProvider({
        apiKey: props.googleApiKey,
        trafficAware: true,
        estimateMissingTransitFare: true,
      }),
    [props.googleApiKey],
  );
  const activeProvider = useRef(provider);
  activeProvider.current = provider;
  const googleMode =
    Boolean(props.googleApiKey) && online && !manualRequested && googleStatus !== 'error';
  const visibleOptions = useMemo(
    () =>
      state.options.filter((option) =>
        googleMode ? hasGoogleProvenance(option) : !hasGoogleProvenance(option),
      ),
    [state.options, googleMode],
  );
  const drivingPreference = state.options.find(
    (option) => option.mode === 'drive' && !hasGoogleProvenance(option),
  );
  const drivingStops = useMemo(
    () => drivingPreference?.waypoints ?? [],
    [drivingPreference?.waypoints],
  );
  const stopoverRoutingBlocked = editingMode === 'transit' && drivingStops.length > 0;
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
  const moneyWithRange = (value: number, range?: CostRange) =>
    range
      ? range.min === range.max
        ? t('approximateAmount', { amount: money(range.max) })
        : t('fareRangeValue', { min: money(range.min), max: money(range.max) })
      : money(value);
  const generalizedRange = (result: RouteResult): CostRange | undefined => {
    if (!result.totalCostRange) return;
    const timeCost = result.generalizedCost - result.totalCost;
    return { min: result.totalCostRange.min + timeCost, max: result.totalCostRange.max + timeCost };
  };
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
      if (!visibleOptions.length) {
        // Validate settings without presenting offline examples as live routes.
        compareOptions(
          state.options.filter((option) => !hasGoogleProvenance(option)),
          state.settings,
        );
        return { result: null, error: false, incompleteOptions: [], staleFareOptions: [] };
      }
      const all = compareOptions(visibleOptions, state.settings);
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
  }, [state, visibleOptions, atFareContexts, currentMinute]);
  const noComparableRoutesKey = comparison.staleFareOptions.length
    ? 'noComparableRoutes'
    : 'noCompleteRoutes';
  const selected =
    comparison.result?.results.find((result) => result.id === selectedId) ??
    comparison.result?.results[0];
  const hasFareRanges = Boolean(comparison.result?.results.some((result) => result.totalCostRange));
  const fareExplanationKey = (option: JourneyOption) => {
    const ranges = [...option.outbound, ...(state.settings.roundTrip ? option.inbound : [])]
      .filter((leg) => leg.fare === undefined && leg.fareRange)
      .map((leg) => leg.fareRange!);
    return ranges.length && ranges.every((range) => range.basis === 'citylink')
      ? 'cityLinkFareRangeHelp'
      : 'fareRangeHelp';
  };
  const rankingLabel = (kind: 'cheapest' | 'fastest' | 'fewestTransfers' | 'bestValue') =>
    t(
      hasFareRanges && kind === 'cheapest'
        ? 'budgetCheapest'
        : hasFareRanges && kind === 'bestValue'
          ? 'budgetBestValue'
          : kind,
    );

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
    if (screen === 'planner' && googleMode && googleMapRef.current && mapElementRef.current) {
      googleMapRef.current.replaceChildren(mapElementRef.current);
    }
  }, [screen, googleMode]);
  useEffect(() => {
    autocompleteGeneration.current += 1;
    autocompleteCleanup.current.forEach((cleanup) => cleanup());
    autocompleteCleanup.current = [];
    autocompleteControls.current = [];
    autocompletePending.current = false;
    setAddressSearchEnabled(false);
    setAddressSearchPending(false);
  }, [screen, googleMode, provider]);
  useEffect(() => {
    for (const control of autocompleteControls.current) {
      control.setValue(control.field === 'origin' ? state.origin.label : state.destination.label);
    }
  }, [state.origin.label, state.destination.label, addressSearchEnabled]);
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
    if (resetProvider.current === provider) return;
    resetProvider.current = provider;
    mapElementRef.current = null;
    mapReadyProvider.current = null;
    mapLoadPending.current = false;
    lastRequestedQuery.current = '';
    setGoogleStatus('idle');
    setGoogleRequests(0);
    setGoogleError('');
  }, [provider]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      autocompleteGeneration.current += 1;
      autocompleteCleanup.current.forEach((cleanup) => cleanup());
      autocompleteCleanup.current = [];
      autocompleteControls.current = [];
      // StrictMode immediately remounts effects. Dispose only after a real exit.
      queueMicrotask(() => {
        if (!mounted.current || activeProvider.current !== provider) provider.dispose();
      });
    };
  }, [provider]);
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
          options: (manualOptions.length ? manualOptions : createExampleOptions()).map(
            (option) => ({
              ...option,
              waypoints: option.waypoints.filter(
                (place) => !googlePlaceSignatures.current.has(JSON.stringify(place)),
              ),
            }),
          ),
          savedRoutes: state.savedRoutes.filter(
            (option) =>
              !hasGoogleProvenance(option) &&
              !option.waypoints.some((place) =>
                googlePlaceSignatures.current.has(JSON.stringify(place)),
              ),
          ),
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
  const updateDrivingCosts = (patch: {
    parkingCost?: number;
    outboundToll?: number;
    inboundToll?: number;
  }) =>
    setState((current) => ({
      ...current,
      options: current.options.map((option) => {
        if (
          option.mode !== 'drive' ||
          (option.id !== drivingPreference?.id && !hasGoogleProvenance(option))
        )
          return option;
        return {
          ...option,
          ...(patch.parkingCost === undefined
            ? {}
            : { parkingCost: patch.parkingCost, parkingVerified: false }),
          outbound: option.outbound.map((leg) =>
            leg.mode === 'drive' && patch.outboundToll !== undefined
              ? { ...leg, toll: patch.outboundToll }
              : leg,
          ),
          inbound: option.inbound.map((leg) =>
            leg.mode === 'drive' && patch.inboundToll !== undefined
              ? { ...leg, toll: patch.inboundToll }
              : leg,
          ),
        };
      }),
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
                  const explicitFare = 'fare' in patch;
                  const stillTransit =
                    (patch.mode ?? leg.mode) === 'bus' || (patch.mode ?? leg.mode) === 'train';
                  return {
                    ...leg,
                    ...patch,
                    fareSource: explicitFare ? 'manual' : (patch.fareSource ?? leg.fareSource),
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
                  'fare' in patch &&
                  (leg.source === 'at-rule' || leg.fareSource === 'at-rule') &&
                  (leg.mode === 'bus' || leg.mode === 'train')
                )
                  return { ...leg, source: 'manual', fareSource: 'manual', estimated: true };
                return leg;
              }),
            }
          : option,
      ),
    }));
  const updateLiveTransitFare = (option: JourneyOption, direction: Direction, fare?: number) => {
    const original = googleResponse?.routes.find((route) => route.id === option.id)?.[direction];
    const first = option[direction].findIndex((leg) => leg.mode === 'bus' || leg.mode === 'train');
    updateOption(option.id, {
      [direction]: option[direction].map((leg, index): TravelLeg => {
        if (leg.mode !== 'bus' && leg.mode !== 'train') return leg;
        const baseline = original?.[index];
        return {
          ...leg,
          fare: fare === undefined ? baseline?.fare : index === first ? fare : 0,
          fareRange: fare === undefined ? baseline?.fareRange : undefined,
          fareSource: fare === undefined ? baseline?.fareSource : 'manual',
        };
      }),
    });
  };
  const selectResult = (result: RouteResult) => {
    setSelectedId(result.id);
    if (googleMode) setEditingMode(result.option.mode);
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
    if (!waypointDraft.trim() || option.waypoints.length >= 10) return;
    updateOption(option.id, { waypoints: [...option.waypoints, { label: waypointDraft.trim() }] });
    setWaypointDraft('');
  };
  const appendDrivingStop = (location: Location) => {
    if (!location.label.trim()) return;
    setState((current) => {
      const preference = current.options.find(
        (option) => option.mode === 'drive' && !hasGoogleProvenance(option),
      );
      if (!preference || preference.waypoints.length >= 10) return current;
      return {
        ...current,
        options: current.options.map((option) =>
          option.id === preference.id
            ? { ...option, waypoints: [...option.waypoints, location] }
            : option,
        ),
      };
    });
    setStopoverDraft({ label: '' });
    setStopoverSearchOpen(false);
  };
  const appendDrivingStopAction = useRef(appendDrivingStop);
  appendDrivingStopAction.current = appendDrivingStop;
  const moveDrivingStop = (index: number, offset: -1 | 1) => {
    if (!drivingPreference) return;
    const waypoints = [...drivingStops];
    const target = index + offset;
    if (target < 0 || target >= waypoints.length) return;
    [waypoints[index], waypoints[target]] = [waypoints[target]!, waypoints[index]!];
    updateOption(drivingPreference.id, { waypoints });
  };
  const cancelMapStopoverPick = () => {
    stopoverPickCleanup.current?.();
    stopoverPickCleanup.current = null;
    setMapStopoverPicking(false);
  };
  const beginMapStopoverPick = () => {
    if (
      !googleMode ||
      googleStatus !== 'ready' ||
      editingMode !== 'drive' ||
      drivingStops.length >= 10
    )
      return;
    try {
      stopoverPickCleanup.current?.();
      stopoverPickCleanup.current = provider.beginWaypointSelection((coordinates) => {
        stopoverPickCleanup.current = null;
        setMapStopoverPicking(false);
        appendDrivingStopAction.current({
          label: `${t('mapStopoverLabel', { number: drivingStops.length + 1 })} (${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)})`,
          coordinates,
        });
        setInputsOpen(true);
      });
      setMapStopoverPicking(true);
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : t('googleError'));
    }
  };
  const saveRoute = (option: JourneyOption) => {
    if (hasGoogleProvenance(option) || comparison.error) return;
    if (
      option.waypoints.some((place) => googlePlaceSignatures.current.has(JSON.stringify(place)))
    ) {
      setNotice(t('googlePlaceNotSaved'));
      return;
    }
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
    if (!googleMode || !googleMapRef.current || mapLoadPending.current) return;
    if (mapReadyProvider.current === provider && mapElementRef.current) {
      googleMapRef.current.replaceChildren(mapElementRef.current);
      setGoogleStatus('ready');
      return;
    }
    mapLoadPending.current = true;
    setGoogleError('');
    setGoogleStatus('loading');
    try {
      mapElementRef.current ??= document.createElement('div');
      mapElementRef.current.style.width = '100%';
      mapElementRef.current.style.height = '100%';
      googleMapRef.current.replaceChildren(mapElementRef.current);
      await provider.initializeMap(mapElementRef.current, (error) => {
        if (!mounted.current || activeProvider.current !== provider) return;
        mapReadyProvider.current = null;
        setGoogleError(error.message);
        setGoogleStatus('error');
      });
      if (!mounted.current || activeProvider.current !== provider) {
        provider.dispose();
        return;
      }
      mapReadyProvider.current = provider;
      provider.renderRoute(selectedId);
      setGoogleStatus('ready');
    } catch (error) {
      if (!mounted.current || activeProvider.current !== provider) return;
      setGoogleError(error instanceof Error ? error.message : t('googleError'));
      setGoogleStatus('error');
    } finally {
      if (activeProvider.current === provider) mapLoadPending.current = false;
    }
  };
  const enableAddressSearch = async () => {
    if (
      !googleMode ||
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
          {
            initialValue: state[field].label,
            label: t(field === 'origin' ? 'origin' : 'destination'),
            onInput: (label) => {
              if (!isCurrent()) return;
              setState((current) =>
                current[field].label === label && !current[field].coordinates
                  ? current
                  : { ...current, [field]: { label } },
              );
            },
          },
        );
        if (!isCurrent()) {
          cleanup();
          return false;
        }
        autocompleteCleanup.current.push(cleanup);
        if (cleanup.setValue)
          autocompleteControls.current.push({ field, setValue: cleanup.setValue });
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
    if (
      !googleMode ||
      comparison.error ||
      routePending.current ||
      !state.origin.label.trim() ||
      !state.destination.label.trim()
    )
      return;
    if (mode === 'transit' && drivingStops.length) {
      setGoogleError(t('transitStopoverUnsupported'));
      return;
    }
    if (state.settings.roundTrip && !state.returnTime) {
      setNotice(t('googleMissingReturn'));
      return;
    }
    setGoogleStatus('routes');
    routePending.current = true;
    const query = activeQuery.current;
    lastRequestedQuery.current = query;
    lastRequestedMode.current = mode;
    setGoogleError('');
    try {
      const response = await provider.getRoutes({
        origin: state.origin,
        destination: state.destination,
        mode,
        waypoints: mode === 'drive' ? (drivingPreference?.waypoints ?? []) : [],
        departureTime: state.leaveNow || !state.departure ? undefined : new Date(state.departure),
        returnTime: state.settings.roundTrip ? new Date(state.returnTime) : undefined,
        roundTrip: state.settings.roundTrip,
      });
      if (
        !mounted.current ||
        activeProvider.current !== provider ||
        mapReadyProvider.current !== provider ||
        activeQuery.current !== query
      ) {
        provider.clearMapRoutes();
        return;
      }
      setGoogleResponse(response);
      setState((current) => {
        const costs = current.options.find(
          (option) => option.mode === 'drive' && !hasGoogleProvenance(option),
        );
        return {
          ...current,
          options: [
            ...current.options.filter((option) => !hasGoogleProvenance(option)),
            ...response.routes.map((option) =>
              option.mode === 'drive'
                ? {
                    ...option,
                    parkingCost: costs?.parkingCost ?? 0,
                    outbound: option.outbound.map((leg) =>
                      leg.mode === 'drive'
                        ? {
                            ...leg,
                            toll:
                              costs?.outbound.find((segment) => segment.mode === 'drive')?.toll ??
                              0,
                          }
                        : leg,
                    ),
                    inbound: option.inbound.map((leg) =>
                      leg.mode === 'drive'
                        ? {
                            ...leg,
                            toll:
                              costs?.inbound.find((segment) => segment.mode === 'drive')?.toll ?? 0,
                          }
                        : leg,
                    ),
                  }
                : option,
            ),
          ],
        };
      });
      setGoogleRequests(provider.getMetrics().routeRequests);
      setGoogleStatus('ready');
      setNotice(t('googleRouteAdded'));
      if (response.routes[0]) {
        setSelectedId(response.routes[0].id);
        provider.renderRoute(response.routes[0].id);
      }
    } catch (error) {
      if (
        !mounted.current ||
        activeProvider.current !== provider ||
        mapReadyProvider.current !== provider ||
        activeQuery.current !== query
      )
        return;
      setGoogleRequests(provider.getMetrics().routeRequests);
      setGoogleError(error instanceof Error ? error.message : t('googleError'));
      if (
        error instanceof RouteProviderError &&
        ['NETWORK_ERROR', 'REQUEST_DENIED', 'QUOTA_EXCEEDED'].includes(error.code)
      ) {
        setManualRequested(true);
      }
    } finally {
      routePending.current = false;
      if (
        mounted.current &&
        activeProvider.current === provider &&
        mapReadyProvider.current === provider
      ) {
        setGoogleRequests(provider.getMetrics().routeRequests);
        setGoogleStatus((current) => (current === 'error' ? current : 'ready'));
      }
    }
  };

  const loadMapAction = useRef(loadGoogle);
  loadMapAction.current = loadGoogle;
  const addressSearchAction = useRef(enableAddressSearch);
  addressSearchAction.current = enableAddressSearch;
  const routeAction = useRef(getGoogleRoutes);
  routeAction.current = getGoogleRoutes;
  useEffect(() => {
    if (googleMode && screen === 'planner' && googleStatus === 'idle') void loadMapAction.current();
  }, [googleMode, googleStatus, provider, screen]);
  useEffect(() => {
    if (googleMode && screen === 'planner' && googleStatus === 'ready' && !addressSearchEnabled) {
      void addressSearchAction.current();
    }
  }, [googleMode, googleStatus, addressSearchEnabled, provider, screen]);
  useEffect(() => {
    if (
      !googleMode ||
      googleStatus !== 'ready' ||
      !lastRequestedQuery.current ||
      lastRequestedQuery.current === liveQueryFingerprint
    )
      return;
    const timeout = window.setTimeout(
      () => void routeAction.current(lastRequestedMode.current),
      800,
    );
    return () => window.clearTimeout(timeout);
  }, [googleMode, googleStatus, liveQueryFingerprint]);

  useEffect(() => {
    if (
      !stopoverSearchOpen ||
      !googleMode ||
      screen !== 'planner' ||
      editingMode !== 'drive' ||
      !addressSearchEnabled ||
      !stopoverSearchRef.current
    )
      return;
    let active = true;
    const element = stopoverSearchRef.current;
    const isCurrent = () => active && element.isConnected && activeProvider.current === provider;
    void provider
      .attachAutocomplete(
        element,
        (location) => {
          if (!isCurrent()) return;
          googlePlaceSignatures.current.add(JSON.stringify(location));
          appendDrivingStopAction.current(location);
        },
        (error) => {
          if (isCurrent()) setGoogleError(error.message);
        },
        {
          initialValue: stopoverDraftRef.current.label,
          label: t('stopoverSearch'),
          onInput: (label) => {
            if (isCurrent()) setStopoverDraft({ label });
          },
        },
      )
      .then((cleanup) => {
        if (!isCurrent()) cleanup();
        else stopoverSearchControl.current = cleanup;
      })
      .catch((error: unknown) => {
        if (isCurrent()) setGoogleError(error instanceof Error ? error.message : t('googleError'));
      });
    return () => {
      active = false;
      stopoverSearchControl.current?.();
      stopoverSearchControl.current = null;
    };
  }, [stopoverSearchOpen, googleMode, screen, editingMode, addressSearchEnabled, provider, t]);

  const googleMapReady = googleStatus === 'ready' || googleStatus === 'routes';
  useEffect(() => {
    if (googleMode && screen === 'planner' && googleMapReady)
      provider.renderWaypointMarkers(drivingStops);
    else provider.clearWaypointMarkers();
    return () => provider.clearWaypointMarkers();
  }, [googleMode, screen, googleMapReady, drivingStops, provider]);
  useEffect(() => {
    stopoverPickCleanup.current?.();
    stopoverPickCleanup.current = null;
    setMapStopoverPicking(false);
    return () => {
      stopoverPickCleanup.current?.();
      stopoverPickCleanup.current = null;
    };
  }, [googleMode, screen, editingMode, drivingStops.length, provider]);
  useEffect(() => {
    if (!mapStopoverPicking) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      stopoverPickCleanup.current?.();
      stopoverPickCleanup.current = null;
      setMapStopoverPicking(false);
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [mapStopoverPicking]);

  const reconnectGoogle = () => {
    setManualRequested(false);
    setGoogleError('');
    mapReadyProvider.current = null;
    lastRequestedQuery.current = '';
    setGoogleStatus('idle');
  };

  const renderDriveLeg = (option: JourneyOption, direction: Direction, index: number) => {
    const leg = option[direction][index];
    const directionName = t(directionKeys[direction]);
    const primary = option.id === 'drive';
    return (
      <div className="sc-driving-fields" key={`${direction}-${index}`}>
        <div className="sc-field-grid">
          {hasGoogleProvenance(option) ? (
            <div className="sc-route-measurements">
              <div>
                <span>{t('legDistance', { direction: directionName })}</span>
                <input
                  aria-label={t('legDistance', { direction: directionName })}
                  readOnly
                  value={shortNumber(leg.distanceKm ?? 0)}
                />
              </div>
              <div>
                <span>{t('legDuration', { direction: directionName })}</span>
                <input
                  aria-label={t('legDuration', { direction: directionName })}
                  readOnly
                  value={shortNumber(leg.durationMinutes)}
                />
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
          <NumberField
            label={t('legToll', { direction: directionName })}
            value={leg.toll ?? 0}
            onChange={(toll) =>
              hasGoogleProvenance(option) || option.id === drivingPreference?.id
                ? updateDrivingCosts(
                    direction === 'outbound' ? { outboundToll: toll } : { inboundToll: toll },
                  )
                : updateLeg(option.id, direction, index, { toll })
            }
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
    const live = hasGoogleProvenance(option);
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
            {live ? (
              <input aria-label={t('legType')} readOnly value={t(legKeys[leg.mode])} />
            ) : (
              <select
                value={leg.mode}
                onChange={(event) =>
                  updateLeg(option.id, direction, index, {
                    mode: event.target.value as TravelLeg['mode'],
                    fare: ['bus', 'train'].includes(event.target.value)
                      ? (leg.fare ?? 0)
                      : undefined,
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
            )}
          </label>
          {!live && (
            <button
              className="sc-icon-button"
              aria-label={t('removeSegment')}
              onClick={() =>
                updateOption(option.id, {
                  [direction]: option[direction].filter(
                    (_, segmentIndex) => segmentIndex !== index,
                  ),
                })
              }
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="sc-field-grid">
          {live ? (
            <label className="sc-route-measurements">
              <span>{t('segmentDuration', { mode: t(legKeys[leg.mode]) })}</span>
              <input
                aria-label={t('segmentDuration', { mode: t(legKeys[leg.mode]) })}
                readOnly
                value={shortNumber(leg.durationMinutes)}
              />
            </label>
          ) : (
            <NumberField
              label={t('segmentDuration', { mode: t(legKeys[leg.mode]) })}
              value={leg.durationMinutes}
              onChange={(durationMinutes) =>
                updateLeg(option.id, direction, index, { durationMinutes })
              }
              t={t}
              step="1"
            />
          )}
          {['bus', 'train'].includes(leg.mode) && (
            <>
              {(!live || index === transitIndex) && (
                <NumberField
                  label={fareLabel}
                  value={live ? (leg.fare ?? Number.NaN) : (leg.fare ?? 0)}
                  allowEmpty={live && leg.fare === undefined && Boolean(leg.fareRange)}
                  onChange={(fare) =>
                    live
                      ? updateLiveTransitFare(
                          option,
                          direction,
                          Number.isNaN(fare) ? undefined : fare,
                        )
                      : updateLeg(option.id, direction, index, {
                          fare,
                          fareRange: undefined,
                          fareSource: 'manual',
                        })
                  }
                  t={t}
                />
              )}
              {live ? (
                <label className="sc-route-measurements">
                  <span>{t('transfers')}</span>
                  <input aria-label={t('transfers')} readOnly value={leg.transfers ?? 0} />
                </label>
              ) : (
                <NumberField
                  label={t('transfers')}
                  value={leg.transfers ?? 0}
                  onChange={(transfers) => updateLeg(option.id, direction, index, { transfers })}
                  t={t}
                  step="1"
                  integer
                />
              )}
            </>
          )}
        </div>
        {leg.fare === undefined && leg.fareRange && (
          <div className="sc-fare-range-note">
            <strong>
              {t('fareRangeBadge')}: {moneyWithRange(leg.fareRange.max, leg.fareRange)}
            </strong>
            <p>
              {t(leg.fareRange.basis === 'citylink' ? 'cityLinkFareRangeHelp' : 'fareRangeHelp')}
            </p>
            <p>{t('actualFareHint')}</p>
          </div>
        )}
        {leg.transit && (
          <div className="sc-transit-details">
            <span>{leg.transit.lineShortName || leg.transit.lineName}</span>
            {leg.transit.departureStop && leg.transit.arrivalStop && (
              <span>
                {leg.transit.departureStop} → {leg.transit.arrivalStop}
              </span>
            )}
            {leg.transit.stopCount !== undefined && (
              <span>{t('transitStopCount', { count: leg.transit.stopCount })}</span>
            )}
            {index === transitIndex && <small>{t('transitStopCountHelp')}</small>}
          </div>
        )}
      </div>
    );
  };

  const renderOptionEditor = (option: JourneyOption) => (
    <div key={option.id} className="sc-option-editor" data-testid={`route-editor-${option.id}`}>
      <div className="sc-editor-title">
        <h3>{nameOf(option)}</h3>
        {option.id !== 'drive' && option.mode === 'drive' && !hasGoogleProvenance(option) && (
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
      {!hasGoogleProvenance(option) && !['drive', 'transit', 'hybrid'].includes(option.id) && (
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
              {option.mode !== 'drive' && !hasGoogleProvenance(option) && (
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
            hasGoogleProvenance(option) || option.id === drivingPreference?.id
              ? updateDrivingCosts({ parkingCost })
              : updateOption(option.id, { parkingCost, parkingVerified: false })
          }
          t={t}
        />
      )}
      {option.mode !== 'drive' && (
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
                  ? {
                      ...leg,
                      fare: index === first ? fare : 0,
                      fareRange: undefined,
                      fareSource: 'at-rule',
                      source: hasGoogleProvenance(option) ? leg.source : 'at-rule',
                      estimated: true,
                    }
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
            {googleMode ? (
              <div className="sc-field sc-live-address">
                <span>{t('origin')}</span>
                <div ref={originSearchRef} />
                {!addressSearchEnabled && (
                  <small>{addressSearchPending ? t('googleLoading') : state.origin.label}</small>
                )}
              </div>
            ) : (
              <TextField
                label={t('origin')}
                value={state.origin.label}
                onChange={(label) => setState((current) => ({ ...current, origin: { label } }))}
              />
            )}
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
            {googleMode ? (
              <div className="sc-field sc-live-address">
                <span>{t('destination')}</span>
                <div ref={destinationSearchRef} />
                {!addressSearchEnabled && (
                  <small>
                    {addressSearchPending ? t('googleLoading') : state.destination.label}
                  </small>
                )}
              </div>
            ) : (
              <TextField
                label={t('destination')}
                value={state.destination.label}
                onChange={(label) =>
                  setState((current) => ({ ...current, destination: { label } }))
                }
              />
            )}
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
                options: current.options.map((option) =>
                  option.mode === 'drive' && !hasGoogleProvenance(option)
                    ? { ...option, waypoints: [...option.waypoints].reverse() }
                    : option,
                ),
              }))
            }
          >
            <ArrowDownUp size={15} />
          </button>
        </div>
        {googleMode && drivingPreference && (
          <section className="sc-stopovers" aria-label={t('waypoints')}>
            <div className="sc-stopover-heading">
              <h3>{t('waypoints')}</h3>
              <span>{drivingStops.length}/10</span>
            </div>
            <p className="sc-help">{t('stopoverHelp')}</p>
            {drivingStops.length > 0 && (
              <ol className="sc-stopover-list">
                {drivingStops.map((place, index) => (
                  <li key={`${index}-${place.label}`}>
                    <span className="sc-stopover-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="sc-stopover-label">{place.label}</span>
                    <div className="sc-stopover-controls">
                      <button
                        className="sc-icon-button"
                        aria-label={`${t('moveStopoverUp')} ${place.label}`}
                        disabled={index === 0}
                        onClick={() => moveDrivingStop(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="sc-icon-button"
                        aria-label={`${t('moveStopoverDown')} ${place.label}`}
                        disabled={index === drivingStops.length - 1}
                        onClick={() => moveDrivingStop(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="sc-icon-button"
                        aria-label={`${t('removeWaypoint')} ${place.label}`}
                        onClick={() =>
                          updateOption(drivingPreference.id, {
                            waypoints: drivingStops.filter((_, item) => item !== index),
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {stopoverSearchOpen && editingMode === 'drive' ? (
              <div className="sc-stopover-search">
                <div className="sc-field sc-live-address">
                  <span>{t('stopoverSearch')}</span>
                  <div ref={stopoverSearchRef} />
                </div>
                <div className="sc-stopover-search-actions">
                  <button
                    className="sc-small-button"
                    disabled={!stopoverDraft.label.trim() || drivingStops.length >= 10}
                    onClick={() => appendDrivingStop(stopoverDraft)}
                  >
                    <Plus size={15} />
                    {t('addStopover')}
                  </button>
                  <button
                    className="sc-icon-button"
                    aria-label={t('cancelStopoverSearch')}
                    onClick={() => {
                      setStopoverSearchOpen(false);
                      setStopoverDraft({ label: '' });
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="sc-small-button sc-full-width"
                onClick={() => {
                  setStopoverDraft({ label: '' });
                  setStopoverSearchOpen(true);
                }}
                disabled={
                  editingMode !== 'drive' || drivingStops.length >= 10 || !addressSearchEnabled
                }
              >
                <Plus size={16} />
                {t('addStopover')}
              </button>
            )}
            {drivingStops.length >= 10 && <p className="sc-help">{t('stopoverLimit')}</p>}
            {stopoverRoutingBlocked && (
              <p className="sc-error" role="status">
                {t('transitStopoverUnsupported')}
              </p>
            )}
          </section>
        )}
        {(!state.origin.label.trim() || !state.destination.label.trim()) && (
          <p className="sc-error">{t('invalidLocation')}</p>
        )}
        <button className="sc-text-button" onClick={useLocation} disabled={locationLoading}>
          <LocateFixed size={14} />
          {t(locationLoading ? 'locating' : 'useLocation')}
        </button>
        <p className="sc-help">{t(googleMode ? 'liveAddressHint' : 'manualLocationNote')}</p>
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
        <p className="sc-help">{t(googleMode ? 'liveRouteHint' : 'routeHint')}</p>
        <div className="sc-mode-switch" role="group" aria-label={t('routeParameters')}>
          {(googleMode
            ? (['drive', 'transit'] as const)
            : (['drive', 'transit', 'hybrid'] as const)
          ).map((mode) => (
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
        {googleMode && (
          <div className="sc-routing-actions">
            <button
              className="sc-small-button sc-full-width"
              onClick={() => void getGoogleRoutes(editingMode === 'transit' ? 'transit' : 'drive')}
              disabled={
                googleStatus !== 'ready' ||
                comparison.error ||
                stopoverRoutingBlocked ||
                (state.settings.roundTrip && !state.returnTime)
              }
            >
              <Route size={16} />
              {t(googleStatus === 'routes' ? 'googleRoutesLoading' : 'planRoute')}
            </button>
            {state.settings.roundTrip && !state.returnTime && (
              <p className="sc-help">{t('googleMissingReturn')}</p>
            )}
            {googleError && (
              <p className="sc-error" role="alert">
                {googleError}
              </p>
            )}
            {googleRequests > 0 && <small>{t('googleMetrics', { count: googleRequests })}</small>}
            {editingMode === 'transit' && (
              <div className="sc-at-fare-link">
                <a
                  href="https://at.govt.nz/bus-train-ferry/journey-planner"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('verifyATFare')}
                </a>
                <p className="sc-help">{t('atFareLinkHelp')}</p>
              </div>
            )}
          </div>
        )}
        {visibleOptions
          .filter(
            (option) =>
              option.mode === editingMode &&
              (!googleMode || option.id === (selected?.id ?? selectedId)),
          )
          .map(renderOptionEditor)}
        {!googleMode && editingMode === 'drive' && (
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
        {props.googleApiKey && !googleMode && (
          <div className="sc-manual-fallback">
            <p>{t(!online ? 'offlineFallback' : 'manualFallback')}</p>
            {googleError && (
              <p className="sc-error" role="alert">
                {googleError}
              </p>
            )}
            <button className="sc-small-button" onClick={reconnectGoogle} disabled={!online}>
              {t('reconnectGoogle')}
            </button>
          </div>
        )}
        {googleMode && (
          <button className="sc-text-button" onClick={() => setManualRequested(true)}>
            {t('useManualInputs')}
          </button>
        )}
        {!googleMode && (
          <p className="sc-help sc-return-note">
            <Info size={13} />
            {t('estimatedReturn')}
          </p>
        )}
      </div>
    </aside>
  );

  const renderSchematic = () => (
    <section className="sc-map-panel" aria-label={t(googleMode ? 'googleMapTitle' : 'schematic')}>
      <div className="sc-map-toolbar">
        <span>
          <Compass size={17} />
          {t(googleMode ? 'googleMapTitle' : 'schematic')}
        </span>
        <div className="sc-map-tools">
          {googleMode && (
            <button
              className="sc-small-button"
              onClick={mapStopoverPicking ? cancelMapStopoverPick : beginMapStopoverPick}
              disabled={
                !mapStopoverPicking &&
                (googleStatus !== 'ready' || editingMode !== 'drive' || drivingStops.length >= 10)
              }
              aria-pressed={mapStopoverPicking}
            >
              {mapStopoverPicking ? <X size={14} /> : <Plus size={14} />}
              {t(mapStopoverPicking ? 'cancelStopoverPick' : 'pickStopoverOnMap')}
            </button>
          )}
          <span className="sc-tag">
            {googleMode ? <MapPin size={12} /> : <WifiOff size={12} />}
            {t(googleMode ? 'googleOnline' : 'manualMode')}
          </span>
        </div>
      </div>
      {googleMode && (
        <div className="sc-map-stage">
          <div
            className="sc-google-map"
            ref={googleMapRef}
            aria-label={t('googleMapDescription')}
          />
          {mapStopoverPicking && (
            <p className="sc-map-stopover-prompt" role="status">
              {t('pickStopoverHint')}
            </p>
          )}
          {(googleStatus === 'idle' || googleStatus === 'loading') && (
            <div className="sc-map-loading" role="status">
              {t('googleLoading')}
            </div>
          )}
          {googleStatus === 'routes' && (
            <p className="sc-help" role="status">
              {t('googleRoutesLoading')}
            </p>
          )}
        </div>
      )}
      {!googleMode && (
        <>
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
        </>
      )}
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
      {hasFareRanges && <p className="sc-help sc-range-ranking-note">{t('fareRangeRankHelp')}</p>}
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
          <h3>{t(googleMode ? 'planRoutePrompt' : noComparableRoutesKey)}</h3>
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
                  ? t(result.totalCostRange ? 'fareRangeSource' : 'googleVerifiedGeometry')
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
            <span
              className={`sc-money ${result.totalCostRange ? 'sc-money-range' : ''}`}
              data-testid={`cost-${result.id}`}
            >
              {moneyWithRange(result.totalCost, result.totalCostRange)}
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
                {rankingLabel('cheapest')}
              </span>
            )}
            {comparison.result?.fastest.id === result.id && (
              <span className="sc-badge sc-badge-blue">
                <Clock3 size={11} />
                {t('fastest')}
              </span>
            )}
            {comparison.result?.bestValue.id === result.id && (
              <span className="sc-badge sc-badge-neutral">{rankingLabel('bestValue')}</span>
            )}
            {comparison.result?.fewestTransfers.id === result.id && (
              <span className="sc-badge sc-badge-neutral">{t('fewestTransfers')}</span>
            )}
          </div>
          {result.totalCostRange && (
            <span className="sc-result-warning sc-fare-range-warning">
              <Info size={12} />
              {t('fareRangeBadge')} · {t(fareExplanationKey(result.option))}
            </span>
          )}
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
          <strong className={selected.monthlyCostRange ? 'sc-projection-range' : ''}>
            {moneyWithRange(selected.monthlyCost, selected.monthlyCostRange)}
          </strong>
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
              {hasFareRanges
                ? t('fareRangeRankHelp')
                : t('savingReason', {
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
              {t(hasFareRanges ? 'budgetValueReason' : 'valueReason', {
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
                  <span>{rankingLabel(kind)}</span>
                  <strong>{nameOf(result)}</strong>
                  <small>
                    {kind === 'fastest'
                      ? t('minutes', { count: shortNumber(result.totalMinutes) })
                      : kind === 'fewestTransfers'
                        ? t('transferCount', { count: result.transfers })
                        : moneyWithRange(
                            kind === 'bestValue' ? result.generalizedCost : result.totalCost,
                            kind === 'bestValue' ? generalizedRange(result) : result.totalCostRange,
                          )}
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
                      <strong>{moneyWithRange(result.totalCost, result.totalCostRange)}</strong>
                    </td>
                    <td>{t('minutes', { count: shortNumber(result.totalMinutes) })}</td>
                    <td>{result.transfers}</td>
                    <td>{moneyWithRange(result.weeklyCost, result.weeklyCostRange)}</td>
                    <td>{moneyWithRange(result.monthlyCost, result.monthlyCostRange)}</td>
                    <td>{moneyWithRange(result.generalizedCost, generalizedRange(result))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sc-help">{t('timeValueExplanation')}</p>
          {hasFareRanges && <p className="sc-help">{t('fareRangeRankHelp')}</p>}
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
    const pieces: { key: MessageKey; value: number; range?: CostRange; color: string }[] = selected
      ? [
          { key: 'fuel', value: selected.fuelCost, color: '#007f6d' },
          {
            key: 'fares',
            value: selected.fareCost,
            range: selected.fareCostRange,
            color: '#a4bd73',
          },
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
                  <strong>{moneyWithRange(selected.totalCost, selected.totalCostRange)}</strong>
                  <span>{t('perCommute')}</span>
                </div>
                <div
                  className="sc-stacked-bar"
                  role="img"
                  aria-label={pieces
                    .map((piece) => `${t(piece.key)}: ${moneyWithRange(piece.value, piece.range)}`)
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
                      <dd>{moneyWithRange(piece.value, piece.range)}</dd>
                    </div>
                  ))}
                  <div className="sc-cost-total">
                    <dt>{t('total')}</dt>
                    <dd>{moneyWithRange(selected.totalCost, selected.totalCostRange)}</dd>
                  </div>
                </dl>
                <p className="sc-help">{t('formula')}</p>
                {selected.totalCostRange && <p className="sc-help">{t('fareRangeBudgetHelp')}</p>}
              </div>
              <div className="sc-surface sc-budget-surface">
                <h2>{t('commutingPattern')}</h2>
                <div className="sc-budget-number">
                  <span>{t('weekly')}</span>
                  <strong>{moneyWithRange(selected.weeklyCost, selected.weeklyCostRange)}</strong>
                </div>
                <div className="sc-budget-number">
                  <span>{t('monthly')}</span>
                  <strong>{moneyWithRange(selected.monthlyCost, selected.monthlyCostRange)}</strong>
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
                    <dd>{moneyWithRange(selected.generalizedCost, generalizedRange(selected))}</dd>
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
                        {moneyWithRange(
                          selected.breakdown[direction].totalCost,
                          selected.breakdown[direction].totalCostRange,
                        )}{' '}
                        ·{' '}
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
                  {t(
                    warning === 'fare-range-estimate'
                      ? fareExplanationKey(selected.option)
                      : warningKeys[warning],
                  )}
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
          <span className="sc-header-status">{t(googleMode ? 'googleOnline' : 'manualMode')}</span>
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
                {t(googleMode ? 'googleOnline' : 'offlineStatus')}
              </span>
            </section>
            <div className="sc-demo-banner">
              <Info size={17} />
              <p>{t(googleMode ? 'livePlannerHint' : 'demoNotice')}</p>
              <span className="sc-tag">{t(googleMode ? 'googleOnline' : 'demoData')}</span>
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
        <span>{t(googleMode ? 'googleDetails' : 'offlineStatus')}</span>
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
