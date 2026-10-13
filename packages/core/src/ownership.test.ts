import { describe, expect, it } from 'vitest';
import {
  analyseCarPurchase,
  AT_HOP_WEEKLY_CAP,
  compareOptions,
  createExampleOptions,
  DEFAULT_OWNERSHIP,
  DEFAULT_SETTINGS,
  monthlyOwnershipCost,
  type OwnershipCosts,
  type RouteResult,
} from './index';

const result = (id: string, mode: RouteResult['mode'], totalCost: number) =>
  ({ id, mode, totalCost }) as RouteResult;

const ownership: OwnershipCosts = {
  purchasePrice: 12000,
  resaleValue: 6000,
  yearsOwned: 3,
  insurancePerYear: 600,
  licencePerYear: 180,
  wofPerYear: 60,
  commuteShare: 1,
};

describe('monthlyOwnershipCost', () => {
  it('spreads depreciation and yearly charges over months', () => {
    const fixed = monthlyOwnershipCost(ownership);
    expect(fixed.depreciation).toBeCloseTo(2000 / 12, 10);
    expect(fixed.insurance).toBe(50);
    expect(fixed.licence).toBe(15);
    expect(fixed.wof).toBe(5);
    expect(fixed.total).toBeCloseTo(2000 / 12 + 70, 10);
  });

  it('charges commuting only its share of fixed costs', () => {
    expect(monthlyOwnershipCost({ ...ownership, commuteShare: 0.5 }).total).toBeCloseTo(
      (2000 / 12 + 70) / 2,
      10,
    );
  });

  it('never counts a resale above the price as income', () => {
    expect(monthlyOwnershipCost({ ...ownership, resaleValue: 20000 }).depreciation).toBe(0);
  });

  it('rejects impossible inputs', () => {
    expect(() => monthlyOwnershipCost({ ...ownership, yearsOwned: 0 })).toThrow(RangeError);
    expect(() => monthlyOwnershipCost({ ...ownership, commuteShare: 2 })).toThrow(RangeError);
    expect(() => monthlyOwnershipCost({ ...ownership, insurancePerYear: -1 })).toThrow(RangeError);
  });
});

describe('analyseCarPurchase', () => {
  // Fixed NZ$100 a month; driving NZ$5 and transit NZ$13 per commute day.
  const cheapCar = { ...ownership, purchasePrice: 0, resaleValue: 0, insurancePerYear: 960 };
  cheapCar.licencePerYear = 180;
  cheapCar.wofPerYear = 60;

  it('finds the fewest commute days at which the car pays off', () => {
    const analysis = analyseCarPurchase(
      [result('drive', 'drive', 5), result('transit', 'transit', 13)],
      cheapCar,
      4,
    )!;
    expect(analysis.fixed.total).toBe(100);
    // One day: 100 + 20 = 120 against 52; three days: 160 against 156; four: 180 against 208.
    expect(analysis.rows[0]).toEqual({ daysPerWeek: 1, withCar: 120, withoutCar: 52 });
    expect(analysis.breakEvenDays).toBe(4);
  });

  it('shows when the weekly fare cap means a car never pays off for commuting', () => {
    // Fixed NZ$150 a month: five days uncapped is 250 against 260, but capped fares stay at 200.
    const dearerCar = { ...cheapCar, insurancePerYear: 1560 };
    const options = [result('drive', 'drive', 5), result('transit', 'transit', 13)];
    expect(analyseCarPurchase(options, dearerCar, 4)!.breakEvenDays).toBe(5);
    const capped = analyseCarPurchase(options, dearerCar, 4, AT_HOP_WEEKLY_CAP)!;
    expect(capped.rows[4]!.withoutCar).toBe(200);
    expect(capped.breakEvenDays).toBeNull();
    expect(capped.capPreventsPayoff).toBe(true);
  });

  it('compares the cheapest option that needs a car against the cheapest transit', () => {
    const analysis = analyseCarPurchase(
      [
        result('drive', 'drive', 9),
        result('hybrid', 'hybrid', 7),
        result('transit', 'transit', 13),
        result('bus-2', 'transit', 11),
      ],
      cheapCar,
      4,
    )!;
    expect(analysis.carOption.id).toBe('hybrid');
    expect(analysis.transitOption.id).toBe('bus-2');
  });

  it('needs both a car option and public transport', () => {
    expect(analyseCarPurchase([result('drive', 'drive', 5)], cheapCar, 4)).toBeNull();
  });

  it('works on the example commute with the default ownership values', () => {
    const { results } = compareOptions(createExampleOptions(), DEFAULT_SETTINGS);
    const analysis = analyseCarPurchase(results, DEFAULT_OWNERSHIP, DEFAULT_SETTINGS.weeksPerMonth);
    expect(analysis?.rows).toHaveLength(7);
    // Transit is cheaper per day in the example, so no number of days makes the car pay off.
    expect(analysis?.breakEvenDays).toBeNull();
    expect(analysis?.capPreventsPayoff).toBe(false);
  });
});
