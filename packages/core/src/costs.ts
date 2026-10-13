import type {
  CommuteSettings,
  CostRange,
  JourneyOption,
  LegTotals,
  Location,
  RouteComparison,
  RouteResult,
  TravelLeg,
  VehicleKind,
  WarningCode,
} from './types';

export const DEFAULT_SETTINGS: Readonly<CommuteSettings> = Object.freeze({
  fuelPrice: 3.5,
  fuelConsumption: 8.2,
  valueOfTime: 15,
  daysPerWeek: 5,
  weeksPerMonth: 4.33,
  roundTrip: true,
  /**
   * Wear, tyres and servicing per km. IRD 2025-26 Tier 2 petrol running cost (NZ$0.37/km,
   * verified 2026-10-11) minus the example fuel cost (8.2 L/100 km at NZ$3.50/L ≈ NZ$0.29/km).
   */
  maintenancePerKm: 0.08,
  /** Typical petrol idle and creep consumption in stop-go traffic; editable per vehicle. */
  congestionFuelPerHour: 0.8,
  vehicleKind: 'petrol',
  rucPer1000Km: 0,
  electricityConsumption: 17,
  /** MBIE QSDEP, Auckland Central retail price on 15 August 2026 (checked 13 Oct 2026). */
  electricityPrice: 0.41,
  electricShare: 0.5,
});

/**
 * Starting values when someone picks a vehicle type; every one stays editable.
 * RUC: NZTA light vehicles up to 3,500 kg, NZ$76 per 1,000 km, and plug-in petrol hybrids
 * NZ$38 (type 12), GST inclusive (checked 13 Oct 2026). Petrol and diesel prices: MBIE weekly
 * board prices for the week ending 2 October 2026 (regular NZ$3.47, diesel NZ$3.20 per litre).
 * Consumption figures are typical examples, not measurements of a particular car.
 */
export const VEHICLE_PRESETS: Readonly<Record<VehicleKind, Readonly<Partial<CommuteSettings>>>> =
  Object.freeze({
    petrol: { fuelPrice: 3.5, fuelConsumption: 8.2, congestionFuelPerHour: 0.8, rucPer1000Km: 0 },
    diesel: { fuelPrice: 3.2, fuelConsumption: 7, congestionFuelPerHour: 0.8, rucPer1000Km: 76 },
    hybrid: { fuelPrice: 3.5, fuelConsumption: 4.5, congestionFuelPerHour: 0.3, rucPer1000Km: 0 },
    'plug-in-hybrid': {
      fuelPrice: 3.5,
      fuelConsumption: 6,
      congestionFuelPerHour: 0.3,
      rucPer1000Km: 38,
      electricityConsumption: 18,
      electricShare: 0.5,
    },
    electric: { congestionFuelPerHour: 0, rucPer1000Km: 76, electricityConsumption: 17 },
  });

const vehicleKinds = new Set<VehicleKind>([
  'petrol',
  'diesel',
  'hybrid',
  'plug-in-hybrid',
  'electric',
]);

/** How much of the driven distance runs on fuel and how much on the battery. */
export function energyShares(settings: CommuteSettings): { fuel: number; electric: number } {
  const kind = settings.vehicleKind ?? 'petrol';
  if (kind === 'electric') return { fuel: 0, electric: 1 };
  if (kind === 'plug-in-hybrid') {
    const electric = settings.electricShare ?? DEFAULT_SETTINGS.electricShare!;
    return { fuel: 1 - electric, electric };
  }
  return { fuel: 1, electric: 0 };
}

const travelModes = new Set(['drive', 'bus', 'train', 'walk', 'wait', 'parking']);
const journeyModes = new Set(['drive', 'transit', 'hybrid']);
const sources = new Set(['manual', 'google', 'at-rule']);

function nonNegative(value: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`);
  }
  if (value < 0) throw new RangeError(`${field} must not be negative.`);
}

function nonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
}

function validateCostRange(range: CostRange, field: string): void {
  if (!range || typeof range !== 'object') throw new TypeError(`${field} must be a cost range.`);
  nonNegative(range.min, `${field}.min`);
  nonNegative(range.max, `${field}.max`);
  if (range.min > range.max) throw new RangeError(`${field}.min must not exceed max.`);
}

function validateLocation(location: Location, field: string): void {
  if (!location || typeof location !== 'object') {
    throw new TypeError(`${field} must be a location.`);
  }
  nonEmpty(location.label, `${field}.label`);
  if (location.coordinates !== undefined) {
    const { lat, lng } = location.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new TypeError(`${field}.coordinates must contain finite numbers.`);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new RangeError(`${field}.coordinates are outside latitude/longitude bounds.`);
    }
  }
}

function validateLeg(leg: TravelLeg, field: string): void {
  if (!leg || typeof leg !== 'object') throw new TypeError(`${field} must be a travel leg.`);
  if (!travelModes.has(leg.mode)) throw new TypeError(`${field}.mode is not supported.`);
  if (!sources.has(leg.source)) throw new TypeError(`${field}.source is not supported.`);
  if (
    leg.fareSource !== undefined &&
    !sources.has(leg.fareSource) &&
    leg.fareSource !== 'at-estimate'
  ) {
    throw new TypeError(`${field}.fareSource is not supported.`);
  }
  if (typeof leg.estimated !== 'boolean') {
    throw new TypeError(`${field}.estimated must be a boolean.`);
  }
  if (leg.farePending !== undefined && typeof leg.farePending !== 'boolean') {
    throw new TypeError(`${field}.farePending must be a boolean.`);
  }
  nonNegative(leg.durationMinutes, `${field}.durationMinutes`);
  for (const key of [
    'distanceKm',
    'fuelConsumption',
    'fare',
    'toll',
    'transfers',
    'congestionMinutes',
  ] as const) {
    const value = leg[key];
    if (value !== undefined) nonNegative(value, `${field}.${key}`);
  }
  if (leg.transfers !== undefined && !Number.isInteger(leg.transfers)) {
    throw new RangeError(`${field}.transfers must be a whole number.`);
  }
  if (leg.mode === 'drive' && leg.distanceKm === undefined) {
    throw new TypeError(`${field}.distanceKm is required for driving.`);
  }
  if (leg.fareRange !== undefined) {
    validateCostRange(leg.fareRange, `${field}.fareRange`);
    if (leg.fareRange.source !== 'at-estimate') {
      throw new TypeError(`${field}.fareRange.source is not supported.`);
    }
    if (
      leg.fareRange.basis !== undefined &&
      !['standard-adult', 'citylink'].includes(leg.fareRange.basis)
    ) {
      throw new TypeError(`${field}.fareRange.basis is not supported.`);
    }
    if (leg.fareRange.assumptions !== undefined) {
      if (!Array.isArray(leg.fareRange.assumptions)) {
        throw new TypeError(`${field}.fareRange.assumptions must be an array.`);
      }
      leg.fareRange.assumptions.forEach((assumption, index) =>
        nonEmpty(assumption, `${field}.fareRange.assumptions[${index}]`),
      );
    }
  }
  if (leg.transit?.stopCount !== undefined) {
    nonNegative(leg.transit.stopCount, `${field}.transit.stopCount`);
    if (!Number.isInteger(leg.transit.stopCount)) {
      throw new RangeError(`${field}.transit.stopCount must be a whole number.`);
    }
  }
}

function validateSettings(settings: CommuteSettings): void {
  if (!settings || typeof settings !== 'object') throw new TypeError('Settings are required.');
  for (const key of [
    'fuelPrice',
    'fuelConsumption',
    'valueOfTime',
    'daysPerWeek',
    'weeksPerMonth',
    'maintenancePerKm',
  ] as const) {
    nonNegative(settings[key], `settings.${key}`);
  }
  for (const key of [
    'congestionFuelPerHour',
    'rucPer1000Km',
    'electricityConsumption',
    'electricityPrice',
    'electricShare',
  ] as const) {
    const value = settings[key];
    if (value !== undefined) nonNegative(value, `settings.${key}`);
  }
  if (settings.electricShare !== undefined && settings.electricShare > 1)
    throw new RangeError('settings.electricShare must be at most one.');
  if (settings.vehicleKind !== undefined && !vehicleKinds.has(settings.vehicleKind))
    throw new TypeError('settings.vehicleKind is not supported.');
  if (settings.daysPerWeek > 7) throw new RangeError('settings.daysPerWeek must be at most seven.');
  if (typeof settings.roundTrip !== 'boolean') {
    throw new TypeError('settings.roundTrip must be a boolean.');
  }
}

function validateOption(option: JourneyOption): void {
  if (!option || typeof option !== 'object') throw new TypeError('A journey option is required.');
  nonEmpty(option.id, 'option.id');
  nonEmpty(option.name, 'option.name');
  if (!journeyModes.has(option.mode)) throw new TypeError('option.mode is not supported.');
  nonNegative(option.parkingCost, 'option.parkingCost');
  if (option.parkingVerified !== undefined && typeof option.parkingVerified !== 'boolean') {
    throw new TypeError('option.parkingVerified must be a boolean.');
  }
  if (
    option.returnBasis !== undefined &&
    option.returnBasis !== 'routed' &&
    option.returnBasis !== 'estimated-from-outbound'
  ) {
    throw new TypeError('option.returnBasis is not supported.');
  }
  for (const direction of ['outbound', 'inbound'] as const) {
    if (!Array.isArray(option[direction])) {
      throw new TypeError(`option.${direction} must be an array of travel legs.`);
    }
    option[direction].forEach((leg, index) => validateLeg(leg, `option.${direction}[${index}]`));
  }
  if (option.outbound.length === 0) throw new RangeError('An outbound journey must contain a leg.');
  if (!Array.isArray(option.waypoints)) throw new TypeError('option.waypoints must be an array.');
  option.waypoints.forEach((location, index) =>
    validateLocation(location, `option.waypoints[${index}]`),
  );
}

/** Fuel cost in NZD. Values retain precision until the presentation layer formats them. */
export function calculateFuelCost(
  distanceKm: number,
  consumptionPer100Km: number,
  fuelPrice: number,
): number {
  nonNegative(distanceKm, 'distanceKm');
  nonNegative(consumptionPer100Km, 'consumptionPer100Km');
  nonNegative(fuelPrice, 'fuelPrice');
  const result = (distanceKm / 100) * consumptionPer100Km * fuelPrice;
  nonNegative(result, 'calculated fuel cost');
  return result;
}

function zeroTotals(): LegTotals {
  return {
    fuelCost: 0,
    rucCost: 0,
    congestionFuelCost: 0,
    congestionMinutes: 0,
    fareCost: 0,
    tollCost: 0,
    maintenanceCost: 0,
    totalMinutes: 0,
    distanceKm: 0,
    transfers: 0,
    totalCost: 0,
  };
}

function calculateLegs(legs: TravelLeg[], settings: CommuteSettings): LegTotals {
  const result = zeroTotals();
  let minimumFareCost = 0;
  let hasFareRange = false;
  const shares = energyShares(settings);
  const electricityPerKm =
    ((settings.electricityConsumption ?? DEFAULT_SETTINGS.electricityConsumption!) / 100) *
    (settings.electricityPrice ?? DEFAULT_SETTINGS.electricityPrice!);
  for (const leg of legs) {
    if (
      leg.source === 'google' &&
      (leg.mode === 'bus' || leg.mode === 'train') &&
      leg.fare === undefined &&
      leg.fareRange === undefined &&
      !leg.farePending
    ) {
      throw new TypeError(
        'Google transit legs require a fare or fare range; missing fare is not free travel.',
      );
    }
    const distanceKm = leg.distanceKm ?? 0;
    if (leg.mode === 'drive') {
      result.fuelCost +=
        calculateFuelCost(
          distanceKm,
          leg.fuelConsumption ?? settings.fuelConsumption,
          settings.fuelPrice,
        ) *
          shares.fuel +
        distanceKm * electricityPerKm * shares.electric;
      result.rucCost += (distanceKm / 1000) * (settings.rucPer1000Km ?? 0);
      result.maintenanceCost += distanceKm * settings.maintenancePerKm;
      // Delay in traffic burns fuel beyond the distance-based estimate; a battery barely idles.
      const delay = leg.congestionMinutes ?? 0;
      result.congestionMinutes += delay;
      result.congestionFuelCost +=
        (delay / 60) * (settings.congestionFuelPerHour ?? 0) * settings.fuelPrice * shares.fuel;
    }
    result.fareCost += leg.fare ?? leg.fareRange?.max ?? 0;
    minimumFareCost += leg.fare ?? leg.fareRange?.min ?? 0;
    if (leg.fare === undefined && leg.fareRange !== undefined) hasFareRange = true;
    result.tollCost += leg.toll ?? 0;
    result.totalMinutes += leg.durationMinutes;
    result.distanceKm += distanceKm;
    result.transfers += leg.transfers ?? 0;
  }
  result.totalCost =
    result.fuelCost +
    result.rucCost +
    result.congestionFuelCost +
    result.fareCost +
    result.tollCost +
    result.maintenanceCost;
  if (hasFareRange) {
    result.fareCostRange = { min: minimumFareCost, max: result.fareCost };
    result.totalCostRange = {
      min:
        result.fuelCost +
        result.rucCost +
        result.congestionFuelCost +
        minimumFareCost +
        result.tollCost +
        result.maintenanceCost,
      max: result.totalCost,
    };
    validateCostRange(result.fareCostRange, 'calculated fareCostRange');
    validateCostRange(result.totalCostRange, 'calculated totalCostRange');
  }
  for (const key of [
    'fuelCost',
    'rucCost',
    'congestionFuelCost',
    'congestionMinutes',
    'fareCost',
    'tollCost',
    'maintenanceCost',
    'totalMinutes',
    'distanceKm',
    'transfers',
    'totalCost',
  ] as const)
    nonNegative(result[key], `calculated ${key}`);
  return result;
}

/**
 * Calculate each direction independently. No return route is invented when it is missing.
 * Parking is a commute-level charge, so it is never multiplied by the number of directions.
 */
export function calculateOption(option: JourneyOption, settings: CommuteSettings): RouteResult {
  validateSettings(settings);
  validateOption(option);
  const outbound = calculateLegs(option.outbound, settings);
  const inbound = settings.roundTrip ? calculateLegs(option.inbound, settings) : zeroTotals();
  const fuelCost = outbound.fuelCost + inbound.fuelCost;
  const rucCost = outbound.rucCost + inbound.rucCost;
  const congestionFuelCost = outbound.congestionFuelCost + inbound.congestionFuelCost;
  const congestionMinutes = outbound.congestionMinutes + inbound.congestionMinutes;
  const fareCost = outbound.fareCost + inbound.fareCost;
  const tollCost = outbound.tollCost + inbound.tollCost;
  const maintenanceCost = outbound.maintenanceCost + inbound.maintenanceCost;
  const totalCost = outbound.totalCost + inbound.totalCost + option.parkingCost;
  const totalMinutes = outbound.totalMinutes + inbound.totalMinutes;
  const distanceKm = outbound.distanceKm + inbound.distanceKm;
  const transfers = outbound.transfers + inbound.transfers;
  const weeklyCost = totalCost * settings.daysPerWeek;
  const monthlyCost = weeklyCost * settings.weeksPerMonth;
  const generalizedCost = totalCost + (totalMinutes / 60) * settings.valueOfTime;
  const warnings: WarningCode[] = [];
  const includedLegs = settings.roundTrip
    ? [...option.outbound, ...option.inbound]
    : option.outbound;
  const distanceComplete = includedLegs.every(
    (leg) => leg.mode === 'wait' || leg.mode === 'parking' || leg.distanceKm !== undefined,
  );
  if (includedLegs.some((leg) => leg.estimated)) warnings.push('estimated-data');
  if (includedLegs.some((leg) => leg.fare === undefined && leg.fareRange !== undefined)) {
    warnings.push('fare-range-estimate');
  }
  if ((option.mode !== 'transit' || option.parkingCost > 0) && option.parkingVerified !== true) {
    warnings.push('unverified-parking');
  }
  if (settings.roundTrip && option.inbound.length === 0) warnings.push('missing-return');
  if (
    includedLegs.some(
      (leg) => leg.farePending && leg.fare === undefined && leg.fareRange === undefined,
    )
  )
    warnings.push('fare-pending');
  const result: RouteResult = {
    id: option.id,
    name: option.name,
    mode: option.mode,
    totalCost,
    fuelCost,
    rucCost,
    congestionFuelCost,
    congestionMinutes,
    fareCost,
    parkingCost: option.parkingCost,
    tollCost,
    maintenanceCost,
    totalMinutes,
    distanceKm,
    distanceComplete,
    transfers,
    dailyCost: totalCost,
    weeklyCost,
    monthlyCost,
    generalizedCost,
    warnings,
    option,
    breakdown: { outbound, inbound },
  };
  if (outbound.fareCostRange !== undefined || inbound.fareCostRange !== undefined) {
    result.fareCostRange = {
      min:
        (outbound.fareCostRange?.min ?? outbound.fareCost) +
        (inbound.fareCostRange?.min ?? inbound.fareCost),
      max: fareCost,
    };
    result.totalCostRange = {
      min:
        (outbound.totalCostRange?.min ?? outbound.totalCost) +
        (inbound.totalCostRange?.min ?? inbound.totalCost) +
        option.parkingCost,
      max: totalCost,
    };
    result.dailyCostRange = { ...result.totalCostRange };
    result.weeklyCostRange = {
      min: result.totalCostRange.min * settings.daysPerWeek,
      max: weeklyCost,
    };
    result.monthlyCostRange = {
      min: result.weeklyCostRange.min * settings.weeksPerMonth,
      max: monthlyCost,
    };
    for (const key of [
      'fareCostRange',
      'totalCostRange',
      'dailyCostRange',
      'weeklyCostRange',
      'monthlyCostRange',
    ] as const) {
      const range = result[key];
      if (range !== undefined) validateCostRange(range, `calculated ${key}`);
    }
  }
  for (const key of [
    'totalCost',
    'fuelCost',
    'rucCost',
    'congestionFuelCost',
    'congestionMinutes',
    'fareCost',
    'parkingCost',
    'tollCost',
    'maintenanceCost',
    'totalMinutes',
    'distanceKm',
    'transfers',
    'dailyCost',
    'weeklyCost',
    'monthlyCost',
    'generalizedCost',
  ] as const)
    nonNegative(result[key], `calculated ${key}`);
  return result;
}

type RankingMetric = 'totalCost' | 'totalMinutes' | 'transfers' | 'generalizedCost' | 'distanceKm';

function rankBy(...metrics: RankingMetric[]): (left: RouteResult, right: RouteResult) => number {
  return (left, right) => {
    for (const metric of metrics) {
      const difference = left[metric] - right[metric];
      if (difference !== 0) return difference;
    }
    // A lexical identifier comparison makes equal values independent of input order and locale.
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };
}

export function compareOptions(
  options: JourneyOption[],
  settings: CommuteSettings,
): RouteComparison {
  if (!Array.isArray(options) || options.length === 0) {
    throw new RangeError('At least one journey option is required for comparison.');
  }
  const ids = new Set<string>();
  const results = options.map((option) => {
    const result = calculateOption(option, settings);
    if (ids.has(result.id))
      throw new RangeError(`Journey option identifier must be unique: ${result.id}`);
    ids.add(result.id);
    return result;
  });
  results.sort(rankBy('totalCost', 'totalMinutes', 'transfers'));
  const cheapest = results[0]!;
  const fastest = [...results].sort(rankBy('totalMinutes', 'totalCost', 'transfers'))[0]!;
  const fewestTransfers = [...results].sort(rankBy('transfers', 'totalCost', 'totalMinutes'))[0]!;
  const bestValue = [...results].sort(
    rankBy('generalizedCost', 'totalCost', 'totalMinutes', 'transfers'),
  )[0]!;
  const byDistance = rankBy('distanceKm', 'totalMinutes', 'totalCost', 'transfers');
  const shortest = [...results].sort(
    (left, right) =>
      Number(right.distanceComplete) - Number(left.distanceComplete) || byDistance(left, right),
  )[0]!;
  return { results, cheapest, fastest, fewestTransfers, bestValue, shortest };
}

/**
 * A budget reference for the way back when no return time was chosen: the outbound legs in
 * reverse. Driving keeps distance, consumption and tolls but not the outbound traffic delay.
 * A transit fare range is kept as a range; an exact outbound fare is not assumed to apply to
 * the return, so the return fare stays pending until someone confirms it.
 */
export function estimateReturnLegs(outbound: TravelLeg[]): TravelLeg[] {
  const transit = (leg: TravelLeg) => leg.mode === 'bus' || leg.mode === 'train';
  const fareRange = outbound.find(transit)?.fareRange;
  const priced = outbound.find(transit);
  const rangeOnly = priced !== undefined && priced.fare === undefined && fareRange !== undefined;
  let boarded = false;
  return [...outbound].reverse().map((leg) => {
    const estimate: TravelLeg = {
      mode: leg.mode,
      durationMinutes: leg.durationMinutes,
      source: leg.source,
      estimated: true,
    };
    if (leg.distanceKm !== undefined) estimate.distanceKm = leg.distanceKm;
    if (leg.fuelConsumption !== undefined) estimate.fuelConsumption = leg.fuelConsumption;
    if (leg.toll !== undefined) estimate.toll = leg.toll;
    if (leg.transfers !== undefined) estimate.transfers = leg.transfers;
    if (leg.transit)
      estimate.transit = {
        ...leg.transit,
        departureStop: leg.transit.arrivalStop,
        arrivalStop: leg.transit.departureStop,
      };
    if (transit(leg)) {
      // One fare covers the whole direction, so later boardings carry an explicit zero.
      if (boarded) {
        estimate.fare = 0;
        if (rangeOnly) estimate.fareSource = 'at-estimate';
      } else if (rangeOnly) {
        estimate.fareRange = { ...fareRange, assumptions: [...(fareRange.assumptions ?? [])] };
        estimate.fareSource = 'at-estimate';
      } else estimate.farePending = true;
      boarded = true;
    }
    return estimate;
  });
}
