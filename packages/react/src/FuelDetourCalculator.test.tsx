import { describe, expect, it } from 'vitest';
import { parseFuelPrice } from './FuelDetourCalculator';

describe('fuel price input', () => {
  it('reads dollars per litre, or cents as Gaspy and pump boards show them', () => {
    expect(parseFuelPrice('2.85')).toBe(2.85);
    expect(parseFuelPrice('$3.10')).toBe(3.1);
    expect(parseFuelPrice('289.9')).toBeCloseTo(2.899, 6);
    expect(parseFuelPrice('')).toBeUndefined();
    expect(parseFuelPrice('abc')).toBeUndefined();
    expect(parseFuelPrice('0')).toBeUndefined();
  });
});
