import {
  AUCKLAND_TIME_ZONE,
  DEFAULT_OWNERSHIP,
  DEFAULT_SETTINGS,
  EXAMPLE_ORIGIN,
  VEHICLE_PRESETS,
  type VehicleKind,
  type OwnershipCosts,
  compareOptions,
  createExampleOptions,
  resolveZonedTime,
  validateOwnership,
} from '@smart-commute/core';
import { fuelPriceFor } from '@smart-commute/providers';
import { MOBILE_QUERY, STORAGE_KEY, TIMES_VERSION } from './constants';
import { hasGoogleProvenance, toLocation } from './helpers';
import { type LiveMode, type PlannerState, type SmartCommutePlannerProps } from './types';

/** Times saved before version 2 were browser-local strings with no recorded time zone. */
export const isFutureBrowserTime = (value: string | undefined) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) && time > Date.now();
};
export const zonedInstant = (local: string | undefined, fold?: 'earlier' | 'later') => {
  const resolution = resolveZonedTime(local ?? '', AUCKLAND_TIME_ZONE);
  if (resolution.kind === 'valid') return resolution.instant;
  if (resolution.kind === 'ambiguous') return fold ? resolution[fold] : resolution.earlier;
  return undefined;
};
/** Saved Auckland times expire: traffic-aware driving rejects any departure in the past. */
export const isFutureAucklandTime = (value: string | undefined, fold?: 'earlier' | 'later') => {
  const instant = zonedInstant(value, fold);
  return instant !== undefined && instant > Date.now();
};
export const isFold = (value: unknown): value is 'earlier' | 'later' =>
  value === 'earlier' || value === 'later';
export function savedLiveMode(): LiveMode {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as {
      liveMode?: unknown;
    } | null;
    return saved?.liveMode === 'transit' ? 'transit' : 'drive';
  } catch {
    return 'drive';
  }
}

/**
 * Restores saved times. Version 2 times are Auckland times and expire once past. Older times
 * were read in whatever zone the browser had, which is not recorded, so they are kept only
 * if still in the future and must be confirmed before use; they are never guessed to be
 * Auckland times.
 */
export function restoreTimes(
  saved: Partial<PlannerState> & { timesVersion?: number },
): Pick<
  PlannerState,
  'leaveNow' | 'departure' | 'returnTime' | 'returnPolicy' | 'departureFold' | 'returnFold'
> & { timesNeedReview?: boolean } {
  const current = saved.timesVersion === TIMES_VERSION;
  const future = (value: string | undefined, fold?: 'earlier' | 'later') =>
    current ? isFutureAucklandTime(value, fold) : isFutureBrowserTime(value);
  const departureFold = current && isFold(saved.departureFold) ? saved.departureFold : undefined;
  const returnFold = current && isFold(saved.returnFold) ? saved.returnFold : undefined;
  const keepDeparture = saved.leaveNow === false && future(saved.departure, departureFold);
  const keepReturn = future(saved.returnTime, returnFold);
  const policy =
    current && (saved.returnPolicy === 'scheduled' || saved.returnPolicy === 'estimate')
      ? saved.returnPolicy
      : keepReturn
        ? 'scheduled'
        : 'estimate';
  return {
    leaveNow: !keepDeparture,
    departure: keepDeparture ? saved.departure! : '',
    returnTime: keepReturn ? saved.returnTime! : '',
    returnPolicy: policy === 'scheduled' && !keepReturn ? 'estimate' : policy,
    ...(departureFold && keepDeparture ? { departureFold } : {}),
    ...(returnFold && keepReturn ? { returnFold } : {}),
    ...(!current && (keepDeparture || keepReturn)
      ? { timesNeedReview: true }
      : current && saved.timesNeedReview && (keepDeparture || keepReturn)
        ? { timesNeedReview: true }
        : {}),
  };
}

/** Ownership costs saved before this comparison existed, or saved invalid, start from the examples. */
function restoreOwnership(saved: unknown): OwnershipCosts {
  try {
    const ownership = { ...DEFAULT_OWNERSHIP, ...(saved as Partial<OwnershipCosts>) };
    validateOwnership(ownership);
    return ownership;
  } catch {
    return { ...DEFAULT_OWNERSHIP };
  }
}

/** The weekly average for the car's fuel, used on the live site until a price is typed. */
const averageFuelPrice = (props: SmartCommutePlannerProps, kind: VehicleKind | undefined) =>
  props.googleApiKey && props.fuelPrice === undefined ? fuelPriceFor(kind) : undefined;

export function initialState(props: SmartCommutePlannerProps): PlannerState {
  // A new live trip on a phone starts one way and now; offline examples keep their round trip.
  const phone = typeof window !== 'undefined' && Boolean(window.matchMedia?.(MOBILE_QUERY).matches);
  const fallback: PlannerState = {
    origin: toLocation(props.origin ?? (props.googleApiKey ? '' : EXAMPLE_ORIGIN)),
    destination: toLocation(props.destination),
    settings: {
      ...DEFAULT_SETTINGS,
      roundTrip: phone && props.googleApiKey ? false : DEFAULT_SETTINGS.roundTrip,
      fuelPrice:
        props.fuelPrice ??
        averageFuelPrice(props, DEFAULT_SETTINGS.vehicleKind) ??
        DEFAULT_SETTINGS.fuelPrice,
      fuelConsumption: props.fuelConsumption ?? DEFAULT_SETTINGS.fuelConsumption,
    },
    options: createExampleOptions(),
    places: [],
    savedRoutes: [],
    departure: '',
    returnTime: '',
    leaveNow: true,
    returnPolicy: 'estimate',
    ownership: { ...DEFAULT_OWNERSHIP },
    applyFareCap: true,
    fuelPriceChosen: false,
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const saved = parsed as Partial<PlannerState> & { timesVersion?: number };
    if (!saved.settings || !Array.isArray(saved.options) || !saved.origin || !saved.destination)
      return fallback;
    saved.options = saved.options.filter((option) => !hasGoogleProvenance(option));
    if (!saved.options.length) saved.options = createExampleOptions();
    compareOptions(saved.options, saved.settings);
    if (typeof saved.origin.label !== 'string' || typeof saved.destination.label !== 'string')
      return fallback;
    // Settings saved before this flag count a price away from the vehicle preset as chosen.
    const kind = saved.settings.vehicleKind;
    const fuelPriceChosen =
      typeof saved.fuelPriceChosen === 'boolean'
        ? saved.fuelPriceChosen
        : saved.settings.fuelPrice !== VEHICLE_PRESETS[kind ?? 'petrol'].fuelPrice;
    const average = fuelPriceChosen ? undefined : averageFuelPrice(props, kind);
    return {
      ...fallback,
      ...saved,
      // Live planning opens with empty search boxes, like a map app; only the offline
      // calculator brings back the places it was last given.
      origin: props.origin
        ? toLocation(props.origin)
        : props.googleApiKey
          ? { label: '' }
          : saved.origin,
      destination: toLocation(props.destination),
      settings: {
        ...saved.settings,
        // Settings saved before congestion pricing get the default rather than none.
        congestionFuelPerHour:
          saved.settings.congestionFuelPerHour ?? DEFAULT_SETTINGS.congestionFuelPerHour,
        fuelPrice: props.fuelPrice ?? average ?? saved.settings.fuelPrice,
        fuelConsumption: props.fuelConsumption ?? saved.settings.fuelConsumption,
        // Every live trip on a phone opens one way; a return is chosen per trip, not remembered.
        ...(phone && props.googleApiKey ? { roundTrip: false } : {}),
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
      ...restoreTimes(saved),
      ownership: restoreOwnership(saved.ownership),
      applyFareCap: typeof saved.applyFareCap === 'boolean' ? saved.applyFareCap : true,
      priority: saved.priority === 'time' ? 'time' : 'cost',
      fuelPriceChosen,
    };
  } catch {
    return fallback;
  }
}
