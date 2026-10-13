import {
  compareOptions,
  type JourneyOption,
  type RouteComparison,
  type RouteResult,
} from '@smart-commute/core';
import { atFareContext, hasGoogleProvenance, usesATFare } from './helpers';
import { type PlannerState } from './types';

export interface PlannerComparison {
  result: RouteComparison | null;
  error: boolean;
  /** The only problem is a missing place; settings and manual inputs are valid. */
  missingPlaces?: boolean;
  incompleteOptions: JourneyOption[];
  staleFareOptions: JourneyOption[];
  pendingFareOptions: JourneyOption[];
}

export type CardSort = 'cost' | 'time' | 'distance' | 'value';

/**
 * Ranks only the options that can be compared honestly. Options with a missing return, an
 * AT fare verified for other conditions, or an unpriced estimated return are listed apart.
 */
export function buildComparison(
  state: PlannerState,
  visibleOptions: JourneyOption[],
  atFareContexts: Record<string, string>,
  currentMinute: number,
): PlannerComparison {
  const empty = { incompleteOptions: [], staleFareOptions: [], pendingFareOptions: [] };
  try {
    if (!state.origin.label.trim() || !state.destination.label.trim()) {
      // Still check the inputs, so valid preferences can be kept while places are empty.
      compareOptions(
        state.options.filter((option) => !hasGoogleProvenance(option)),
        state.settings,
      );
      return { result: null, error: true, missingPlaces: true, ...empty };
    }
    if (!visibleOptions.length) {
      // Validate settings without presenting offline examples as live routes.
      compareOptions(
        state.options.filter((option) => !hasGoogleProvenance(option)),
        state.settings,
      );
      return { result: null, error: false, ...empty };
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
    // An estimated return without a known fare is not a cheaper option; it is unpriced.
    const pendingFareOptions = all.results
      .filter((result) => result.warnings.includes('fare-pending'))
      .map((result) => result.option);
    if (!incompleteOptions.length && !staleFareOptions.length && !pendingFareOptions.length)
      return { result: all, error: false, incompleteOptions, staleFareOptions, pendingFareOptions };
    const excluded = new Set(
      [...incompleteOptions, ...staleFareOptions, ...pendingFareOptions].map((option) => option.id),
    );
    const completeOptions = all.results
      .filter((result) => !excluded.has(result.id))
      .map((result) => result.option);
    return {
      result: completeOptions.length ? compareOptions(completeOptions, state.settings) : null,
      error: false,
      incompleteOptions,
      staleFareOptions,
      pendingFareOptions,
    };
  } catch {
    return { result: null, error: true, ...empty };
  }
}

/**
 * Core ranks by cost; people can reorder by time, distance or cost plus their time value.
 * Routes missing a leg distance sort after complete ones, as their total is only a floor.
 * Cards that would read the same (same mode, time, distance, price and lines) follow the
 * distinct ones.
 */
export function orderCards(results: RouteResult[], sortBy: CardSort): RouteResult[] {
  const sorted = [...results].sort((left, right) =>
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
  const distinct: RouteResult[] = [];
  const similar: RouteResult[] = [];
  const seen = new Set<string>();
  for (const result of sorted) {
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
    if (seen.has(fingerprint)) similar.push(result);
    else {
      seen.add(fingerprint);
      distinct.push(result);
    }
  }
  return [...distinct, ...similar];
}
