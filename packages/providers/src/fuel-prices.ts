import type { VehicleKind } from '@smart-commute/core';
import data from './data/nz-fuel-prices.json';

/** MBIE's national weekly fuel prices, refreshed by the fuel-prices workflow (CC BY 4.0). */
export interface FuelPriceSnapshot {
  source: string;
  url: string;
  license: string;
  /** The Friday the week's prices describe, `YYYY-MM-DD`. */
  weekEnding: string;
  /** MBIE marks the latest weeks Provisional until it finalises them. */
  status: string;
  unit: 'NZD per litre';
  prices: Record<'regular' | 'premium' | 'diesel', { retail: number; board: number }>;
}

export const NZ_FUEL_PRICES = data as FuelPriceSnapshot;

/** Whole days since the week the prices describe. */
export function fuelPriceAgeDays(now = new Date(), snapshot = NZ_FUEL_PRICES): number {
  return Math.floor(
    (now.getTime() - Date.parse(`${snapshot.weekEnding}T00:00:00+13:00`)) / 86400000,
  );
}

/**
 * The average price paid for the fuel a vehicle uses: MBIE's adjusted retail price, after the
 * usual discounts. Electric cars buy no fuel; plug-in hybrids are priced on their petrol share.
 */
export function fuelPriceFor(
  kind: VehicleKind | undefined,
  snapshot = NZ_FUEL_PRICES,
): number | undefined {
  if (kind === 'electric') return undefined;
  return kind === 'diesel' ? snapshot.prices.diesel.retail : snapshot.prices.regular.retail;
}
