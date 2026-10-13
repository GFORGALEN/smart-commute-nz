import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bus, Car, Route, TrainFront } from 'lucide-react';
import {
  AUCKLAND_TIME_ZONE,
  type CommuteSettings,
  type CostRange,
  EXAMPLE_INTERCHANGE_LABEL,
  type JourneyOption,
  type Location,
  type RouteResult,
  type TravelLeg,
  createExampleOptions,
  resolveZonedTime,
} from '@smart-commute/core';
import {
  GoogleRouteProvider,
  type PlaceHours,
  type RouteResult as ProviderRouteResult,
  RouteProviderError,
} from '@smart-commute/providers';
import { type Locale, type MessageKey, createTranslator, formatMoney } from '@smart-commute/i18n';
import { useWeather } from '../useWeather';
import { buildComparison, orderCards, type CardSort } from './comparison';
import {
  HISTORY_LAYER_KEY,
  MOBILE_MAP_PADDING,
  MOBILE_QUERY,
  SHORT_VIEWPORT_QUERY,
  STORAGE_KEY,
  TIMES_VERSION,
  directionKeys,
  distanceModes,
  googleErrorKeys,
  historyLayer,
} from './constants';
import { cloneOption, hasGoogleProvenance, shortNumber, toLocation } from './helpers';
import {
  failedRouteOutcome,
  liveOptions,
  RouteCache,
  routeQueryKey,
  RouteRequestQueue,
  statusForQuery,
} from './routeRequests';
import { hasSavedTrip, initialState, savedLiveMode } from './storage';
import {
  type Direction,
  type LiveMode,
  type MobilePage,
  type PlannerState,
  type RouteDraft,
  type RouteStatus,
  type Screen,
  type SmartCommutePlannerProps,
  type StatusAction,
} from './types';
import { useMediaQuery } from './useMediaQuery';

/**
 * The planner's state, effects and handlers. The view modules read this model and hold no
 * state of their own, so the wide layout and the phone layout share one behaviour.
 */
export function usePlannerModel(props: SmartCommutePlannerProps) {
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
  // Route page sub-states: searching one place, the time panel, and its stops or more panel.
  const [searchField, setSearchField] = useState<'origin' | 'destination' | null>(null);
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(false);
  const [routePanel, setRoutePanel] = useState<'stops' | 'more' | null>(null);
  const mobileTopRef = useRef<HTMLDivElement>(null);
  const routeEditing = isMobile && pages.includes('route');
  const routeEditingRef = useRef(routeEditing);
  routeEditingRef.current = routeEditing;
  // Address search lives in the planner column on wide screens and in the route page on phones.
  const addressInputsMounted = isMobile ? routeEditing : screen === 'planner';
  const [editingMode, setEditingMode] = useState<JourneyOption['mode']>(() =>
    props.googleApiKey ? savedLiveMode() : 'drive',
  );
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
  // Set when a mode switch or a map-picked destination should plan without another click.
  const [planIntent, setPlanIntent] = useState<{ mode: LiveMode; seq: number } | null>(null);
  const requestPlan = (mode: LiveMode) =>
    setPlanIntent((current) => ({ mode, seq: (current?.seq ?? 0) + 1 }));
  const [routeStatus, setRouteStatus] = useState<RouteStatus>({ state: 'idle' });
  const [addressResolving, setAddressResolving] = useState(0);
  const [summaryInView, setSummaryInView] = useState(true);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [sortBy, setSortBy] = useState<CardSort>('cost');
  const [manualRequested, setManualRequested] = useState(false);
  // The map's own lifecycle; route requests have their own status.
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
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
  const requestQueue = useRef(new RouteRequestQueue());
  const routeCache = useRef(new RouteCache());
  const restorePending = useRef<boolean | null>(null);
  if (restorePending.current === null) restorePending.current = hasSavedTrip();
  const mapLoadPending = useRef(false);
  const mapReadyProvider = useRef<GoogleRouteProvider | null>(null);
  const resetProvider = useRef<GoogleRouteProvider | null>(null);
  const mounted = useRef(true);
  const lastRequestedQuery = useRef('');

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
  // Entered times are Auckland wall-clock times; each resolves to one absolute instant.
  const resolveEntered = (local: string, fold: 'earlier' | 'later' | undefined) => {
    const resolution = resolveZonedTime(local, AUCKLAND_TIME_ZONE);
    const instant =
      resolution.kind === 'valid'
        ? resolution.instant
        : resolution.kind === 'ambiguous' && fold
          ? resolution[fold]
          : undefined;
    return { resolution, instant };
  };
  const departureEntry = resolveEntered(state.departure, state.departureFold);
  const returnEntry = resolveEntered(state.returnTime, state.returnFold);
  const scheduledReturn = state.settings.roundTrip && state.returnPolicy === 'scheduled';
  // Live planning routes a return only for a chosen time; otherwise the return is a budget estimate.
  const routedReturn = googleMode && scheduledReturn;
  const departureInvalid = !state.leaveNow && departureEntry.instant === undefined;
  const showReturnTime = googleMode ? scheduledReturn : state.settings.roundTrip && !state.leaveNow;
  const returnTimeMissing = routedReturn && !state.returnTime;
  const returnInvalid =
    showReturnTime && Boolean(state.returnTime) && returnEntry.instant === undefined;
  const departureAt = state.leaveNow ? currentMinute * 60000 : departureEntry.instant;
  const returnAt = showReturnTime ? returnEntry.instant : undefined;
  const returnBeforeDeparture =
    returnAt !== undefined && departureAt !== undefined && returnAt <= departureAt;
  const timesNeedReview = Boolean(state.timesNeedReview) && (!state.leaveNow || showReturnTime);
  const timesBlocked =
    departureInvalid ||
    timesNeedReview ||
    (routedReturn && (returnTimeMissing || returnInvalid || returnBeforeDeparture));
  const liveMode: LiveMode = editingMode === 'transit' ? 'transit' : 'drive';
  const queryKeyFor = (mode: LiveMode) =>
    routeQueryKey({
      origin: state.origin,
      destination: state.destination,
      waypoints: drivingStops,
      mode,
      leaveNow: state.leaveNow,
      departureAt,
      routedReturn,
      returnAt,
    });
  const liveQueryFingerprint = queryKeyFor(liveMode);
  const routeLoading = routeStatus.state === 'loading' && routeStatus.key === liveQueryFingerprint;
  const planDisabled =
    googleStatus !== 'ready' ||
    !state.origin.label.trim() ||
    !state.destination.label.trim() ||
    stopoverRoutingBlocked ||
    timesBlocked ||
    routeLoading ||
    addressResolving > 0;
  const currentRouteStatus = statusForQuery(routeStatus, liveQueryFingerprint);
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
  const comparison = useMemo(
    () => buildComparison(state, visibleOptions, atFareContexts, currentMinute),
    [state, visibleOptions, atFareContexts, currentMinute],
  );
  const noComparableRoutesKey: MessageKey =
    comparison.staleFareOptions.length || comparison.pendingFareOptions.length
      ? 'noComparableRoutes'
      : 'noCompleteRoutes';
  const selected =
    comparison.result?.results.find((result) => result.id === selectedId) ??
    comparison.result?.results[0];
  const hasFareRanges = Boolean(comparison.result?.results.some((result) => result.totalCostRange));
  const cardResults = orderCards(comparison.result?.results ?? [], sortBy);
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
  const estimatedReturn = Boolean(
    state.settings.roundTrip &&
    visibleOptions.some((option) => option.returnBasis === 'estimated-from-outbound'),
  );
  const tripScope = t(
    !state.settings.roundTrip
      ? 'oneWay'
      : estimatedReturn
        ? 'returnEstimateScope'
        : 'returnIncluded',
  );
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
  const timeError = (
    entry: typeof departureEntry,
    local: string,
    missing: MessageKey,
  ): string | undefined =>
    !local
      ? t(missing)
      : entry.resolution.kind === 'nonexistent'
        ? t('timeSkipped')
        : entry.resolution.kind === 'invalid'
          ? t('timeInvalid')
          : entry.instant === undefined
            ? t('timeRepeated')
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
    setAddressResolving(0);
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
    // A result already found for these conditions and mode comes back without a request.
    if (restoreCachedAction.current(liveQueryFingerprint)) return;
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
    routeCache.current.clear();
    requestQueue.current.take();
    setRouteStatus({ state: 'idle' });
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
          timesVersion: TIMES_VERSION,
          timeZone: AUCKLAND_TIME_ZONE,
          departureInstant: departureEntry.instant ?? null,
          returnInstant: returnEntry.instant ?? null,
          liveMode,
        }),
      );
      localStorage.setItem('smart-commute-nz:appearance', JSON.stringify({ locale, theme }));
    } catch {
      /* A private browser or full storage still supports the calculator. */
    }
  }, [
    state,
    comparison.error,
    locale,
    theme,
    departureEntry.instant,
    returnEntry.instant,
    liveMode,
  ]);
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
    if (hasGoogleProvenance(result.option))
      routeCache.current.select(liveQueryFingerprint, result.id);
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
        requestPlan(liveModeRef.current);
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
            setSearchField(null);
          },
          onError,
          {
            initialValue: state[field].label,
            label: t(field === 'origin' ? 'origin' : 'destination'),
            onResolving: (resolving) => {
              if (isCurrent())
                setAddressResolving((count) => Math.max(0, count + (resolving ? 1 : -1)));
            },
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
  const showLiveResponse = (
    response: ProviderRouteResult,
    key: string,
    mode: LiveMode,
    selectedRoute?: string,
  ) => {
    setGoogleResponse(response);
    setState((current) => ({
      ...current,
      options: [
        ...current.options.filter((option) => !hasGoogleProvenance(option)),
        ...liveOptions(
          response,
          current.options.find((option) => option.mode === 'drive' && !hasGoogleProvenance(option)),
        ),
      ],
    }));
    const first = response.routes[0]?.id;
    if (first) setSelectedId(selectedRoute ?? first);
    setRouteStatus({ state: response.routes.length ? 'success' : 'no-routes', key, mode });
  };
  const restoreCached = (key: string) => {
    const entry = googleMode ? routeCache.current.fresh(key) : undefined;
    if (!entry) return false;
    showLiveResponse(entry.response, key, liveMode, entry.selectedId);
    return true;
  };
  const restoreCachedAction = useRef(restoreCached);
  restoreCachedAction.current = restoreCached;
  const liveModeRef = useRef(liveMode);
  liveModeRef.current = liveMode;
  const getGoogleRoutes = async (
    mode: LiveMode = 'drive',
    { force = false }: { force?: boolean } = {},
  ) => {
    if (
      !googleMode ||
      comparison.error ||
      !state.origin.label.trim() ||
      !state.destination.label.trim()
    )
      return;
    if (mode === 'transit' && drivingStops.length) {
      setGoogleError(t('transitStopoverUnsupported'));
      return;
    }
    if (returnTimeMissing) {
      setNotice(t('googleMissingReturn'));
      return;
    }
    if (timesBlocked) return;
    // Planning waits for the map, so drawn routes and results always arrive together.
    if (mapReadyProvider.current !== provider) {
      requestQueue.current.defer(mode);
      return;
    }
    const key = queryKeyFor(mode);
    if (!force && routeCache.current.fresh(key)) {
      if (key === activeQuery.current) restoreCached(key);
      return;
    }
    if (requestQueue.current.begin(key, mode) === 'queued') {
      setRouteStatus({ state: 'loading', key, mode });
      return;
    }
    lastRequestedQuery.current = key;
    setRouteStatus({ state: 'loading', key, mode });
    setGoogleError('');
    const leaveNow = state.leaveNow;
    try {
      const response = await provider.getRoutes({
        origin: state.origin,
        destination: state.destination,
        mode,
        waypoints: mode === 'drive' ? (drivingPreference?.waypoints ?? []) : [],
        // Leaving now lets the provider use the instant the request is made.
        departureTime: leaveNow || departureAt === undefined ? undefined : new Date(departureAt),
        returnTime: routedReturn && returnAt !== undefined ? new Date(returnAt) : undefined,
        roundTrip: routedReturn,
      });
      if (!mounted.current || activeProvider.current !== provider) return;
      routeCache.current.store(key, response, leaveNow);
      // A newer choice is showing; this result stays cached for when it is chosen again.
      if (activeQuery.current !== key) return;
      showLiveResponse(response, key, mode);
      setNotice('');
      if (!window.matchMedia?.(SHORT_VIEWPORT_QUERY).matches) setSheetOpen(true);
    } catch (error) {
      if (!mounted.current || activeProvider.current !== provider || activeQuery.current !== key)
        return;
      const outcome = failedRouteOutcome(error);
      if (outcome.state === 'no-routes') {
        // An explicit empty answer, not a failure: say so for this mode and time.
        setRouteStatus({ state: 'no-routes', key, mode });
        return;
      }
      setRouteStatus({ state: 'error', key, mode, code: outcome.code });
      setGoogleError(describeGoogleError(error));
      if (outcome.useManualFallback) setManualRequested(true);
    } finally {
      const next = requestQueue.current.finish();
      if (mounted.current && activeProvider.current === provider) {
        setGoogleRequests(provider.getMetrics().routeRequests);
        if (next) void routeAction.current(next);
      }
    }
  };

  const loadMapAction = useRef(loadGoogle);
  loadMapAction.current = loadGoogle;
  const addressSearchAction = useRef(enableAddressSearch);
  addressSearchAction.current = enableAddressSearch;
  const routeAction = useRef(getGoogleRoutes);
  routeAction.current = getGoogleRoutes;
  const stopCount = useRef(0);
  stopCount.current = drivingStops.length;
  useEffect(() => {
    // The phone route page is a draft: it plans only when the person confirms it.
    if (!planIntent || routeEditingRef.current) return;
    // Transit cannot take stops; the stop list already explains why nothing is planned.
    if (planIntent.mode === 'transit' && stopCount.current > 0) return;
    void routeAction.current(planIntent.mode);
  }, [planIntent]);
  useEffect(() => {
    if (!googleMode || googleStatus !== 'ready') return;
    // A choice made while the map loaded, or a saved trip restored on opening, plans once.
    const next =
      requestQueue.current.take() ?? (restorePending.current ? liveModeRef.current : null);
    restorePending.current = false;
    if (next) void routeAction.current(next);
  }, [googleMode, googleStatus]);
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
        void routeAction.current(liveModeRef.current);
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

  const googleMapReady = googleStatus === 'ready';
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
  /** Route framing keeps clear of the controls actually drawn over the top of the phone map. */
  const mobileMapPadding = () => {
    const map = googleMapRef.current?.getBoundingClientRect();
    const top = mobileTopRef.current?.getBoundingClientRect();
    return {
      ...MOBILE_MAP_PADDING,
      ...(map && top && top.bottom > map.top ? { top: Math.round(top.bottom - map.top + 16) } : {}),
    };
  };
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
      ...(isMobile ? { padding: mobileMapPadding() } : {}),
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

  /** Swaps places and reverses driving stops; departure and return times stay as they are. */
  const swapPlaces = () =>
    setState((current) => ({
      ...current,
      origin: current.destination,
      destination: current.origin,
      options: current.options.map((option) =>
        option.mode === 'drive' && !hasGoogleProvenance(option)
          ? { ...option, waypoints: [...option.waypoints].reverse() }
          : option,
      ),
    }));
  const editTime = (patch: Partial<PlannerState>) =>
    // Editing a time is the confirmation that it is meant as an Auckland time.
    setState((current) => ({ ...current, ...patch, timesNeedReview: false }));
  const returnFieldError = returnTimeMissing
    ? t('googleMissingReturn')
    : returnInvalid
      ? timeError(returnEntry, state.returnTime, 'googleMissingReturn')
      : returnBeforeDeparture
        ? t('returnBeforeDeparture')
        : undefined;
  /** Shows the other mode at once: its cached result, or a request when the places are complete. */
  const switchLiveMode = (mode: LiveMode) => {
    if (mode === editingMode) return;
    setEditingMode(mode);
    requestPlan(mode);
  };

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

  const showResults = () => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    resultsRef.current?.scrollIntoView({
      block: 'start',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    resultsRef.current?.focus({ preventScroll: true });
  };

  const routeStatusView = (): { title: string; alert?: boolean; actions: StatusAction[] } => {
    if (originMissing) return { title: t('routeNeedOrigin'), actions: ['edit'] };
    if (destinationMissing) return { title: t('mobileWhereTo'), actions: ['edit'] };
    if (comparison.error) return { title: t('validationSummary'), alert: true, actions: ['edit'] };
    if (!googleMode)
      return {
        title: t(noComparableRoutesKey),
        actions: comparison.pendingFareOptions.length ? ['costs'] : [],
      };
    if (stopoverRoutingBlocked)
      // Wide screens explain this inside the stop list.
      return isMobile
        ? { title: t('transitStopoverUnsupported'), alert: true, actions: ['removeStops', 'drive'] }
        : { title: t('mobileFixInputs'), actions: ['removeStops', 'drive'] };
    if (timesBlocked)
      return {
        title: t(timesNeedReview ? 'timesNeedReview' : 'mobileFixInputs'),
        alert: true,
        actions: ['changeTime'],
      };
    if (googleStatus !== 'ready') return { title: t('googleLoading'), actions: [] };
    const status = currentRouteStatus;
    if (status.state === 'loading')
      return {
        title: t(status.mode === 'transit' ? 'routeLoadingTransit' : 'routeLoadingDrive'),
        actions: [],
      };
    if (status.state === 'no-routes')
      return {
        title: t(status.mode === 'transit' ? 'routeNoTransit' : 'routeNoDrive'),
        actions: ['changeTime', 'switchMode', 'retry'],
      };
    if (status.state === 'error')
      // Wide screens show the full error beside the plan button; this only marks the state.
      return isMobile
        ? { title: googleError || t('googleError'), alert: true, actions: ['retry', 'manual'] }
        : { title: t('routeErrorShort'), actions: ['retry', 'manual'] };
    if (status.state === 'success') {
      if (googleResponse?.returnStatus === 'no-routes')
        return { title: t('returnNoRoutes'), actions: ['changeTime', 'oneWay', 'estimate'] };
      if (comparison.pendingFareOptions.length)
        return { title: t('farePendingNotice'), actions: ['costs'] };
      return { title: t(noComparableRoutesKey), actions: ['costs'] };
    }
    return { title: t('routeReady'), actions: ['plan'] };
  };
  const otherLiveMode: LiveMode = liveMode === 'drive' ? 'transit' : 'drive';
  const statusActionLabel = (action: StatusAction) =>
    action === 'plan'
      ? t('planRoute')
      : action === 'retry'
        ? t('routeRetry')
        : action === 'edit'
          ? t(destinationMissing ? 'mobileChooseDestination' : 'mobileEditRoute')
          : action === 'changeTime'
            ? t('routeChangeTime')
            : action === 'switchMode'
              ? t('routeSwitchMode', { mode: t(otherLiveMode) })
              : action === 'manual'
                ? t('routeUseManual')
                : action === 'oneWay'
                  ? t('returnUseOneWay')
                  : action === 'estimate'
                    ? t('returnUseEstimate')
                    : action === 'removeStops'
                      ? t('removeStopsContinue')
                      : action === 'drive'
                        ? t('switchToDrive')
                        : t('adjustCosts');
  const runStatusAction = (action: StatusAction) => {
    if (action === 'plan') void getGoogleRoutes(liveMode);
    else if (action === 'retry') void getGoogleRoutes(liveMode, { force: true });
    else if (action === 'edit' || action === 'changeTime') {
      if (isMobile) openPage('route');
      if (action === 'changeTime' && isMobile) setSchedulePanelOpen(true);
    } else if (action === 'switchMode') switchLiveMode(otherLiveMode);
    else if (action === 'manual') setManualRequested(true);
    else if (action === 'oneWay' || action === 'estimate') {
      // Either choice needs only the outbound route, so plan it straight away.
      if (action === 'oneWay') updateSettings({ roundTrip: false });
      else editTime({ returnPolicy: 'estimate' });
      requestPlan(liveMode);
    } else if (action === 'removeStops') {
      if (drivingPreference) updateOption(drivingPreference.id, { waypoints: [] });
      requestPlan('transit');
    } else if (action === 'drive') switchLiveMode('drive');
    else if (isMobile) openPage('costs');
  };
  const arrivalAt =
    selected && departureAt !== undefined
      ? departureAt + selected.breakdown.outbound.totalMinutes * 60000
      : undefined;
  const returnBeforeArrival =
    returnAt !== undefined && arrivalAt !== undefined && returnAt < arrivalAt;
  // Phone layout: the map stays mounted; route, costs and reading pages open over it.
  const pickingActive = mapDestinationPicking || mapStopoverPicking;
  // Each open layer has a history entry, so the system back button closes the top one first.
  const layerDepth = isMobile
    ? pages.length +
      (pickingActive ? 1 : 0) +
      (routeEditing && schedulePanelOpen ? 1 : 0) +
      (routeEditing && searchField ? 1 : 0)
    : 0;
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
    if (page === 'route') {
      routeDraft.current = {
        fingerprint: liveQueryFingerprint,
        origin: state.origin,
        destination: state.destination,
        leaveNow: state.leaveNow,
        departure: state.departure,
        returnTime: state.returnTime,
        returnPolicy: state.returnPolicy,
        departureFold: state.departureFold,
        returnFold: state.returnFold,
        timesNeedReview: state.timesNeedReview,
        roundTrip: state.settings.roundTrip,
        options: state.options,
        googleResponse,
        selectedId: selected?.id ?? selectedId,
        editingMode,
      };
      setSearchField(null);
      setSchedulePanelOpen(false);
      setRoutePanel(null);
    }
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
      returnPolicy: draft.returnPolicy,
      departureFold: draft.departureFold,
      returnFold: draft.returnFold,
      timesNeedReview: draft.timesNeedReview,
      settings: { ...current.settings, roundTrip: draft.roundTrip },
      options: draft.options,
    }));
    setGoogleResponse(draft.googleResponse);
    setSelectedId(draft.selectedId);
    setEditingMode(draft.editingMode);
  };
  /**
   * Closes layers from the top: a map pick, then the time panel, then address search, then
   * pages. Leaving the route page without confirming undoes its edits.
   */
  const closeLayers = (count: number) => {
    let remaining = count;
    if (pickingActive && remaining > 0) {
      cancelMapPick();
      remaining -= 1;
    }
    if (routeEditing && schedulePanelOpen && remaining > 0) {
      setSchedulePanelOpen(false);
      remaining -= 1;
    }
    if (routeEditing && searchField && remaining > 0) {
      setSearchField(null);
      remaining -= 1;
    }
    if (remaining <= 0) return;
    const kept = pages.slice(0, Math.max(0, pages.length - remaining));
    if (pages.slice(kept.length).includes('route')) {
      if (routeDraft.current) restoreRouteDraft(routeDraft.current);
      routeDraft.current = null;
      setStopoverSearchOpen(false);
      setStopoverDraft({ label: '' });
      setSearchField(null);
      setSchedulePanelOpen(false);
    }
    pageFocus.current = pageOpeners.current[kept.length] ?? null;
    pageOpeners.current = pageOpeners.current.slice(0, kept.length);
    setPages(kept);
  };
  const closeLayersAction = useRef(closeLayers);
  closeLayersAction.current = closeLayers;
  const goBack = () => {
    if (historyDepth.current > 0) window.history.back();
    else closeLayers(1);
  };
  const confirmRoute = () => {
    routeDraft.current = null;
    if (historyDepth.current > 0) window.history.go(-(layerDepth - pages.length + 1));
    else {
      setSearchField(null);
      setSchedulePanelOpen(false);
      closeLayers(1);
    }
    // A result cached for the confirmed conditions comes back without a new request.
    if (googleMode) void getGoogleRoutes(liveMode);
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
      timesBlocked ||
      addressResolving > 0);
  // Times later than today carry their date so a summary never reads as today by mistake.
  const shortWhen = (instant: number) =>
    aucklandDay.format(instant) === aucklandDay.format(currentMinute * 60000)
      ? aucklandClock.format(instant)
      : `${new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-NZ', {
          timeZone: AUCKLAND_TIME_ZONE,
          month: 'short',
          day: 'numeric',
        }).format(instant)} ${aucklandClock.format(instant)}`;
  const tripSummary = () => {
    const leaving =
      state.leaveNow || departureAt === undefined ? undefined : shortWhen(departureAt);
    if (!state.settings.roundTrip)
      return leaving ? t('tripAtOneWay', { time: leaving }) : t('tripNowOneWay');
    if (googleMode && state.returnPolicy === 'scheduled' && returnAt !== undefined) {
      const back = shortWhen(returnAt);
      return leaving
        ? t('tripAtReturnAt', { time: leaving, return: back })
        : t('tripNowReturnAt', { time: back });
    }
    if (googleMode) return leaving ? t('tripAtEstimate', { time: leaving }) : t('tripNowEstimate');
    return `${leaving ?? t('leaveNow')} · ${tripScope}`;
  };

  const sheetSources = new Set(sheetCards.map(resultSource));
  const sharedSheetSource = sheetSources.size === 1 ? [...sheetSources][0] : '';

  // Before there is anything to compare, the sheet is a short status with nothing to expand.
  const sheetExpandable = Boolean(comparison.result);
  const sheetNotices =
    !online ||
    comparison.incompleteOptions.length > 0 ||
    comparison.staleFareOptions.length > 0 ||
    comparison.pendingFareOptions.length > 0 ||
    returnBeforeArrival ||
    locationError ||
    Boolean(props.googleApiKey && !googleMode);
  const applyPlace = (field: 'origin' | 'destination', place: Location) => {
    setState((current) => ({ ...current, [field]: place }));
    setSearchField(null);
    if (historyDepth.current > 0) window.history.back();
  };
  const pageTitles: Record<MobilePage, MessageKey> = {
    route: 'mobileEditRoute',
    costs: 'adjustCosts',
    comparison: 'comparison',
    breakdown: 'breakdown',
    settings: 'settings',
    about: 'about',
  };
  const tabs: { key: Screen; label: MessageKey }[] = [
    { key: 'planner', label: 'planner' },
    { key: 'comparison', label: 'comparison' },
    { key: 'breakdown', label: 'breakdown' },
    { key: 'settings', label: 'settings' },
    { key: 'about', label: 'about' },
  ];
  return {
    props,
    switchLiveMode,
    plannerId,
    state,
    setState,
    locale,
    setLocale,
    theme,
    setTheme,
    screen,
    setScreen,
    isMobile,
    pages,
    sheetOpen,
    setSheetOpen,
    weatherOpen,
    setWeatherOpen,
    searchField,
    setSearchField,
    schedulePanelOpen,
    setSchedulePanelOpen,
    routePanel,
    setRoutePanel,
    mobileTopRef,
    routeEditing,
    editingMode,
    setEditingMode,
    selectedId,
    setSelectedId,
    notice,
    setNotice,
    locationLoading,
    locationError,
    waypointDraft,
    setWaypointDraft,
    stopoverSearchOpen,
    setStopoverSearchOpen,
    stopoverDraft,
    setStopoverDraft,
    mapStopoverPicking,
    mapDestinationPicking,
    addressResolving,
    summaryInView,
    summaryRef,
    resultsRef,
    showAllRoutes,
    setShowAllRoutes,
    sortBy,
    setSortBy,
    setManualRequested,
    googleStatus,
    googleRequests,
    googleError,
    googleResponse,
    addressSearchEnabled,
    addressSearchPending,
    online,
    setATFareContexts,
    currentMinute,
    browserTimeZone,
    googleMapRef,
    originSearchRef,
    destinationSearchRef,
    stopoverSearchRef,
    googleMode,
    visibleOptions,
    drivingPreference,
    drivingStops,
    stopoverRoutingBlocked,
    departureEntry,
    returnEntry,
    departureInvalid,
    showReturnTime,
    departureAt,
    returnAt,
    timesNeedReview,
    liveMode,
    routeLoading,
    planDisabled,
    t,
    money,
    moneyWithRange,
    generalizedRange,
    nameOf,
    comparison,
    noComparableRoutesKey,
    selected,
    hasFareRanges,
    cardResults,
    fareExplanationKey,
    rankingLabel,
    estimatedReturn,
    tripScope,
    wholeMinutes,
    aucklandClock,
    distanceText,
    placeLabel,
    originMissing,
    destinationMissing,
    timeError,
    weather,
    destinationPlaceId,
    destinationHours,
    clockSpan,
    valueUpdates,
    updateSettings,
    updateOption,
    updateDrivingCosts,
    updateLeg,
    updateLiveTransitFare,
    selectResult,
    savePlace,
    useLocation,
    addDrivingRoute,
    addWaypoint,
    appendDrivingStop,
    moveDrivingStop,
    cancelMapStopoverPick,
    cancelMapDestinationPick,
    beginMapDestinationPick,
    beginMapStopoverPick,
    saveRoute,
    getGoogleRoutes,
    shortPlace,
    reconnectGoogle,
    includedDirections,
    firstLegIndex,
    driveDistanceLabel,
    transitFareLabel,
    swapPlaces,
    editTime,
    returnFieldError,
    legIcon,
    resultSource,
    describeCard,
    showResults,
    routeStatusView,
    statusActionLabel,
    runStatusAction,
    arrivalAt,
    returnBeforeArrival,
    pickingActive,
    pageStackRef,
    sheetBodyId,
    sheetDrag,
    sheetDragged,
    openScreen,
    openPage,
    goBack,
    confirmRoute,
    cardLabel,
    sheetCards,
    hasDestination,
    routeConfirmBlocked,
    tripSummary,
    sharedSheetSource,
    sheetExpandable,
    sheetNotices,
    applyPlace,
    pageTitles,
    tabs,
  };
}

export type PlannerModel = ReturnType<typeof usePlannerModel>;
