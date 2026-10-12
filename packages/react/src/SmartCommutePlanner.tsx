import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Bus,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CloudSun,
  House,
  Info,
  Layers3,
  LocateFixed,
  MapPin,
  Moon,
  Plus,
  RotateCcw,
  Route,
  Settings as SettingsIcon,
  Sun,
  TrainFront,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  compareOptions,
  createExampleOptions,
  DEFAULT_SETTINGS,
  EXAMPLE_INTERCHANGE_LABEL,
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
  openingStatus,
  type PlaceHours,
  type RouteErrorCode,
  type RouteResult as ProviderRouteResult,
  type WeatherForecast,
} from '@smart-commute/providers';
import { createTranslator, formatMoney, type Locale, type MessageKey } from '@smart-commute/i18n';
import { ATFareHelper } from './ATFareHelper';
import { WeatherBar } from './WeatherBar';
import { useWeather } from './useWeather';

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
  /** Demo or test weather; shown with a demo label and never fetched. */
  weatherFixture?: WeatherForecast;
}

type Screen = 'planner' | 'comparison' | 'breakdown' | 'settings' | 'about';
/** Full-screen pages that open over the phone map; the map itself stays mounted underneath. */
type MobilePage = 'route' | 'costs' | Exclude<Screen, 'planner'>;
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
/** Below the wide two-column layout, or a phone held sideways, the planner becomes map-first. */
const MOBILE_QUERY = '(max-width: 899px), (max-height: 520px) and (pointer: coarse)';
const SHORT_VIEWPORT_QUERY = '(max-height: 600px)';
/** Route framing on the phone map keeps clear of the route card above and the tools beside it. */
const MOBILE_MAP_PADDING = { top: 120, right: 88, bottom: 40, left: 48 };
const HISTORY_LAYER_KEY = 'smartCommuteLayer';
const historyLayer = (value: unknown) => {
  const layer = (value as Record<string, unknown> | null)?.[HISTORY_LAYER_KEY];
  return typeof layer === 'number' && layer > 0 ? layer : 0;
};
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches),
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}
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
const googleErrorKeys: Record<RouteErrorCode, MessageKey> = {
  MISSING_KEY: 'googleErrorMissingKey',
  INVALID_INPUT: 'googleErrorInvalidInput',
  UNSUPPORTED: 'googleErrorUnsupported',
  QUOTA_EXCEEDED: 'googleErrorQuota',
  REQUEST_DENIED: 'googleErrorDenied',
  NETWORK_ERROR: 'googleErrorNetwork',
  NO_ROUTES: 'googleErrorNoRoutes',
  INCOMPLETE_RESULT: 'googleErrorIncomplete',
  BUSY: 'googleErrorBusy',
};
/** Leg types that cover ground; waiting and parking have no distance to report. */
const distanceModes: ReadonlySet<TravelLeg['mode']> = new Set(['drive', 'bus', 'train', 'walk']);
const minorModes: ReadonlySet<TravelLeg['mode']> = new Set(['walk', 'wait', 'parking']);
/** Fixed notes written by the Google provider, matched by their opening words. */
const providerNoteKeys: [string, MessageKey][] = [
  ['Route durations are estimates.', 'providerNoteEstimates'],
  ['This request uses traffic-unaware driving', 'providerNoteTrafficUnaware'],
  ['Outbound alternatives are paired', 'providerNotePairedReturn'],
  ['Google used fallback routing', 'providerNoteFallback'],
];
/** What the route page changed, so leaving it without confirming restores the planned trip. */
interface RouteDraft {
  fingerprint: string;
  origin: Location;
  destination: Location;
  leaveNow: boolean;
  departure: string;
  returnTime: string;
  roundTrip: boolean;
  options: JourneyOption[];
  googleResponse: ProviderRouteResult | null;
  selectedId: string;
  editingMode: JourneyOption['mode'];
}
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
/** Saved local times expire: traffic-aware driving rejects any departure in the past. */
const isFutureTime = (value: string | undefined) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && time > Date.now();
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
        // Settings saved before congestion pricing get the default rather than none.
        congestionFuelPerHour:
          saved.settings.congestionFuelPerHour ?? DEFAULT_SETTINGS.congestionFuelPerHour,
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
      ...(saved.leaveNow === false && !isFutureTime(saved.departure)
        ? { leaveNow: true, departure: '' }
        : {}),
      returnTime: isFutureTime(saved.returnTime) ? saved.returnTime! : fallback.returnTime,
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
  error,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  type?: 'text' | 'datetime-local';
}) {
  const id = useId();
  return (
    <div className={`sc-field ${error ? 'sc-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <small id={`${id}-error`} className="sc-error">
          {error}
        </small>
      )}
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
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const shortViewport = useMediaQuery(SHORT_VIEWPORT_QUERY);
  const [pages, setPages] = useState<MobilePage[]>([]);
  // Short or sideways screens start with the cost sheet collapsed so the map stays usable.
  const [sheetOpen, setSheetOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia?.(SHORT_VIEWPORT_QUERY).matches,
  );
  const [weatherOpen, setWeatherOpen] = useState(false);
  const routeEditing = isMobile && pages.includes('route');
  const routeEditingRef = useRef(routeEditing);
  routeEditingRef.current = routeEditing;
  // Address search lives in the planner column on wide screens and in the route page on phones.
  const addressInputsMounted = isMobile ? routeEditing : screen === 'planner';
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
  const [mapDestinationPicking, setMapDestinationPicking] = useState(false);
  // Bumped when a mode switch or a map-picked destination should plan without another click.
  const [autoPlanToken, setAutoPlanToken] = useState(0);
  const [summaryInView, setSummaryInView] = useState(true);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [sortBy, setSortBy] = useState<'cost' | 'time' | 'distance' | 'value'>('cost');
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
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  const routeDraft = useRef<RouteDraft | null>(null);
  const restoredFingerprint = useRef('');
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
  const distinctCards: RouteResult[] = [];
  const similarCards: RouteResult[] = [];
  const seenCardDetails = new Set<string>();
  // Core ranks by cost; people can reorder by time, distance or cost plus their time value.
  // Routes missing a leg distance sort after complete ones, as their total is only a floor.
  const sortedResults = [...(comparison.result?.results ?? [])].sort((left, right) =>
    sortBy === 'time'
      ? left.totalMinutes - right.totalMinutes || left.totalCost - right.totalCost
      : sortBy === 'distance'
        ? Number(right.distanceComplete) - Number(left.distanceComplete) ||
          left.distanceKm - right.distanceKm ||
          left.totalMinutes - right.totalMinutes
        : sortBy === 'value'
          ? left.generalizedCost - right.generalizedCost
          : 0,
  );
  for (const result of sortedResults) {
    const fingerprint = JSON.stringify([
      result.mode,
      result.totalMinutes.toFixed(1),
      result.distanceKm.toFixed(1),
      result.transfers,
      result.totalCost.toFixed(2),
      result.option.outbound.flatMap((leg) =>
        leg.transit
          ? [
              [
                leg.transit.lineShortName || leg.transit.lineName,
                leg.transit.departureStop,
                leg.transit.arrivalStop,
                leg.transit.stopCount,
              ],
            ]
          : [],
      ),
    ]);
    if (seenCardDetails.has(fingerprint)) similarCards.push(result);
    else {
      seenCardDetails.add(fingerprint);
      distinctCards.push(result);
    }
  }
  const cardResults = [...distinctCards, ...similarCards];
  const fareExplanationKey = (option: JourneyOption) => {
    const ranges = [...option.outbound, ...(state.settings.roundTrip ? option.inbound : [])]
      .filter((leg) => leg.fare === undefined && leg.fareRange)
      .map((leg) => leg.fareRange!);
    return ranges.length && ranges.every((range) => range.basis === 'citylink')
      ? 'cityLinkFareRangeHelp'
      : 'fareRangeHelp';
  };
  const rankingLabel = (
    kind: 'cheapest' | 'fastest' | 'fewestTransfers' | 'bestValue' | 'shortest',
  ) =>
    t(
      hasFareRanges && kind === 'cheapest'
        ? 'budgetCheapest'
        : hasFareRanges && kind === 'bestValue'
          ? 'budgetBestValue'
          : kind,
    );
  const tripScope = t(state.settings.roundTrip ? 'returnIncluded' : 'oneWay');
  const wholeMinutes = (minutes: number) => t('minutes', { count: Math.round(minutes) });
  // Clock times are always shown in Auckland time, whatever the browser timezone.
  const aucklandClock = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-NZ', {
        timeZone: 'Pacific/Auckland',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    [locale],
  );
  const aucklandDay = useMemo(
    () => new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short' }),
    [],
  );
  const includedLegs = (option: JourneyOption) => [
    ...option.outbound,
    ...(state.settings.roundTrip ? option.inbound : []),
  ];
  // Missing distances are summed as zero by the calculator; say so instead of showing 0 km.
  const distanceText = (result: RouteResult) => {
    const legs = includedLegs(result.option).filter((leg) => distanceModes.has(leg.mode));
    const known = legs.filter((leg) => leg.distanceKm !== undefined).length;
    if (!known) return t('distanceNotEntered');
    if (known < legs.length) return t('distancePartial', { count: shortNumber(result.distanceKm) });
    return t('km', { count: shortNumber(result.distanceKm) });
  };
  const placeLabel = (label: string) =>
    label === EXAMPLE_INTERCHANGE_LABEL ? t('exampleInterchange') : label;
  const describeGoogleError = (error: unknown) => {
    if (import.meta.env.MODE !== 'test')
      console.warn('[smart-commute] Google request failed', error);
    return error instanceof RouteProviderError ? t(googleErrorKeys[error.code]) : t('googleError');
  };
  const googleErrorText = useRef(describeGoogleError);
  googleErrorText.current = describeGoogleError;
  const originMissing = !state.origin.label.trim();
  const destinationMissing = !state.destination.label.trim();
  const departureInvalid =
    !state.leaveNow && (!state.departure || Number.isNaN(new Date(state.departure).getTime()));
  const returnTimeMissing = googleMode && state.settings.roundTrip && !state.returnTime;
  const showReturnTime = state.settings.roundTrip && (googleMode || !state.leaveNow);
  const departureAt = state.leaveNow
    ? currentMinute * 60000
    : departureInvalid
      ? undefined
      : new Date(state.departure).getTime();
  const returnAt =
    state.settings.roundTrip &&
    state.returnTime &&
    !Number.isNaN(new Date(state.returnTime).getTime())
      ? new Date(state.returnTime).getTime()
      : undefined;
  // Weather reuses the absolute departure instant, never the browser's wall-clock reading.
  const weather = useWeather({
    coordinates: state.origin.coordinates,
    leaveNow: state.leaveNow,
    departureAt: state.leaveNow ? undefined : departureAt,
    now: currentMinute * 60000,
    fixture: props.weatherFixture,
  });
  // Opening hours for a Google-selected destination; each place is requested once per session.
  const destinationPlaceId = googleMode ? state.destination.placeId : undefined;
  const [destinationHours, setDestinationHours] = useState<{
    placeId: string;
    hours?: PlaceHours;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!destinationPlaceId) return;
    let active = true;
    provider.getPlaceHours(destinationPlaceId).then(
      (hours) => {
        if (active) setDestinationHours({ placeId: destinationPlaceId, hours });
      },
      () => {
        if (active) setDestinationHours({ placeId: destinationPlaceId, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [destinationPlaceId, provider]);
  const clockSpan = (start: number | undefined, minutes: number) => {
    if (start === undefined) return '';
    const end = start + minutes * 60000;
    const nextDay = aucklandDay.format(start) !== aucklandDay.format(end) ? ` ${t('nextDay')}` : '';
    return t('clockSpan', {
      depart: aucklandClock.format(start),
      arrive: `${aucklandClock.format(end)}${nextDay}`,
    });
  };
  // Restart the value highlight when the selected option's amount changes in place.
  const summarySignature = selected
    ? `${selected.id}|${selected.totalCost}|${selected.totalCostRange?.min ?? ''}`
    : '';
  const hasSelection = Boolean(selected);
  const lastSummarySignature = useRef(summarySignature);
  const [valueUpdates, setValueUpdates] = useState(0);

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
  }, [addressInputsMounted, googleMode, provider]);
  useEffect(() => {
    for (const control of autocompleteControls.current) {
      control.setValue(control.field === 'origin' ? state.origin.label : state.destination.label);
    }
  }, [state.origin.label, state.destination.label, addressSearchEnabled]);
  useEffect(() => {
    // Discarding a route edit restores the planned trip and its routes; keep them.
    const restored = restoredFingerprint.current === liveQueryFingerprint;
    restoredFingerprint.current = '';
    if (restored) return;
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
  useEffect(() => {
    const previous = lastSummarySignature.current;
    lastSummarySignature.current = summarySignature;
    if (previous && summarySignature && previous.split('|')[0] === summarySignature.split('|')[0])
      if (previous !== summarySignature) setValueUpdates((count) => count + 1);
  }, [summarySignature]);
  useEffect(() => {
    // The compact mobile summary appears only while the full summary is off screen.
    const target = summaryRef.current;
    if (screen !== 'planner' || !target || typeof IntersectionObserver === 'undefined') {
      setSummaryInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setSummaryInView(Boolean(entry?.isIntersecting)),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [screen, hasSelection]);

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
    // Google routes are redrawn by the map effect, which keeps selection and labels in sync.
    if (!hasGoogleProvenance(result.option)) provider.clearMapRoutes();
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
  const cancelMapDestinationPick = () => {
    stopoverPickCleanup.current?.();
    stopoverPickCleanup.current = null;
    setMapDestinationPicking(false);
  };
  const beginMapDestinationPick = () => {
    if (!googleMode || googleStatus !== 'ready') return;
    try {
      stopoverPickCleanup.current?.();
      setMapStopoverPicking(false);
      stopoverPickCleanup.current = provider.beginWaypointSelection((coordinates) => {
        stopoverPickCleanup.current = null;
        setMapDestinationPicking(false);
        setState((current) => ({
          ...current,
          destination: {
            label: `${t('mapDestinationLabel')} (${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)})`,
            coordinates,
          },
        }));
        setAutoPlanToken((count) => count + 1);
      });
      setMapDestinationPicking(true);
    } catch (error) {
      setGoogleError(describeGoogleError(error));
    }
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
      setMapDestinationPicking(false);
      stopoverPickCleanup.current = provider.beginWaypointSelection((coordinates) => {
        stopoverPickCleanup.current = null;
        setMapStopoverPicking(false);
        appendDrivingStopAction.current({
          label: `${t('mapStopoverLabel', { number: drivingStops.length + 1 })} (${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)})`,
          coordinates,
        });
      });
      setMapStopoverPicking(true);
    } catch (error) {
      setGoogleError(describeGoogleError(error));
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
      await provider.initializeMap(
        mapElementRef.current,
        (error) => {
          if (!mounted.current || activeProvider.current !== provider) return;
          mapReadyProvider.current = null;
          setGoogleError(describeGoogleError(error));
          setGoogleStatus('error');
        },
        { fullscreenControl: !isMobile },
      );
      if (!mounted.current || activeProvider.current !== provider) {
        provider.dispose();
        return;
      }
      mapReadyProvider.current = provider;
      setGoogleStatus('ready');
    } catch (error) {
      if (!mounted.current || activeProvider.current !== provider) return;
      setGoogleError(describeGoogleError(error));
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
    const onError = (error: Error) => setGoogleError(describeGoogleError(error));
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
      setGoogleError(describeGoogleError(error));
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
    if (departureInvalid) return;
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
      setNotice('');
      if (response.routes[0]) setSelectedId(response.routes[0].id);
      if (!window.matchMedia?.(SHORT_VIEWPORT_QUERY).matches) setSheetOpen(true);
    } catch (error) {
      if (
        !mounted.current ||
        activeProvider.current !== provider ||
        mapReadyProvider.current !== provider ||
        activeQuery.current !== query
      )
        return;
      setGoogleRequests(provider.getMetrics().routeRequests);
      setGoogleError(describeGoogleError(error));
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
  const autoPlanContext = useRef({ googleMode, googleStatus, editingMode, stops: 0 });
  autoPlanContext.current = { googleMode, googleStatus, editingMode, stops: drivingStops.length };
  useEffect(() => {
    const context = autoPlanContext.current;
    if (!autoPlanToken || !context.googleMode || context.googleStatus !== 'ready') return;
    // The phone route page is a draft: it plans only when the person confirms it.
    if (routeEditingRef.current) return;
    const mode = context.editingMode === 'transit' ? 'transit' : 'drive';
    // Transit cannot take stops; the stop list already explains why nothing is planned.
    if (mode === 'transit' && context.stops > 0) return;
    const current =
      lastRequestedQuery.current === activeQuery.current && lastRequestedMode.current === mode;
    if (!current) void routeAction.current(mode);
  }, [autoPlanToken]);
  useEffect(() => {
    if (googleMode && screen === 'planner' && googleStatus === 'idle') void loadMapAction.current();
  }, [googleMode, googleStatus, provider, screen]);
  useEffect(() => {
    if (googleMode && addressInputsMounted && googleStatus === 'ready' && !addressSearchEnabled) {
      void addressSearchAction.current();
    }
  }, [googleMode, googleStatus, addressSearchEnabled, provider, addressInputsMounted]);
  useEffect(() => {
    if (
      !googleMode ||
      googleStatus !== 'ready' ||
      routeEditing ||
      !lastRequestedQuery.current ||
      lastRequestedQuery.current === liveQueryFingerprint
    )
      return;
    const timeout = window.setTimeout(() => {
      if (lastRequestedQuery.current !== activeQuery.current)
        void routeAction.current(lastRequestedMode.current);
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [googleMode, googleStatus, liveQueryFingerprint, routeEditing]);

  useEffect(() => {
    if (
      !stopoverSearchOpen ||
      !googleMode ||
      !addressInputsMounted ||
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
          if (isCurrent()) setGoogleError(googleErrorText.current(error));
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
        if (isCurrent()) setGoogleError(googleErrorText.current(error));
      });
    return () => {
      active = false;
      stopoverSearchControl.current?.();
      stopoverSearchControl.current = null;
    };
  }, [
    stopoverSearchOpen,
    googleMode,
    addressInputsMounted,
    editingMode,
    addressSearchEnabled,
    provider,
    t,
  ]);

  const googleMapReady = googleStatus === 'ready' || googleStatus === 'routes';
  // Every alternative is drawn with its outbound time and commute cost, like a directions map.
  const mapLabels = googleMode
    ? Object.fromEntries(
        (comparison.result?.results ?? [])
          .filter((result) => hasGoogleProvenance(result.option))
          .map((result) => [
            result.id,
            [
              wholeMinutes(result.breakdown.outbound.totalMinutes),
              moneyWithRange(result.totalCost, result.totalCostRange),
            ].join(' · '),
          ]),
      )
    : {};
  const mapLabelsKey = JSON.stringify(mapLabels);
  // Name both ends on the map so the direction of travel reads without the form.
  const shortPlace = (label: string) => label.split(',')[0]?.trim() || label;
  const endpointLabels = JSON.stringify({
    start: `${t('start')} · ${shortPlace(state.origin.label)}`,
    end: `${t('finish')} · ${shortPlace(state.destination.label)}`,
  });
  const routeSelectAction = useRef<(id: string) => void>(() => undefined);
  routeSelectAction.current = (id) => {
    const result = comparison.result?.results.find((candidate) => candidate.id === id);
    if (result) selectResult(result);
  };
  const selectedRouteId = selected?.id ?? '';
  useEffect(() => {
    if (!googleMode || !googleMapReady || !googleResponse || !selectedRouteId) return;
    provider.renderRoute(selectedRouteId, {
      labels: JSON.parse(mapLabelsKey) as Record<string, string>,
      onSelect: (id) => routeSelectAction.current(id),
      endpoints: JSON.parse(endpointLabels) as { start: string; end: string },
      ...(isMobile ? { padding: MOBILE_MAP_PADDING } : {}),
    });
  }, [
    googleMode,
    googleMapReady,
    googleResponse,
    selectedRouteId,
    mapLabelsKey,
    endpointLabels,
    provider,
    isMobile,
  ]);
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
    setMapDestinationPicking(false);
    return () => {
      stopoverPickCleanup.current?.();
      stopoverPickCleanup.current = null;
    };
  }, [googleMode, screen, editingMode, drivingStops.length, provider]);
  useEffect(() => {
    if (!mapStopoverPicking && !mapDestinationPicking) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      stopoverPickCleanup.current?.();
      stopoverPickCleanup.current = null;
      setMapStopoverPicking(false);
      setMapDestinationPicking(false);
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [mapStopoverPicking, mapDestinationPicking]);

  const reconnectGoogle = () => {
    setManualRequested(false);
    setGoogleError('');
    mapReadyProvider.current = null;
    lastRequestedQuery.current = '';
    setGoogleStatus('idle');
  };

  const includedDirections = (['outbound', 'inbound'] as const).filter(
    (direction) => direction === 'outbound' || state.settings.roundTrip,
  );
  const firstLegIndex = (legs: TravelLeg[], kind: 'drive' | 'transit') =>
    legs.findIndex((leg) =>
      kind === 'drive' ? leg.mode === 'drive' : leg.mode === 'bus' || leg.mode === 'train',
    );
  const driveDistanceLabel = (option: JourneyOption, direction: Direction) =>
    option.id === 'drive'
      ? t(direction === 'outbound' ? 'outboundDistance' : 'inboundDistance')
      : `${nameOf(option)} · ${t('legDistance', { direction: t(directionKeys[direction]) })}`;
  const transitFareLabel = (option: JourneyOption, direction: Direction) =>
    option.mode === 'transit'
      ? t(direction === 'outbound' ? 'outboundFare' : 'inboundFare')
      : t(direction === 'outbound' ? 'hybridOutboundFare' : 'hybridInboundFare');

  const renderDriveLeg = (
    option: JourneyOption,
    direction: Direction,
    index: number,
    showDistance = true,
  ) => {
    const leg = option[direction][index];
    const directionName = t(directionKeys[direction]);
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
              {showDistance && (
                <NumberField
                  label={driveDistanceLabel(option, direction)}
                  value={leg.distanceKm ?? 0}
                  onChange={(distanceKm) => updateLeg(option.id, direction, index, { distanceKm })}
                  t={t}
                />
              )}
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

  const renderTransitLeg = (
    option: JourneyOption,
    direction: Direction,
    index: number,
    showPrimaryFare = true,
  ) => {
    const leg = option[direction][index];
    const live = hasGoogleProvenance(option);
    if (live && leg.mode !== 'bus' && leg.mode !== 'train')
      return (
        <div className="sc-live-step" key={`${direction}-${index}`}>
          <span>{t(legKeys[leg.mode])}</span>
          <strong>{t('minutes', { count: shortNumber(leg.durationMinutes) })}</strong>
        </div>
      );
    const transitIndex = firstLegIndex(option[direction], 'transit');
    const fareLabel =
      index === transitIndex
        ? transitFareLabel(option, direction)
        : t('segmentFare', { mode: t(legKeys[leg.mode]) });
    const showFare = live ? index === transitIndex : showPrimaryFare || index !== transitIndex;
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
              <X size={16} />
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
              {showFare && (
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

  const renderDirections = (option: JourneyOption, essentialsShown: boolean) =>
    includedDirections.map((direction) => {
      const firstDrive = firstLegIndex(option[direction], 'drive');
      const firstTransit = firstLegIndex(option[direction], 'transit');
      return (
        <details className="sc-direction" open={direction === 'outbound'} key={direction}>
          <summary>
            {t(directionKeys[direction])}
            <ChevronDown size={16} />
          </summary>
          <div className="sc-direction-body">
            {option[direction].map((leg, index) =>
              leg.mode === 'drive'
                ? renderDriveLeg(option, direction, index, !essentialsShown || index !== firstDrive)
                : renderTransitLeg(
                    option,
                    direction,
                    index,
                    !essentialsShown || index !== firstTransit,
                  ),
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
                <Plus size={15} />
                {t('addSegment')}
              </button>
            )}
          </div>
        </details>
      );
    });

  const renderFareHelper = (option: JourneyOption) => (
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
  );

  // The values that decide most of a manual estimate stay visible; the rest is one click away.
  const renderEssentials = (option: JourneyOption) => (
    <>
      {!['drive', 'transit', 'hybrid'].includes(option.id) && (
        <TextField
          label={t('routeName')}
          value={option.name}
          onChange={(name) => updateOption(option.id, { name })}
        />
      )}
      {option.mode === 'hybrid' && (
        <TextField
          label={t('hub')}
          value={placeLabel(option.waypoints[0]?.label ?? '')}
          onChange={(label) =>
            updateOption(option.id, {
              waypoints: [{ label }, ...option.waypoints.slice(1)],
              parkingVerified: false,
            })
          }
        />
      )}
      <div className="sc-field-grid">
        {option.mode !== 'transit' &&
          includedDirections.map((direction) => {
            const index = firstLegIndex(option[direction], 'drive');
            const leg = option[direction][index];
            if (!leg) return null;
            return (
              <NumberField
                key={`distance-${direction}`}
                label={driveDistanceLabel(option, direction)}
                value={leg.distanceKm ?? 0}
                onChange={(distanceKm) => updateLeg(option.id, direction, index, { distanceKm })}
                t={t}
              />
            );
          })}
        {option.mode !== 'drive' &&
          includedDirections.map((direction) => {
            const index = firstLegIndex(option[direction], 'transit');
            const leg = option[direction][index];
            if (!leg) return null;
            return (
              <NumberField
                key={`fare-${direction}`}
                label={transitFareLabel(option, direction)}
                value={leg.fare ?? 0}
                onChange={(fare) =>
                  updateLeg(option.id, direction, index, {
                    fare,
                    fareRange: undefined,
                    fareSource: 'manual',
                  })
                }
                t={t}
              />
            );
          })}
        {option.mode !== 'transit' && (
          <NumberField
            label={t(option.mode === 'hybrid' ? 'stationParking' : 'parking')}
            value={option.parkingCost}
            onChange={(parkingCost) =>
              option.id === drivingPreference?.id
                ? updateDrivingCosts({ parkingCost })
                : updateOption(option.id, { parkingCost, parkingVerified: false })
            }
            t={t}
          />
        )}
      </div>
      {option.mode === 'hybrid' && (
        <>
          <p className="sc-parking-alert">
            <Info size={16} />
            <span>{t('parkingUnknown')}</span>
          </p>
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
    </>
  );

  const renderWaypoints = (option: JourneyOption) => (
    <div className="sc-waypoints">
      <h4>{t('waypoints')}</h4>
      <p className="sc-help">{t('waypointNote')}</p>
      {option.waypoints.map((place, index) => (
        <div className="sc-waypoint-chip" key={`${index}-${place.label}`}>
          <MapPin size={15} />
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
            <X size={15} />
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
  );

  const renderOptionEditor = (option: JourneyOption, showTitle: boolean) => {
    const live = hasGoogleProvenance(option);
    return (
      <div key={option.id} className="sc-option-editor" data-testid={`route-editor-${option.id}`}>
        {(showTitle || live) && (
          <div className="sc-editor-title">
            <h3>{nameOf(option)}</h3>
            {option.id !== 'drive' && option.mode === 'drive' && !live && (
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
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
        {live ? (
          <>
            {renderDirections(option, false)}
            {option.mode !== 'transit' && (
              <NumberField
                label={t('parking')}
                value={option.parkingCost}
                onChange={(parkingCost) => updateDrivingCosts({ parkingCost })}
                t={t}
              />
            )}
            {option.mode !== 'drive' && renderFareHelper(option)}
          </>
        ) : (
          <>
            {renderEssentials(option)}
            {option.mode !== 'drive' && renderFareHelper(option)}
            <details className="sc-more-details">
              <summary>
                {t('moreRouteDetails')}
                <ChevronDown size={16} />
              </summary>
              <div className="sc-more-details-body">
                {renderDirections(option, true)}
                {option.mode === 'drive' && renderWaypoints(option)}
                <button
                  className="sc-text-button"
                  disabled={comparison.error}
                  onClick={() => saveRoute(option)}
                >
                  <Bookmark size={15} />
                  {t('saveRoute')}
                </button>
              </div>
            </details>
          </>
        )}
      </div>
    );
  };

  const renderCarFields = () => (
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
  );

  const renderSavedRoutes = () =>
    state.savedRoutes.length > 0 && (
      <details className="sc-saved-places">
        <summary>
          {t('savedRoutes')}
          <ChevronDown size={15} />
        </summary>
        {state.savedRoutes.map((option) => (
          <div className="sc-saved-place" key={option.id}>
            <span>{nameOf(option)}</span>
            <button
              className="sc-icon-button"
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
              <RotateCcw size={15} />
            </button>
            <button
              className="sc-icon-button"
              aria-label={`${t('deleteSavedRoute')} ${nameOf(option)}`}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  savedRoutes: current.savedRoutes.filter((route) => route.id !== option.id),
                }))
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </details>
    );

  const renderLocationRow = (field: 'origin' | 'destination') => {
    const missing = field === 'origin' ? originMissing : destinationMissing;
    const error = missing ? t(field === 'origin' ? 'originRequired' : 'destinationRequired') : '';
    const errorId = `${plannerId}-${field}-error`;
    return (
      <div className="sc-location-row">
        <span
          className={`sc-route-dot ${field === 'destination' ? 'sc-route-dot-end' : ''}`}
          aria-hidden="true"
        />
        {googleMode ? (
          <div
            className={`sc-field sc-live-address ${missing ? 'sc-field-invalid' : ''}`}
            aria-describedby={missing ? errorId : undefined}
          >
            <span>{t(field)}</span>
            <div ref={field === 'origin' ? originSearchRef : destinationSearchRef} />
            {!addressSearchEnabled && (
              <small>{addressSearchPending ? t('googleLoading') : state[field].label}</small>
            )}
            {missing && (
              <small id={errorId} className="sc-error">
                {error}
              </small>
            )}
          </div>
        ) : (
          <TextField
            label={t(field)}
            value={state[field].label}
            onChange={(label) => setState((current) => ({ ...current, [field]: { label } }))}
            error={error || undefined}
          />
        )}
        <button
          className="sc-icon-button"
          aria-label={t(field === 'origin' ? 'saveOrigin' : 'saveDestination')}
          onClick={() => savePlace(state[field])}
        >
          <Bookmark size={16} />
        </button>
      </div>
    );
  };

  // Arrival = departure plus the selected Google route's outbound time.
  const renderDestinationHours = () => {
    if (!destinationPlaceId) return null;
    const entry = destinationHours?.placeId === destinationPlaceId ? destinationHours : undefined;
    const arrivalAt =
      departureAt === undefined
        ? undefined
        : departureAt +
          (selected && hasGoogleProvenance(selected.option)
            ? selected.breakdown.outbound.totalMinutes
            : 0) *
            60000;
    let tone: 'open' | 'closed' | 'neutral' = 'neutral';
    let text = t('placeHoursLoading');
    if (entry?.failed || (entry && !entry.hours)) text = t('placeHoursError');
    else if (entry?.hours && arrivalAt === undefined) text = t('placeHoursNeedTime');
    else if (entry?.hours && arrivalAt !== undefined) {
      const offset = (entry.hours.utcOffsetMinutes ?? 0) * 60000;
      const day = (time: number) => Math.floor((time + offset) / 86_400_000);
      // Times are read in the place's own offset, so they match the opening hours shown.
      const language = locale === 'zh-CN' ? 'zh-CN' : 'en-NZ';
      const placeClock = (time: number) => {
        const clock = new Intl.DateTimeFormat(language, {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(time + offset);
        if (day(time) === day(arrivalAt)) return clock;
        // Weekday and time are joined explicitly so every language keeps a space between them.
        const weekday = new Intl.DateTimeFormat(language, {
          timeZone: 'UTC',
          weekday: 'short',
        }).format(time + offset);
        return `${weekday} ${clock}`;
      };
      const status = openingStatus(entry.hours, arrivalAt);
      const arrival = placeClock(arrivalAt);
      if (status.state === 'open') {
        tone = 'open';
        text = t('placeOpenAtArrival', { arrival, closes: placeClock(status.closesAt) });
      } else if (status.state === 'closed') {
        tone = 'closed';
        text = t('placeClosedAtArrival', {
          arrival,
          opens: status.opensAt === undefined ? '—' : placeClock(status.opensAt),
        });
      } else if (status.state === 'always-open') {
        tone = 'open';
        text = t('placeAlwaysOpen');
      } else if (status.state === 'closed-permanently' || status.state === 'closed-temporarily') {
        tone = 'closed';
        text = t(
          status.state === 'closed-permanently'
            ? 'placeClosedPermanently'
            : 'placeClosedTemporarily',
        );
      } else text = t('placeHoursUnknown');
    }
    return (
      <p className="sc-place-hours" data-tone={tone}>
        <Clock3 size={14} aria-hidden="true" />
        <span>{text}</span>
      </p>
    );
  };

  const renderLocationSection = () => (
    <section className="sc-input-section">
      <h2 id={`${plannerId}-journey`} className="sc-visually-hidden">
        {t('yourJourney')}
      </h2>
      <div className="sc-location-fields">
        {renderLocationRow('origin')}
        {googleMode &&
          drivingPreference &&
          (editingMode === 'drive' || drivingStops.length > 0) && (
            <section className="sc-stopovers" aria-label={t('waypoints')}>
              <div className="sc-stopover-heading">
                <h3>{t('waypoints')}</h3>
                <span>{drivingStops.length}/10</span>
              </div>
              {drivingStops.length > 1 && <p className="sc-help">{t('stopoverHelp')}</p>}
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
                          <ArrowUp size={15} />
                        </button>
                        <button
                          className="sc-icon-button"
                          aria-label={`${t('moveStopoverDown')} ${place.label}`}
                          disabled={index === drivingStops.length - 1}
                          onClick={() => moveDrivingStop(index, 1)}
                        >
                          <ArrowDown size={15} />
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
                          <X size={15} />
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
                <>
                  <button
                    className="sc-text-button sc-stopover-add"
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
                  {/* Phones have no map toolbar; the route page offers the map pick here. */}
                  {isMobile && (
                    <button
                      className="sc-text-button sc-stopover-add"
                      onClick={beginMapStopoverPick}
                      disabled={
                        googleStatus !== 'ready' ||
                        editingMode !== 'drive' ||
                        drivingStops.length >= 10
                      }
                    >
                      <MapPin size={16} />
                      {t('pickStopoverOnMap')}
                    </button>
                  )}
                </>
              )}
              {drivingStops.length >= 10 && <p className="sc-help">{t('stopoverLimit')}</p>}
              {stopoverRoutingBlocked && (
                <p className="sc-error" role="status">
                  {t('transitStopoverUnsupported')}
                </p>
              )}
            </section>
          )}
        {renderLocationRow('destination')}
        {renderDestinationHours()}
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
          <ArrowDownUp size={16} />
        </button>
      </div>
      <div className="sc-location-actions">
        <button className="sc-text-button" onClick={useLocation} disabled={locationLoading}>
          <LocateFixed size={15} />
          {t(locationLoading ? 'locating' : 'useLocation')}
        </button>
        {isMobile && googleMode && (
          <button
            className="sc-text-button"
            onClick={beginMapDestinationPick}
            disabled={googleStatus !== 'ready'}
          >
            <MapPin size={15} />
            {t('pickDestinationOnMap')}
          </button>
        )}
      </div>
      {locationError && (
        <p role="alert" className="sc-error">
          {t('locationFailed')}
        </p>
      )}
      {(!googleMode || !googleResponse) && (
        <p className="sc-help">{t(googleMode ? 'liveAddressHint' : 'manualLocationNote')}</p>
      )}
      {state.places.length > 0 && (
        <details className="sc-saved-places">
          <summary>
            {t('savedPlaces')}
            <ChevronDown size={15} />
          </summary>
          {state.places.map((place) => (
            <div className="sc-saved-place" key={place.label}>
              <span>{place.label}</span>
              <button
                className="sc-icon-button"
                title={t('applyOrigin')}
                aria-label={`${t('applyOrigin')} ${place.label}`}
                onClick={() => setState((current) => ({ ...current, origin: place }))}
              >
                <House size={15} />
              </button>
              <button
                className="sc-icon-button"
                title={t('applyDestination')}
                aria-label={`${t('applyDestination')} ${place.label}`}
                onClick={() => setState((current) => ({ ...current, destination: place }))}
              >
                <MapPin size={15} />
              </button>
              <button
                className="sc-icon-button"
                aria-label={`${t('removePlace')} ${place.label}`}
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    places: current.places.filter((saved) => saved.label !== place.label),
                  }))
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );

  const renderScheduleSection = () => (
    <section className="sc-input-section sc-schedule">
      <div className="sc-schedule-toggles">
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
      </div>
      {(!state.leaveNow || showReturnTime) && (
        <div className="sc-field-grid">
          {!state.leaveNow && (
            <TextField
              type="datetime-local"
              label={t('departure')}
              value={state.departure}
              onChange={(departure) => setState((current) => ({ ...current, departure }))}
              error={departureInvalid ? t('departureRequired') : undefined}
            />
          )}
          {showReturnTime && (
            <TextField
              type="datetime-local"
              label={t('returnTime')}
              value={state.returnTime}
              onChange={(returnTime) => setState((current) => ({ ...current, returnTime }))}
              error={returnTimeMissing ? t('googleMissingReturn') : undefined}
            />
          )}
        </div>
      )}
      <p
        className={`sc-help ${browserTimeZone !== 'Pacific/Auckland' ? 'sc-timezone-warning' : ''}`}
      >
        {t('browserTimezone', { zone: browserTimeZone })}
        {browserTimeZone !== 'Pacific/Auckland' && ` ${t('aucklandTimeHint')}`}
      </p>
    </section>
  );

  const renderModeSwitch = () => (
    <div className="sc-mode-switch" role="group" aria-label={t('routeParameters')}>
      {(googleMode
        ? (['drive', 'transit'] as const)
        : (['drive', 'transit', 'hybrid'] as const)
      ).map((mode) => (
        <button
          key={mode}
          className={editingMode === mode ? 'is-active' : ''}
          onClick={() => {
            setEditingMode(mode);
            if (googleMode && mode !== editingMode) setAutoPlanToken((count) => count + 1);
            // Keep the summary and schematic on the option being edited.
            const edited = comparison.result?.results.find((result) => result.mode === mode);
            if (!googleMode && edited && selected?.mode !== mode) selectResult(edited);
          }}
          aria-pressed={editingMode === mode}
        >
          <ModeIcon mode={mode} size={16} />
          <span>{t(mode)}</span>
        </button>
      ))}
    </div>
  );

  // Phones confirm the route page from its footer, so the inline plan button is left out there.
  const renderRoutingActions = (showPlanButton: boolean) => (
    <div className="sc-routing-actions">
      {showPlanButton && (
        <button
          className="sc-primary-button sc-full-width"
          onClick={() => void getGoogleRoutes(editingMode === 'transit' ? 'transit' : 'drive')}
          disabled={
            googleStatus !== 'ready' ||
            comparison.error ||
            stopoverRoutingBlocked ||
            departureInvalid ||
            returnTimeMissing
          }
        >
          <Route size={16} />
          {t(googleStatus === 'routes' ? 'googleRoutesLoading' : 'planRoute')}
        </button>
      )}
      {googleError && (
        <p className="sc-error" role="alert">
          {googleError}
        </p>
      )}
      {googleRequests > 0 && (
        <small className="sc-help">{t('googleMetrics', { count: googleRequests })}</small>
      )}
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
  );

  // Fares, fuel, parking and tolls for the option being edited; live routes edit the selected one.
  const renderCostEditors = () => {
    const editorOptions = visibleOptions.filter(
      (option) =>
        option.mode === editingMode && (!googleMode || option.id === (selected?.id ?? selectedId)),
    );
    return googleMode ? (
      <>
        {editingMode !== 'transit' && renderCarFields()}
        {editorOptions.map((option) => renderOptionEditor(option, true))}
        {renderSavedRoutes()}
      </>
    ) : (
      <>
        <p className="sc-help">{t('routeHint')}</p>
        {editingMode !== 'transit' && renderCarFields()}
        {editorOptions.map((option) => renderOptionEditor(option, editorOptions.length > 1))}
        {editingMode === 'drive' && (
          <button className="sc-text-button" onClick={addDrivingRoute}>
            <Plus size={15} />
            {t('alternativeRoute')}
          </button>
        )}
        {renderSavedRoutes()}
      </>
    );
  };

  const renderManualFallback = () =>
    props.googleApiKey &&
    !googleMode && (
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
    );

  const renderInputs = () => (
    <section className="sc-input-panel" aria-labelledby={`${plannerId}-journey`}>
      {renderLocationSection()}
      {renderScheduleSection()}
      <section className="sc-input-section">
        <h3 className="sc-section-label">{t('chooseMode')}</h3>
        {renderModeSwitch()}
        {googleMode ? (
          <>
            {renderRoutingActions(true)}
            <details className="sc-advanced-inputs">
              <summary>
                {t('adjustCosts')}
                <ChevronDown size={16} />
              </summary>
              <div className="sc-advanced-content">{renderCostEditors()}</div>
            </details>
          </>
        ) : (
          <div className="sc-mode-editor">{renderCostEditors()}</div>
        )}
      </section>
      {renderManualFallback()}
      {googleMode && (
        <button className="sc-text-button" onClick={() => setManualRequested(true)}>
          {t('useManualInputs')}
        </button>
      )}
      {!googleMode && <p className="sc-help sc-return-note">{t('estimatedReturn')}</p>}
    </section>
  );

  const legIcon = (mode: TravelLeg['mode']) =>
    mode === 'drive' ? (
      <Car size={16} />
    ) : mode === 'bus' ? (
      <Bus size={16} />
    ) : mode === 'train' ? (
      <TrainFront size={16} />
    ) : (
      <Route size={16} />
    );

  const renderSchematic = (compact = false) => {
    const diagramMode = selected?.mode ?? editingMode;
    const legs = selected?.option.outbound ?? [];
    const mainLegs = legs.filter((leg) => !minorModes.has(leg.mode));
    const minorMinutes = legs
      .filter((leg) => minorModes.has(leg.mode))
      .reduce((total, leg) => total + leg.durationMinutes, 0);
    const hubLabel =
      selected?.option.waypoints[0]?.label ||
      state.options.find((option) => option.mode === 'hybrid')?.waypoints[0]?.label ||
      '';
    const stop = (key: string, label: string, place: string, kind: 'start' | 'hub' | 'end') => (
      <li className={`sc-schematic-stop sc-stop-${kind}`} key={key}>
        <span className="sc-stop-marker" aria-hidden="true">
          {kind === 'start' ? <House size={14} /> : kind === 'end' ? <MapPin size={14} /> : null}
        </span>
        <span className="sc-stop-text">
          <span>{label}</span>
          <strong>{place || '—'}</strong>
        </span>
      </li>
    );
    const steps: ReactNode[] = [stop('start', t('start'), state.origin.label, 'start')];
    mainLegs.forEach((leg, index) => {
      const previous = mainLegs[index - 1];
      if (diagramMode === 'hybrid' && previous?.mode === 'drive' && leg.mode !== 'drive')
        steps.push(stop(`hub-${index}`, t('interchange'), placeLabel(hubLabel) || t('hub'), 'hub'));
      steps.push(
        <li className={`sc-schematic-leg sc-leg-${leg.mode}`} key={`leg-${index}`}>
          <span className="sc-leg-icon" aria-hidden="true">
            {legIcon(leg.mode)}
          </span>
          <span className="sc-leg-text">
            <strong>{t(legKeys[leg.mode])}</strong>
            <span>
              {[
                t('minutes', { count: shortNumber(leg.durationMinutes) }),
                leg.distanceKm !== undefined ? t('km', { count: shortNumber(leg.distanceKm) }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </li>,
      );
    });
    steps.push(stop('end', t('finish'), state.destination.label, 'end'));
    return (
      <section className="sc-map-panel" aria-label={t(googleMode ? 'googleMapTitle' : 'schematic')}>
        {!compact && (
          <div className="sc-map-toolbar">
            <span>{t(googleMode ? 'googleMapTitle' : 'schematic')}</span>
            <div className="sc-map-tools">
              {googleMode && (
                <button
                  className="sc-small-button"
                  onClick={
                    mapDestinationPicking ? cancelMapDestinationPick : beginMapDestinationPick
                  }
                  disabled={!mapDestinationPicking && googleStatus !== 'ready'}
                  aria-pressed={mapDestinationPicking}
                >
                  {mapDestinationPicking ? <X size={15} /> : <MapPin size={15} />}
                  {t(mapDestinationPicking ? 'cancelDestinationPick' : 'pickDestinationOnMap')}
                </button>
              )}
              {googleMode && (editingMode === 'drive' || mapStopoverPicking) && (
                <button
                  className="sc-small-button"
                  onClick={mapStopoverPicking ? cancelMapStopoverPick : beginMapStopoverPick}
                  disabled={
                    !mapStopoverPicking &&
                    (googleStatus !== 'ready' ||
                      editingMode !== 'drive' ||
                      drivingStops.length >= 10)
                  }
                  aria-pressed={mapStopoverPicking}
                >
                  {mapStopoverPicking ? <X size={15} /> : <Plus size={15} />}
                  {t(mapStopoverPicking ? 'cancelStopoverPick' : 'pickStopoverOnMap')}
                </button>
              )}
            </div>
          </div>
        )}
        {!compact && (
          <WeatherBar
            state={weather}
            locale={locale}
            originLabel={state.origin.label.split(',')[0]?.trim() || state.origin.label}
          />
        )}
        {googleMode && (
          <div className="sc-map-stage">
            <div
              className="sc-google-map"
              ref={googleMapRef}
              aria-label={t('googleMapDescription')}
            />
            {!compact && (mapStopoverPicking || mapDestinationPicking) && (
              <p className="sc-map-stopover-prompt" role="status">
                {t(mapDestinationPicking ? 'pickDestinationHint' : 'pickStopoverHint')}
              </p>
            )}
            {(googleStatus === 'idle' || googleStatus === 'loading') && (
              <div className="sc-map-loading" role="status">
                {t('googleLoading')}
              </div>
            )}
            {!compact && googleStatus === 'routes' && (
              <p className="sc-help" role="status">
                {t('googleRoutesLoading')}
              </p>
            )}
          </div>
        )}
        {!googleMode && (
          <div className="sc-schematic" data-mode={diagramMode}>
            <p className="sc-schematic-caption">
              {t('outboundRoute')} · {selected ? nameOf(selected) : t(diagramMode)}
            </p>
            <ol className="sc-schematic-route">{steps}</ol>
            {minorMinutes > 0 && (
              <p className="sc-help">{t('minorLegs', { minutes: shortNumber(minorMinutes) })}</p>
            )}
            <p className="sc-schematic-note">{t('schematicNote')}</p>
            <div className="sc-map-explainer">
              <h3>{t('manualMapTitle')}</h3>
              <p>{t('manualMapBody')}</p>
              <p>{t('mapFooter')}</p>
            </div>
          </div>
        )}
      </section>
    );
  };

  const resultSource = (result: RouteResult) =>
    hasGoogleProvenance(result.option)
      ? t(result.totalCostRange ? 'fareRangeSource' : 'googleVerifiedGeometry')
      : [...result.option.outbound, ...result.option.inbound].some(
            (leg) => leg.source === 'at-rule',
          )
        ? t('atFareSource')
        : t('manual');
  // A tied metric is not a distinction worth labelling on a card.
  const uniquelyBest = (result: RouteResult, metric: 'totalMinutes' | 'transfers') =>
    (comparison.result?.results ?? []).every(
      (other) => other.id === result.id || other[metric] > result[metric],
    );
  // A route with a missing leg distance cannot be called shortest, nor outrank one that can.
  const uniquelyShortest = (result: RouteResult) =>
    result.distanceComplete &&
    (comparison.result?.results ?? []).every(
      (other) =>
        other.id === result.id || !other.distanceComplete || other.distanceKm > result.distanceKm,
    );

  // The selected option expands in place, so its figures are never stated twice.
  const renderSelectedDetail = (result: RouteResult) => (
    <div className="sc-result-detail" ref={summaryRef}>
      {departureAt !== undefined && (
        <p className="sc-detail-clock">
          {t('outboundClock', {
            span: clockSpan(departureAt, result.breakdown.outbound.totalMinutes),
          })}
          {returnAt !== undefined &&
            ` · ${t('returnClock', { span: clockSpan(returnAt, result.breakdown.inbound.totalMinutes) })}`}
          {` · ${t('aucklandTime')}`}
        </p>
      )}
      <div className="sc-detail-figure">
        <span>{t('generalizedCostPerCommute')}</span>
        <strong>{moneyWithRange(result.generalizedCost, generalizedRange(result))}</strong>
        <p>{t('timeValueRate', { value: money(state.settings.valueOfTime) })}</p>
      </div>
      <div className="sc-projection sc-detail-figure">
        <span>{t('monthlyProjection')}</span>
        <strong className={result.monthlyCostRange ? 'sc-projection-range' : ''}>
          {moneyWithRange(result.monthlyCost, result.monthlyCostRange)}
        </strong>
        <p>
          {t('costUnit')} · {t('perMonth')} ·{' '}
          {t('basedOn', {
            days: state.settings.daysPerWeek,
            weeks: state.settings.weeksPerMonth,
          })}
        </p>
      </div>
      <button className="sc-text-button" onClick={() => openScreen('breakdown')}>
        {t('viewBreakdown')}
        <ArrowRight size={15} />
      </button>
    </div>
  );

  const renderGoogleAttribution = () =>
    googleResponse && (
      <section className="sc-google-attribution" aria-label={t('googleDetails')}>
        <strong>{googleResponse.attribution}</strong>
        <span>{t('googleDetails')}</span>
        {googleResponse.attributionLinks?.map((link) =>
          link.url ? (
            <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ) : (
            <span key={link.label}>{link.label}</span>
          ),
        )}
        {googleResponse.warnings.map((warning) => {
          const key = providerNoteKeys.find(([prefix]) => warning.startsWith(prefix))?.[1];
          return <p key={warning}>{key ? t(key) : warning}</p>;
        })}
      </section>
    );

  // Line names, stops and ranking tags shown on each option, wide or compact.
  const describeCard = (result: RouteResult) => {
    const transitLegs = result.option.outbound.flatMap((leg) => (leg.transit ? [leg.transit] : []));
    const lines = [
      ...new Set(
        transitLegs
          .map((leg) => leg.lineShortName || leg.lineName)
          .filter((line): line is string => Boolean(line)),
      ),
    ];
    const departureStop = transitLegs.find((leg) => leg.departureStop)?.departureStop;
    const arrivalStop = [...transitLegs].reverse().find((leg) => leg.arrivalStop)?.arrivalStop;
    const label = lines.length ? t('routeLine', { line: lines.join(' · ') }) : nameOf(result);
    const tags = [
      comparison.result?.cheapest.id === result.id && (
        <span className="sc-tag-primary" key="cheapest">
          {rankingLabel('cheapest')}
        </span>
      ),
      comparison.result?.fastest.id === result.id && uniquelyBest(result, 'totalMinutes') && (
        <span className="sc-tag-primary" key="fastest">
          {t('fastest')}
        </span>
      ),
      comparison.result?.shortest.id === result.id && uniquelyShortest(result) && (
        <span className="sc-tag-primary" key="shortest">
          {t('shortest')}
        </span>
      ),
      comparison.result?.bestValue.id === result.id && (
        <span className="sc-tag-quiet" key="best-value">
          {rankingLabel('bestValue')}
        </span>
      ),
      comparison.result?.fewestTransfers.id === result.id && uniquelyBest(result, 'transfers') && (
        <span className="sc-tag-quiet" key="fewest-transfers">
          {t('fewestTransfers')}
        </span>
      ),
    ].filter(Boolean);
    return { lines, departureStop, arrivalStop, label, tags };
  };

  const renderResults = () => {
    const shownCards = cardResults.filter(
      (result, index) => !googleMode || showAllRoutes || index < 3 || result.id === selected?.id,
    );
    const sources = new Set(shownCards.map(resultSource));
    const sharedSource = sources.size === 1 ? [...sources][0] : '';
    const drivingParkingUnverified = shownCards.some(
      (result) => result.mode === 'drive' && result.warnings.includes('unverified-parking'),
    );
    return (
      <section
        className="sc-results-panel"
        ref={resultsRef}
        tabIndex={-1}
        aria-labelledby={`${plannerId}-results-title`}
      >
        <div className="sc-results-heading">
          <div>
            <h2 id={`${plannerId}-results-title`}>{t('yourOptions')}</h2>
            <p>
              {t('optionCount', { count: comparison.result?.results.length ?? 0 })} ·{' '}
              {t('costUnit')} · <span>{tripScope}</span> · {t('perCommute')}
              {departureAt !== undefined && ` · ${t('aucklandTime')}`}
            </p>
          </div>
          {(comparison.result?.results.length ?? 0) > 1 && (
            <div className="sc-sort-group">
              <span className="sc-sort-label" aria-hidden="true">
                {t('sortBy')}
              </span>
              <div className="sc-sort" role="group" aria-label={t('sortBy')}>
                {(
                  [
                    ['cost', 'sortCost'],
                    ['time', 'sortTime'],
                    ['distance', 'sortDistance'],
                    ['value', 'sortValue'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={sortBy === key}
                    className={sortBy === key ? 'is-active' : ''}
                    onClick={() => setSortBy(key)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {comparison.error && (
          <div className="sc-empty-state" role="alert">
            <h3>{t('validationSummary')}</h3>
            <p>{t('noResults')}</p>
          </div>
        )}
        {!comparison.error && !comparison.result && (
          <div className="sc-empty-state">
            <h3>{t(googleMode ? 'planRoutePrompt' : noComparableRoutesKey)}</h3>
          </div>
        )}
        {shownCards.length > 0 && (
          <ol className="sc-option-list">
            {shownCards.map((result) => {
              const { lines, departureStop, arrivalStop, label, tags } = describeCard(result);
              const isSelected = selected?.id === result.id;
              return (
                <li key={result.id} className={`sc-option ${isSelected ? 'is-selected' : ''}`}>
                  <button
                    className="sc-result-card"
                    onClick={() => selectResult(result)}
                    aria-label={[
                      t('selectRoute', { name: label }),
                      departureStop && arrivalStop ? `${departureStop} → ${arrivalStop}` : '',
                      moneyWithRange(result.totalCost, result.totalCostRange),
                      t('minutes', { count: shortNumber(result.totalMinutes) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    aria-pressed={isSelected}
                    data-testid={`route-card-${result.id}`}
                  >
                    <span className="sc-result-radio" aria-hidden="true" />
                    <span className="sc-result-main">
                      <span className="sc-result-name">{label}</span>
                      {departureAt !== undefined && (
                        <span className="sc-result-clock">
                          {clockSpan(departureAt, result.breakdown.outbound.totalMinutes)}
                        </span>
                      )}
                      <span className="sc-result-meta">
                        {[
                          distanceText(result),
                          t('transferCount', { count: result.transfers }),
                        ].join(' · ')}
                      </span>
                      {result.congestionMinutes >= 1 && (
                        <span className="sc-result-congestion">
                          {t('congestionLine', {
                            minutes: Math.round(result.congestionMinutes),
                            cost: money(result.congestionFuelCost),
                          })}
                        </span>
                      )}
                      {lines.length > 0 && departureStop && arrivalStop && (
                        <span className="sc-result-stops">
                          {departureStop} → {arrivalStop}
                        </span>
                      )}
                      {!sharedSource && (
                        <span className="sc-result-source">{resultSource(result)}</span>
                      )}
                      {tags.length > 0 && <span className="sc-result-tags">{tags}</span>}
                      {result.totalCostRange && isSelected && (
                        <span className="sc-result-warning">
                          {t('fareRangeBadge')} · {t(fareExplanationKey(result.option))}
                        </span>
                      )}
                      {result.mode === 'hybrid' &&
                        result.warnings.includes('unverified-parking') && (
                          <span className="sc-result-warning">{t('parkingWarning')}</span>
                        )}
                    </span>
                    <span className="sc-result-figures">
                      <span
                        key={isSelected ? valueUpdates : 0}
                        className={`sc-money ${result.totalCostRange ? 'sc-money-range' : ''} ${isSelected && valueUpdates ? 'sc-value-updated' : ''}`}
                        data-testid={`cost-${result.id}`}
                      >
                        {moneyWithRange(result.totalCost, result.totalCostRange)}
                      </span>
                      <span className="sc-result-duration">
                        {wholeMinutes(result.totalMinutes)}
                      </span>
                    </span>
                  </button>
                  {isSelected && renderSelectedDetail(result)}
                </li>
              );
            })}
          </ol>
        )}
        {googleMode && (comparison.result?.results.length ?? 0) > 3 && (
          <button
            className="sc-show-routes"
            onClick={() => setShowAllRoutes((current) => !current)}
            aria-expanded={showAllRoutes}
          >
            {t(showAllRoutes ? 'showFewerRoutes' : 'showAllRoutes', {
              count: comparison.result!.results.length,
            })}
            <ChevronDown size={16} />
          </button>
        )}
        {shownCards.length > 0 && (
          <div className="sc-results-notes">
            {sharedSource && <p>{t('sharedSource', { source: sharedSource })}</p>}
            {drivingParkingUnverified && <p>{t('drivingParkingNote')}</p>}
            {hasFareRanges && <p>{t('fareRangeRankHelp')}</p>}
          </div>
        )}
        {comparison.result && comparison.result.results.length > 1 && (
          <div className="sc-recommendation">
            <h3>{t('recommendation')}</h3>
            {!hasFareRanges && (
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
            )}
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
            <button className="sc-text-button" onClick={() => openScreen('comparison')}>
              {t('comparison')}
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>
    );
  };

  const showResults = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    resultsRef.current?.scrollIntoView({
      block: 'start',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    resultsRef.current?.focus({ preventScroll: true });
  };

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
            {(['cheapest', 'fastest', 'shortest', 'fewestTransfers', 'bestValue'] as const).map(
              (kind) => {
                const result = comparison.result![kind];
                if (kind === 'shortest' && !result.distanceComplete) return null;
                return (
                  <button key={kind} onClick={() => selectResult(result)}>
                    <span>{rankingLabel(kind)}</span>
                    <strong>{nameOf(result)}</strong>
                    <small>
                      {kind === 'fastest'
                        ? t('minutes', { count: shortNumber(result.totalMinutes) })
                        : kind === 'shortest'
                          ? t('km', { count: shortNumber(result.distanceKm) })
                          : kind === 'fewestTransfers'
                            ? t('transferCount', { count: result.transfers })
                            : moneyWithRange(
                                kind === 'bestValue' ? result.generalizedCost : result.totalCost,
                                kind === 'bestValue'
                                  ? generalizedRange(result)
                                  : result.totalCostRange,
                              )}
                    </small>
                  </button>
                );
              },
            )}
          </div>
          <p className="sc-scope-note">
            {t('amountsInNzd')} · {tripScope}
          </p>
          <div className="sc-table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      'route',
                      'costPerCommute',
                      'time',
                      'distanceLabel',
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
                    <td>{distanceText(result)}</td>
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
          <button className="sc-primary-button" onClick={() => openScreen('breakdown')}>
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
          { key: 'fuel', value: selected.fuelCost, color: '#2b8b5f' },
          { key: 'congestionFuel', value: selected.congestionFuelCost, color: '#735824' },
          {
            key: 'fares',
            value: selected.fareCost,
            range: selected.fareCostRange,
            color: '#6a9bb4',
          },
          { key: 'parkingLabel', value: selected.parkingCost, color: '#cc942e' },
          { key: 'tolls', value: selected.tollCost, color: '#cc978c' },
          { key: 'maintenance', value: selected.maintenanceCost, color: '#8f7968' },
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
                  <span>
                    {t('costUnit')} · {tripScope} · {t('perCommute')}
                  </span>
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
                <p className="sc-scope-note">
                  {t('amountsInNzd')} · {tripScope}
                </p>
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
                    <dt>{t('timeValuePerCommute')}</dt>
                    <dd>{money(selected.generalizedCost - selected.totalCost)}</dd>
                  </div>
                  <div>
                    <dt>{t('generalizedCostPerCommute')}</dt>
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
                            : distanceModes.has(leg.mode)
                              ? t('distanceNotEntered')
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
          <h2>{t('carParameters')}</h2>
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
          <NumberField
            label={t('congestionFuelPerHour')}
            value={state.settings.congestionFuelPerHour ?? 0}
            onChange={(congestionFuelPerHour) => updateSettings({ congestionFuelPerHour })}
            t={t}
          />
          <p className="sc-help">{t('congestionExplanation')}</p>
        </div>
        <div className="sc-surface">
          <h2>{t('commutingPattern')}</h2>
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
              <Sun size={17} />
              {t('light')}
            </button>
            <button
              aria-pressed={theme === 'dark'}
              className={theme === 'dark' ? 'is-active' : ''}
              onClick={() => setTheme('dark')}
            >
              <Moon size={17} />
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
          <h2>{t('howItWorks')}</h2>
          <strong>{t('formula')}</strong>
          <p>{t('formulaExplanation')}</p>
          <p>{t('timeValueExplanation')}</p>
        </div>
        <div className="sc-surface">
          <h2>{t('privacy')}</h2>
          <p>{t('privacyDescription')}</p>
        </div>
      </div>
      <div className="sc-surface sc-data-sources">
        <h2>{t('dataSources')}</h2>
        {(['exampleSource', 'atSource', 'parkingSource', 'googleSource'] as const).map((key) => (
          <div className="sc-source-row" key={key}>
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

  const renderBanners = () => (
    <>
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
    </>
  );

  const renderRegistry = () => (
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
  );

  // Phone layout: the map stays mounted; route, costs and reading pages open over it.
  const pickingActive = mapDestinationPicking || mapStopoverPicking;
  const layerDepth = isMobile ? pages.length + (pickingActive ? 1 : 0) : 0;
  const historyDepth = useRef(
    typeof window === 'undefined' ? 0 : historyLayer(window.history.state),
  );
  const pageOpeners = useRef<(HTMLElement | null)[]>([]);
  const pageFocus = useRef<'page' | HTMLElement | null>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const sheetBodyId = `${plannerId}-sheet`;
  const sheetDrag = useRef<{ y: number; dragged: boolean } | null>(null);
  const sheetDragged = useRef(false);
  // Screen changes across the phone breakpoint carry the open reading page over.
  if (isMobile && screen !== 'planner') {
    setScreen('planner');
    setPages([screen]);
  }
  if (!isMobile && pages.length) {
    const reading = pages.filter((page) => page !== 'route' && page !== 'costs');
    setPages([]);
    if (reading.length) setScreen(reading[reading.length - 1]!);
  }
  const [wasShortViewport, setWasShortViewport] = useState(shortViewport);
  if (wasShortViewport !== shortViewport) {
    setWasShortViewport(shortViewport);
    if (shortViewport) setSheetOpen(false);
  }
  // An error belongs next to the options it affects, so the sheet opens to show it.
  const [shownGoogleError, setShownGoogleError] = useState(googleError);
  if (shownGoogleError !== googleError) {
    setShownGoogleError(googleError);
    if (googleError && isMobile) setSheetOpen(true);
  }

  const openScreen = (target: Exclude<Screen, 'planner'>) => {
    if (isMobile) openPage(target);
    else setScreen(target);
  };
  const cancelMapPick = () => {
    stopoverPickCleanup.current?.();
    stopoverPickCleanup.current = null;
    setMapStopoverPicking(false);
    setMapDestinationPicking(false);
  };
  const openPage = (page: MobilePage) => {
    if (pages[pages.length - 1] === page) return;
    if (pickingActive) cancelMapPick();
    if (page === 'route')
      routeDraft.current = {
        fingerprint: liveQueryFingerprint,
        origin: state.origin,
        destination: state.destination,
        leaveNow: state.leaveNow,
        departure: state.departure,
        returnTime: state.returnTime,
        roundTrip: state.settings.roundTrip,
        options: state.options,
        googleResponse,
        selectedId: selected?.id ?? selectedId,
        editingMode,
      };
    // The cost page edits the option whose total it shows.
    if (page === 'costs' && selected) setEditingMode(selected.mode);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pageOpeners.current = [...pageOpeners.current.slice(0, pages.length), opener];
    pageFocus.current = 'page';
    setPages([...pages, page]);
  };
  const restoreRouteDraft = (draft: RouteDraft) => {
    if (draft.fingerprint !== liveQueryFingerprint) restoredFingerprint.current = draft.fingerprint;
    setState((current) => ({
      ...current,
      origin: draft.origin,
      destination: draft.destination,
      leaveNow: draft.leaveNow,
      departure: draft.departure,
      returnTime: draft.returnTime,
      settings: { ...current.settings, roundTrip: draft.roundTrip },
      options: draft.options,
    }));
    setGoogleResponse(draft.googleResponse);
    setSelectedId(draft.selectedId);
    setEditingMode(draft.editingMode);
  };
  /** Closes map picking first, then pages from the top; an unconfirmed route edit is undone. */
  const closeLayers = (count: number) => {
    let remaining = count;
    if (pickingActive && remaining > 0) {
      cancelMapPick();
      remaining -= 1;
    }
    if (remaining <= 0) return;
    const kept = pages.slice(0, Math.max(0, pages.length - remaining));
    if (pages.slice(kept.length).includes('route')) {
      if (routeDraft.current) restoreRouteDraft(routeDraft.current);
      routeDraft.current = null;
      setStopoverSearchOpen(false);
      setStopoverDraft({ label: '' });
    }
    pageFocus.current = pageOpeners.current[kept.length] ?? null;
    pageOpeners.current = pageOpeners.current.slice(0, kept.length);
    setPages(kept);
  };
  const closeLayersAction = useRef(closeLayers);
  closeLayersAction.current = closeLayers;
  // Each page or map pick has a history entry, so the system back button closes it first.
  const goBack = () => {
    if (historyDepth.current > 0) window.history.back();
    else closeLayers(1);
  };
  const confirmRoute = () => {
    routeDraft.current = null;
    const mode = editingMode === 'transit' ? 'transit' : 'drive';
    const planned =
      Boolean(googleResponse) &&
      lastRequestedQuery.current === activeQuery.current &&
      lastRequestedMode.current === mode;
    goBack();
    if (googleMode && !planned) void getGoogleRoutes(mode);
  };
  useEffect(() => {
    const current = historyDepth.current;
    if (layerDepth > current) {
      const base: unknown = window.history.state;
      for (let layer = current + 1; layer <= layerDepth; layer += 1)
        window.history.pushState(
          { ...(base && typeof base === 'object' ? base : {}), [HISTORY_LAYER_KEY]: layer },
          '',
        );
      historyDepth.current = layerDepth;
    } else if (layerDepth < current) {
      historyDepth.current = layerDepth;
      window.history.go(layerDepth - current);
    }
  }, [layerDepth]);
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const layer = historyLayer(event.state);
      const current = historyDepth.current;
      if (layer === current) return;
      // Forward navigation cannot reopen a closed page; step back to the current one.
      if (layer > current) {
        window.history.go(current - layer);
        return;
      }
      historyDepth.current = layer;
      closeLayersAction.current(current - layer);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    const target = pageFocus.current;
    pageFocus.current = null;
    if (target === 'page') {
      const open = pageStackRef.current?.querySelectorAll<HTMLElement>('.sc-page');
      open?.[open.length - 1]?.focus();
    } else if (target?.isConnected) target.focus();
  }, [pages]);
  useEffect(() => {
    // Reattach the same map element when the layout switches; the map is never recreated.
    if (googleMode && googleMapRef.current && mapElementRef.current)
      googleMapRef.current.replaceChildren(mapElementRef.current);
  }, [isMobile, googleMode]);

  const cardLabel = (result: RouteResult) => describeCard(result).label;
  const sheetCards = cardResults.filter(
    (result, index) => !googleMode || showAllRoutes || index < 3 || result.id === selected?.id,
  );
  const hasDestination = Boolean(state.destination.label.trim());
  const routeConfirmBlocked =
    googleMode &&
    (googleStatus !== 'ready' ||
      comparison.error ||
      stopoverRoutingBlocked ||
      departureInvalid ||
      returnTimeMissing);

  const renderRouteCard = () => (
    <div className="sc-mobile-top">
      <button className="sc-route-card" onClick={() => openPage('route')}>
        <span className="sc-visually-hidden">{t('mobileEditRoute')}: </span>
        {hasDestination ? (
          <>
            <span className="sc-route-card-places">
              <span>{shortPlace(state.origin.label) || t('origin')}</span>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>{shortPlace(state.destination.label)}</strong>
            </span>
            <span className="sc-route-card-meta">
              {[
                t(selected?.mode ?? editingMode),
                state.leaveNow || departureAt === undefined
                  ? t('leaveNow')
                  : aucklandClock.format(departureAt),
                tripScope,
              ].join(' · ')}
            </span>
          </>
        ) : (
          <span className="sc-route-card-empty">
            <MapPin size={17} aria-hidden="true" />
            {t('mobileWhereTo')}
          </span>
        )}
      </button>
      <button
        className="sc-map-button"
        aria-label={t('settings')}
        onClick={() => openPage('settings')}
      >
        <SettingsIcon size={20} />
      </button>
    </div>
  );

  const renderMapTools = () => (
    <div className="sc-map-fabs" role="group" aria-label={t('mobileMapTools')}>
      <button
        className="sc-map-button"
        aria-label={t(locationLoading ? 'locating' : 'useLocation')}
        onClick={useLocation}
        disabled={locationLoading}
      >
        <LocateFixed size={20} />
      </button>
      {googleMode && (
        <button
          className="sc-map-button"
          aria-label={t('pickDestinationOnMap')}
          onClick={beginMapDestinationPick}
          disabled={googleStatus !== 'ready'}
        >
          <MapPin size={20} />
        </button>
      )}
      <button
        className="sc-map-button"
        aria-label={t('weatherTitle')}
        aria-expanded={weatherOpen}
        onClick={() => setWeatherOpen((open) => !open)}
      >
        <CloudSun size={20} />
      </button>
    </div>
  );

  const renderPickBar = () => (
    <div className="sc-mobile-top sc-mobile-pick" role="status">
      <span>{t(mapDestinationPicking ? 'pickDestinationHint' : 'pickStopoverHint')}</span>
      <button className="sc-small-button" onClick={goBack}>
        <X size={15} />
        {t(mapDestinationPicking ? 'cancelDestinationPick' : 'cancelStopoverPick')}
      </button>
    </div>
  );

  const renderSheetSummary = () => {
    if (googleMode && googleStatus === 'routes')
      return (
        <p className="sc-sheet-status" role="status">
          <span className="sc-spinner" aria-hidden="true" />
          {t('googleRoutesLoading')}
        </p>
      );
    if (selected)
      return (
        <div className="sc-sheet-selected">
          <span className="sc-sheet-name">
            <ModeIcon mode={selected.mode} size={16} />
            <span>{cardLabel(selected)}</span>
          </span>
          <strong
            key={valueUpdates}
            className={`sc-sheet-cost ${selected.totalCostRange ? 'sc-sheet-cost-range' : ''} ${valueUpdates ? 'sc-value-updated' : ''}`}
            data-testid="selected-cost"
          >
            {moneyWithRange(selected.totalCost, selected.totalCostRange)}
          </strong>
          <span className="sc-sheet-meta">
            <span>{tripScope}</span>
            {` · ${wholeMinutes(selected.totalMinutes)}`}
            {departureAt !== undefined &&
              ` · ${clockSpan(departureAt, selected.breakdown.outbound.totalMinutes)}`}
          </span>
          <span className="sc-sheet-source">
            {[
              resultSource(selected),
              selected.totalCostRange ? t('fareRangeBadge') : '',
              selected.warnings.includes('unverified-parking') ? t('parkingWarning') : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      );
    return (
      <div className="sc-sheet-empty">
        <strong>
          {!hasDestination
            ? t('mobileWhereTo')
            : comparison.error
              ? t('mobileFixInputs')
              : googleMode
                ? t('planRoutePrompt')
                : t(noComparableRoutesKey)}
        </strong>
        {!hasDestination && <p>{t('mobilePlanPrompt')}</p>}
        <div className="sc-sheet-empty-actions">
          {hasDestination && googleMode && !comparison.error ? (
            <>
              <button
                className="sc-primary-button"
                onClick={() =>
                  void getGoogleRoutes(editingMode === 'transit' ? 'transit' : 'drive')
                }
                disabled={routeConfirmBlocked}
              >
                <Route size={16} />
                {t('planRoute')}
              </button>
              <button className="sc-small-button" onClick={() => openPage('route')}>
                {t('mobileEditRoute')}
              </button>
            </>
          ) : (
            <button className="sc-primary-button" onClick={() => openPage('route')}>
              <MapPin size={16} />
              {t(hasDestination ? 'mobileEditRoute' : 'mobileChooseDestination')}
            </button>
          )}
          {googleMode && (
            <button className="sc-text-button" onClick={() => setManualRequested(true)}>
              {t('useManualInputs')}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSheetCards = () => (
    <ol className="sc-option-list sc-sheet-options">
      {sheetCards.map((result) => {
        const { label, tags } = describeCard(result);
        const isSelected = selected?.id === result.id;
        return (
          <li key={result.id} className={`sc-option ${isSelected ? 'is-selected' : ''}`}>
            <button
              className="sc-result-card sc-sheet-card"
              onClick={() => selectResult(result)}
              aria-pressed={isSelected}
              data-testid={`route-card-${result.id}`}
            >
              <span className="sc-result-radio" aria-hidden="true" />
              <span className="sc-result-main">
                <span className="sc-result-name">{label}</span>
                <span className="sc-result-meta">
                  {[
                    wholeMinutes(result.totalMinutes),
                    distanceText(result),
                    t('transferCount', { count: result.transfers }),
                  ].join(' · ')}
                </span>
                {!sharedSheetSource && (
                  <span className="sc-result-source">{resultSource(result)}</span>
                )}
                {tags.length > 0 && <span className="sc-result-tags">{tags}</span>}
              </span>
              <span
                className={`sc-money ${result.totalCostRange ? 'sc-money-range' : ''}`}
                data-testid={`cost-${result.id}`}
              >
                {moneyWithRange(result.totalCost, result.totalCostRange)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
  const sheetSources = new Set(sheetCards.map(resultSource));
  const sharedSheetSource = sheetSources.size === 1 ? [...sheetSources][0] : '';

  // Before there is anything to compare, the sheet is a short prompt with nothing to expand.
  const sheetExpandable = Boolean(comparison.result);
  const sheetNotices =
    !online ||
    comparison.incompleteOptions.length > 0 ||
    comparison.staleFareOptions.length > 0 ||
    Boolean(googleMode && googleError) ||
    locationError ||
    Boolean(props.googleApiKey && !googleMode) ||
    comparison.error;
  const renderSheet = () => (
    <section className="sc-sheet" aria-label={t('mobileSheetLabel')}>
      {sheetExpandable && (
        <div
          className="sc-sheet-grip"
          aria-hidden="true"
          onPointerDown={(event) => {
            sheetDrag.current = { y: event.clientY, dragged: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = sheetDrag.current;
            if (drag && Math.abs(event.clientY - drag.y) > 8) drag.dragged = true;
          }}
          onPointerUp={(event) => {
            const drag = sheetDrag.current;
            sheetDrag.current = null;
            if (!drag?.dragged) return;
            sheetDragged.current = true;
            const distance = event.clientY - drag.y;
            if (Math.abs(distance) > 24) setSheetOpen(distance < 0);
          }}
          onPointerCancel={() => {
            sheetDrag.current = null;
          }}
          onClick={() => {
            if (sheetDragged.current) sheetDragged.current = false;
            else setSheetOpen((open) => !open);
          }}
        >
          <span />
        </div>
      )}
      <div className="sc-sheet-head">
        {renderSheetSummary()}
        {sheetExpandable && (
          <button
            className="sc-icon-button sc-sheet-toggle"
            aria-expanded={sheetOpen}
            aria-controls={sheetBodyId}
            aria-label={t(sheetOpen ? 'mobileCollapseSheet' : 'mobileExpandSheet')}
            onClick={() => setSheetOpen((open) => !open)}
          >
            <ChevronDown size={20} />
          </button>
        )}
      </div>
      {(sheetExpandable || sheetNotices) && (
        <div id={sheetBodyId} className="sc-sheet-body" hidden={sheetExpandable && !sheetOpen}>
          {renderBanners()}
          {googleMode && googleError && (
            <p className="sc-error" role="alert">
              {googleError}
            </p>
          )}
          {locationError && (
            <p role="alert" className="sc-error">
              {t('locationFailed')}
            </p>
          )}
          {comparison.error && (
            <div className="sc-empty-state" role="alert">
              <h3>{t('validationSummary')}</h3>
              <p>{t('noResults')}</p>
            </div>
          )}
          {sheetCards.length > 0 && (
            <>
              <div className="sc-sheet-list-head">
                <h2>{t('yourOptions')}</h2>
                {(comparison.result?.results.length ?? 0) > 1 && (
                  <label className="sc-sheet-sort">
                    <span>{t('sortBy')}</span>
                    <select
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                    >
                      <option value="cost">{t('sortCost')}</option>
                      <option value="time">{t('sortTime')}</option>
                      <option value="distance">{t('sortDistance')}</option>
                      <option value="value">{t('sortValue')}</option>
                    </select>
                  </label>
                )}
              </div>
              {renderSheetCards()}
            </>
          )}
          {googleMode && (comparison.result?.results.length ?? 0) > 3 && (
            <button
              className="sc-show-routes"
              onClick={() => setShowAllRoutes((current) => !current)}
              aria-expanded={showAllRoutes}
            >
              {t(showAllRoutes ? 'showFewerRoutes' : 'showAllRoutes', {
                count: comparison.result!.results.length,
              })}
              <ChevronDown size={16} />
            </button>
          )}
          {sheetExpandable && (
            <div className="sc-sheet-actions">
              <button className="sc-small-button" onClick={() => openPage('comparison')}>
                {t('mobileCompareAll')}
              </button>
              <button className="sc-small-button" onClick={() => openPage('breakdown')}>
                {t('breakdown')}
              </button>
              <button className="sc-small-button" onClick={() => openPage('costs')}>
                {t('adjustCosts')}
              </button>
            </div>
          )}
          {/* Mode and data notices follow the options, which come first on a small screen. */}
          {!googleMode && (
            <div className="sc-demo-banner">
              <span className="sc-tag">{t('demoData')}</span>
              <p>{t('demoNotice')}</p>
            </div>
          )}
          {renderManualFallback()}
          {sheetCards.length > 0 && (
            <div className="sc-results-notes">
              {sharedSheetSource && <p>{t('sharedSource', { source: sharedSheetSource })}</p>}
              {sheetCards.some(
                (result) =>
                  result.mode === 'drive' && result.warnings.includes('unverified-parking'),
              ) && <p>{t('drivingParkingNote')}</p>}
              {hasFareRanges && <p>{t('fareRangeRankHelp')}</p>}
            </div>
          )}
          {renderGoogleAttribution()}
          {googleMode && sheetExpandable && (
            <button className="sc-text-button" onClick={() => setManualRequested(true)}>
              {t('useManualInputs')}
            </button>
          )}
          {!googleMode && <p className="sc-help">{t('estimatedReturn')}</p>}
        </div>
      )}
    </section>
  );

  const renderPageContent = (page: MobilePage) => {
    switch (page) {
      case 'route':
        return (
          <div className="sc-input-panel" aria-labelledby={`${plannerId}-journey`}>
            {renderLocationSection()}
            {renderScheduleSection()}
            {googleMode && (
              <section className="sc-input-section">
                <h3 className="sc-section-label">{t('chooseMode')}</h3>
                {renderModeSwitch()}
                {renderRoutingActions(false)}
              </section>
            )}
          </div>
        );
      case 'costs':
        return (
          <div className="sc-input-panel">
            <section className="sc-input-section">
              {!googleMode && (
                <>
                  <h3 className="sc-section-label">{t('chooseMode')}</h3>
                  {renderModeSwitch()}
                </>
              )}
              <div className="sc-mode-editor">{renderCostEditors()}</div>
            </section>
            <p className="sc-help sc-return-note">
              {t('mobileCostsLive')} {!googleMode && t('estimatedReturn')}
            </p>
          </div>
        );
      case 'comparison':
        return (
          <>
            {renderComparison()}
            {renderGoogleAttribution()}
          </>
        );
      case 'breakdown':
        return (
          <>
            {renderBreakdown()}
            {renderGoogleAttribution()}
          </>
        );
      case 'settings':
        return (
          <>
            {renderSettings()}
            <section className="sc-page-content">
              <button className="sc-small-button sc-full-width" onClick={() => openPage('about')}>
                {t('about')}
                <ChevronRight size={16} />
              </button>
            </section>
          </>
        );
      case 'about':
        return (
          <>
            {renderAbout()}
            {renderRegistry()}
            <p className="sc-page-content sc-help">{t('footer')}</p>
          </>
        );
    }
  };

  const renderPageFooter = (page: MobilePage) =>
    page === 'route' ? (
      <footer className="sc-page-footer">
        <button
          className="sc-primary-button sc-full-width"
          onClick={confirmRoute}
          disabled={routeConfirmBlocked}
        >
          {googleMode && <Route size={16} />}
          {t(googleMode ? 'planRoute' : 'mobileDone')}
        </button>
      </footer>
    ) : page === 'costs' ? (
      <footer className="sc-page-footer sc-cost-footer">
        {selected && (
          <span className="sc-cost-footer-total">
            <span>{cardLabel(selected)}</span>
            <strong>{moneyWithRange(selected.totalCost, selected.totalCostRange)}</strong>
            <span>{tripScope}</span>
          </span>
        )}
        <button className="sc-primary-button" onClick={goBack}>
          {t('mobileDone')}
        </button>
      </footer>
    ) : null;

  const pageTitles: Record<MobilePage, MessageKey> = {
    route: 'mobileEditRoute',
    costs: 'adjustCosts',
    comparison: 'comparison',
    breakdown: 'breakdown',
    settings: 'settings',
    about: 'about',
  };
  const renderPage = (page: MobilePage, index: number) => {
    const covered = index < pages.length - 1 || pickingActive;
    const titleId = `${plannerId}-page-${page}`;
    // Reading pages carry their own heading; the bar title then only names the page.
    const Title = page === 'route' || page === 'costs' ? 'h1' : 'p';
    return (
      <section
        key={page}
        className={`sc-page ${covered ? 'is-covered' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        inert={covered}
        data-page={page}
      >
        <header className="sc-page-bar">
          <button
            className="sc-icon-button"
            aria-label={t(page === 'route' ? 'mobileDiscardRoute' : 'mobileBack')}
            onClick={goBack}
          >
            <ArrowLeft size={20} />
          </button>
          <Title id={titleId} className="sc-page-bar-title">
            {t(pageTitles[page])}
          </Title>
        </header>
        <div className="sc-page-body">{renderPageContent(page)}</div>
        {renderPageFooter(page)}
      </section>
    );
  };

  const renderMobileShell = () => {
    const pageShown = pages.length > 0 && !pickingActive;
    return (
      <main className="sc-mobile-shell">
        <div className="sc-mobile-main" inert={pageShown} aria-hidden={pageShown || undefined}>
          <div className="sc-mobile-map">
            {renderSchematic(true)}
            {pickingActive ? renderPickBar() : renderRouteCard()}
            {!pickingActive && renderMapTools()}
            {weatherOpen && !pickingActive && (
              <div className="sc-mobile-weather">
                <WeatherBar
                  state={weather}
                  locale={locale}
                  originLabel={shortPlace(state.origin.label)}
                />
              </div>
            )}
          </div>
          {renderSheet()}
        </div>
        {pages.length > 0 && (
          <div className="sc-page-stack" ref={pageStackRef}>
            {pages.map(renderPage)}
          </div>
        )}
      </main>
    );
  };

  const tabs: { key: Screen; label: MessageKey }[] = [
    { key: 'planner', label: 'planner' },
    { key: 'comparison', label: 'comparison' },
    { key: 'breakdown', label: 'breakdown' },
    { key: 'settings', label: 'settings' },
    { key: 'about', label: 'about' },
  ];
  return (
    <div className={`smart-commute sc-theme-${theme} ${isMobile ? 'sc-mobile' : ''}`} lang={locale}>
      {!isMobile && (
        <header className="sc-header">
          <a
            className="sc-brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              setScreen('planner');
            }}
          >
            <span className="sc-brand-symbol" aria-hidden="true">
              <Route size={18} />
            </span>
            <span className="sc-brand-text">
              <strong>
                {t('appName')}
                <span className="sc-brand-nz">NZ</span>
              </strong>
              <small>{t('region')}</small>
            </span>
          </a>
          <div className="sc-header-actions">
            <span className="sc-header-status">
              <span className="sc-status-dot" aria-hidden="true" />
              {t(googleMode ? 'googleOnline' : 'manualMode')}
            </span>
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
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>
      )}
      {isMobile ? (
        renderMobileShell()
      ) : (
        <>
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
            {renderBanners()}
            {screen === 'planner' && (
              <div className="sc-workspace">
                <div className="sc-plan-column">
                  <section className="sc-planner-intro">
                    <h1>{t('headline')}</h1>
                    <p>{t('subheadline')}</p>
                    {!googleMode && (
                      <div className="sc-demo-banner">
                        <span className="sc-tag">{t('demoData')}</span>
                        <p>{t('demoNotice')}</p>
                      </div>
                    )}
                  </section>
                  {renderInputs()}
                  {renderResults()}
                  {renderGoogleAttribution()}
                  {selected && !summaryInView && (
                    <div className="sc-selected-bar">
                      <span className="sc-selected-bar-text">
                        <span>{nameOf(selected)}</span>
                        <strong>
                          {moneyWithRange(selected.totalCost, selected.totalCostRange)}
                        </strong>
                        <span>
                          {tripScope} ·{' '}
                          {t('minutes', { count: shortNumber(selected.totalMinutes) })}
                        </span>
                      </span>
                      <button className="sc-small-button" onClick={showResults}>
                        {t('viewOptions')}
                      </button>
                    </div>
                  )}
                </div>
                {renderSchematic()}
              </div>
            )}
            {screen === 'comparison' && renderComparison()}
            {screen === 'breakdown' && renderBreakdown()}
            {screen === 'settings' && renderSettings()}
            {screen === 'about' && renderAbout()}
            {screen !== 'planner' && renderGoogleAttribution()}
            {screen === 'about' && renderRegistry()}
          </main>
          <footer className="sc-footer">
            <span>{t('footer')}</span>
            <span>{t(googleMode ? 'googleDetails' : 'offlineStatus')}</span>
          </footer>
        </>
      )}
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
