import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createExampleOptions } from '@smart-commute/core';
import { NZ_FUEL_PRICES } from '@smart-commute/providers';
import { STORAGE_KEY } from './constants';
import { initialState } from './storage';

const live = { googleApiKey: 'restricted-test-key', destination: '' };
const save = (settings: object, extra: object = {}) =>
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      origin: { label: '' },
      destination: { label: '' },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      options: createExampleOptions(),
      timesVersion: 2,
      ...extra,
    }),
  );

describe('fuel price for a rider', () => {
  beforeEach(() => localStorage.clear());

  it("starts a new live rider at this week's national average", () => {
    const state = initialState(live);
    expect(state.settings.fuelPrice).toBe(NZ_FUEL_PRICES.prices.regular.retail);
    expect(state.fuelPriceChosen).toBe(false);
  });

  it('keeps the offline example and a host-given price as they are', () => {
    expect(initialState({ destination: '' }).settings.fuelPrice).toBe(DEFAULT_SETTINGS.fuelPrice);
    expect(initialState({ ...live, fuelPrice: 2.99 }).settings.fuelPrice).toBe(2.99);
  });

  it('follows the average for the saved car until a price is typed, then keeps it', () => {
    save({ vehicleKind: 'diesel', fuelPrice: 3.2 }, { fuelPriceChosen: false });
    expect(initialState(live).settings.fuelPrice).toBe(NZ_FUEL_PRICES.prices.diesel.retail);
    save({ fuelPrice: 4.2 }, { fuelPriceChosen: true });
    expect(initialState(live).settings.fuelPrice).toBe(4.2);
  });

  it('treats a price saved before this choice existed as typed only if it left the preset', () => {
    save({ fuelPrice: 3.5 });
    expect(initialState(live).fuelPriceChosen).toBe(false);
    save({ fuelPrice: 3.89 });
    expect(initialState(live)).toMatchObject({
      fuelPriceChosen: true,
      settings: { fuelPrice: 3.89 },
    });
  });
});
