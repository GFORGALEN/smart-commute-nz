import { describe, expect, it } from 'vitest';
import { fuelDetourValue } from './fuel-detour';

const base = {
  litres: 40,
  nearbyPrice: 3.1,
  cheaperPrice: 2.85,
  extraKm: 10,
  consumptionPer100Km: 8.2,
  runningCostPerKm: 0.08,
};

describe('fuel detour value', () => {
  it('weighs the price gap on the fill against the fuel and wear of the extra drive', () => {
    const result = fuelDetourValue(base);
    expect(result.fuelSaving).toBeCloseTo(10, 6); // 40 L × 25c
    expect(result.detourLitres).toBeCloseTo(0.82, 6);
    expect(result.detourFuelCost).toBeCloseTo(2.337, 6); // bought at the cheaper price
    expect(result.runningCost).toBeCloseTo(0.8, 6);
    expect(result.net).toBeCloseTo(6.863, 6);
    expect(result.worthIt).toBe(true);
    expect(result.breakEvenLitres).toBeCloseTo(12.548, 3);
    expect(result.maxExtraKm).toBeCloseTo(31.88, 2);
  });

  it('shows when a small fill or a long drive makes the cheaper station cost more', () => {
    const small = fuelDetourValue({ ...base, litres: 10 });
    expect(small.net).toBeCloseTo(-0.637, 3);
    expect(small.worthIt).toBe(false);
    const far = fuelDetourValue({ ...base, extraKm: 40 });
    expect(far.worthIt).toBe(false);
  });

  it('counts time only when it has a value', () => {
    expect(fuelDetourValue({ ...base, extraMinutes: 20 }).timeCost).toBe(0);
    const timed = fuelDetourValue({ ...base, extraMinutes: 20, valueOfTimePerHour: 15 });
    expect(timed.timeCost).toBeCloseTo(5, 6);
    expect(timed.net).toBeCloseTo(1.863, 6);
  });

  it('never calls a station that is not cheaper worth the drive', () => {
    const same = fuelDetourValue({ ...base, cheaperPrice: 3.1 });
    expect(same.worthIt).toBe(false);
    expect(same.breakEvenLitres).toBeUndefined();
    expect(same.maxExtraKm).toBe(0);
  });

  it('rejects negative or missing inputs', () => {
    expect(() => fuelDetourValue({ ...base, extraKm: -1 })).toThrow(RangeError);
    expect(() => fuelDetourValue({ ...base, litres: Number.NaN })).toThrow(RangeError);
  });
});
