import { describe, expect, it } from 'vitest';
import {
  NZ_FUEL_PRICES,
  fuelPriceAgeDays,
  fuelPriceFor,
  type FuelPriceSnapshot,
} from './fuel-prices';

const snapshot: FuelPriceSnapshot = {
  ...NZ_FUEL_PRICES,
  weekEnding: '2026-10-09',
  prices: {
    regular: { retail: 3.51, board: 3.54 },
    premium: { retail: 3.66, board: 3.74 },
    diesel: { retail: 3.21, board: 3.24 },
  },
};

describe('MBIE weekly fuel prices', () => {
  it('holds a dated, plausible price per litre for each fuel', () => {
    expect(NZ_FUEL_PRICES.weekEnding).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(NZ_FUEL_PRICES.license).toBe('CC BY 4.0');
    for (const fuel of Object.values(NZ_FUEL_PRICES.prices)) {
      expect(fuel.retail).toBeGreaterThan(1);
      expect(fuel.retail).toBeLessThan(10);
      expect(fuel.retail).toBeLessThanOrEqual(fuel.board);
    }
  });

  it('prices petrol, hybrid and diesel cars at what they burn, and electric cars not at all', () => {
    expect(fuelPriceFor('petrol', snapshot)).toBe(3.51);
    expect(fuelPriceFor(undefined, snapshot)).toBe(3.51);
    expect(fuelPriceFor('hybrid', snapshot)).toBe(3.51);
    expect(fuelPriceFor('plug-in-hybrid', snapshot)).toBe(3.51);
    expect(fuelPriceFor('diesel', snapshot)).toBe(3.21);
    expect(fuelPriceFor('electric', snapshot)).toBeUndefined();
  });

  it('counts days from the Friday the week ends, in Auckland', () => {
    expect(fuelPriceAgeDays(new Date('2026-10-09T12:00:00+13:00'), snapshot)).toBe(0);
    expect(fuelPriceAgeDays(new Date('2026-10-31T12:00:00+13:00'), snapshot)).toBe(22);
  });
});
