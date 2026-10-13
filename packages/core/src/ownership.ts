import type { RouteResult, VehicleKind } from './types';

/** What owning a car costs whether or not it is driven. Running costs are per km elsewhere. */
export interface OwnershipCosts {
  purchasePrice: number;
  /** Expected sale price when the car is sold; the difference is depreciation. */
  resaleValue: number;
  yearsOwned: number;
  insurancePerYear: number;
  /** Annual vehicle licence (rego), including the ACC levy. */
  licencePerYear: number;
  wofPerYear: number;
  /** Share of these fixed costs that belongs to commuting, 0 to 1; the rest is other driving. */
  commuteShare: number;
}

/**
 * NZTA 12-month private passenger licence, online, GST inclusive, for licences starting after
 * 1 July 2026 (checked 13 Oct 2026). Hybrids and plug-in petrol hybrids pay petrol fees.
 */
export const LICENCE_FEE_BY_VEHICLE: Readonly<Record<VehicleKind, number>> = Object.freeze({
  petrol: 181.45,
  hybrid: 181.45,
  'plug-in-hybrid': 181.45,
  diesel: 248.83,
  electric: 248.83,
});

/** Example values for a used car; price, resale, insurance and WoF are not market quotes. */
export const DEFAULT_OWNERSHIP: Readonly<OwnershipCosts> = Object.freeze({
  purchasePrice: 12000,
  resaleValue: 6000,
  yearsOwned: 3,
  insurancePerYear: 600,
  licencePerYear: LICENCE_FEE_BY_VEHICLE.petrol,
  wofPerYear: 70,
  commuteShare: 1,
});

/**
 * AT HOP adult 7-day cap on bus and train fares. Contactless cards have a daily cap instead,
 * and concessions differ, so callers apply it only when the person chooses it.
 */
export const AT_HOP_WEEKLY_CAP = 50;

function check(value: number, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`${field} must be a finite number.`);
  if (value < 0) throw new RangeError(`${field} must not be negative.`);
}

export function validateOwnership(costs: OwnershipCosts): void {
  if (!costs || typeof costs !== 'object') throw new TypeError('Ownership costs are required.');
  for (const key of [
    'purchasePrice',
    'resaleValue',
    'yearsOwned',
    'insurancePerYear',
    'licencePerYear',
    'wofPerYear',
    'commuteShare',
  ] as const)
    check(costs[key], `ownership.${key}`);
  if (costs.yearsOwned === 0) throw new RangeError('ownership.yearsOwned must be above zero.');
  if (costs.commuteShare > 1) throw new RangeError('ownership.commuteShare must be at most one.');
}

export interface MonthlyOwnership {
  depreciation: number;
  insurance: number;
  licence: number;
  wof: number;
  /** Commute share of the fixed costs per month. */
  total: number;
}

/** Fixed costs per month, already reduced to the commute's share. */
export function monthlyOwnershipCost(costs: OwnershipCosts): MonthlyOwnership {
  validateOwnership(costs);
  const share = costs.commuteShare / 12;
  const depreciation =
    (Math.max(0, costs.purchasePrice - costs.resaleValue) / costs.yearsOwned) * share;
  const insurance = costs.insurancePerYear * share;
  const licence = costs.licencePerYear * share;
  const wof = costs.wofPerYear * share;
  return { depreciation, insurance, licence, wof, total: depreciation + insurance + licence + wof };
}

export interface CarPurchaseRow {
  daysPerWeek: number;
  /** Fixed costs plus the cheapest option that needs the car. */
  withCar: number;
  /** The cheapest public transport option, capped weekly when a cap applies. */
  withoutCar: number;
}

export interface CarPurchaseAnalysis {
  fixed: MonthlyOwnership;
  carOption: RouteResult;
  transitOption: RouteResult;
  rows: CarPurchaseRow[];
  /** Fewest commute days per week at which owning costs no more; null when it never does. */
  breakEvenDays: number | null;
  /** True when the weekly fare cap is what keeps the car from paying off. */
  capPreventsPayoff: boolean;
}

/**
 * Monthly cost with and without buying a car, for one to seven commute days a week. Uses each
 * option's upper cost, as rankings do. Returns null without both a car option and transit.
 */
export function analyseCarPurchase(
  results: RouteResult[],
  ownership: OwnershipCosts,
  weeksPerMonth: number,
  weeklyFareCap?: number,
): CarPurchaseAnalysis | null {
  check(weeksPerMonth, 'weeksPerMonth');
  if (weeklyFareCap !== undefined) check(weeklyFareCap, 'weeklyFareCap');
  const cheapest = (mode: (result: RouteResult) => boolean) =>
    results.filter(mode).sort((left, right) => left.totalCost - right.totalCost)[0];
  const carOption = cheapest((result) => result.mode === 'drive' || result.mode === 'hybrid');
  const transitOption = cheapest((result) => result.mode === 'transit');
  if (!carOption || !transitOption) return null;
  const fixed = monthlyOwnershipCost(ownership);
  const monthlyFares = (days: number) =>
    Math.min(transitOption.totalCost * days, weeklyFareCap ?? Infinity) * weeksPerMonth;
  const rows = [1, 2, 3, 4, 5, 6, 7].map((daysPerWeek) => ({
    daysPerWeek,
    withCar: fixed.total + carOption.totalCost * daysPerWeek * weeksPerMonth,
    withoutCar: monthlyFares(daysPerWeek),
  }));
  const breakEvenDays = rows.find((row) => row.withCar <= row.withoutCar)?.daysPerWeek ?? null;
  const uncappedPayoff = [1, 2, 3, 4, 5, 6, 7].some(
    (days) =>
      fixed.total + carOption.totalCost * days * weeksPerMonth <=
      transitOption.totalCost * days * weeksPerMonth,
  );
  return {
    fixed,
    carOption,
    transitOption,
    rows,
    breakEvenDays,
    capPreventsPayoff: breakEvenDays === null && weeklyFareCap !== undefined && uncappedPayoff,
  };
}
