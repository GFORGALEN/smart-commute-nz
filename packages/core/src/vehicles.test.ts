import { describe, expect, it } from 'vitest';
import {
  calculateOption,
  DEFAULT_SETTINGS,
  energyShares,
  VEHICLE_PRESETS,
  type CommuteSettings,
  type JourneyOption,
} from './index';

const oneWay = (congestionMinutes = 0): JourneyOption => ({
  id: 'drive',
  name: 'Drive',
  mode: 'drive',
  parkingCost: 0,
  parkingVerified: true,
  waypoints: [],
  outbound: [
    {
      mode: 'drive',
      distanceKm: 19,
      durationMinutes: 30,
      congestionMinutes,
      source: 'manual',
      estimated: true,
    },
  ],
  inbound: [],
});

const settingsFor = (kind: CommuteSettings['vehicleKind']): CommuteSettings => ({
  ...DEFAULT_SETTINGS,
  ...VEHICLE_PRESETS[kind!],
  vehicleKind: kind,
  roundTrip: false,
  maintenancePerKm: 0,
});

describe('vehicle types', () => {
  it('keeps petrol free of RUC, as before vehicle types existed', () => {
    const result = calculateOption(oneWay(), { ...DEFAULT_SETTINGS, roundTrip: false });
    expect(result.rucCost).toBe(0);
    expect(result.fuelCost).toBeCloseTo(19 * 0.082 * 3.5, 10);
  });

  it('charges diesel its fuel and NZ$76 per 1,000 km of RUC', () => {
    const result = calculateOption(oneWay(), settingsFor('diesel'));
    expect(result.fuelCost).toBeCloseTo(19 * 0.07 * 3.2, 10);
    expect(result.rucCost).toBeCloseTo(1.444, 10);
    expect(result.totalCost).toBeCloseTo(19 * 0.07 * 3.2 + 1.444, 10);
  });

  it('prices an electric car by electricity and full RUC, with no fuel lost in traffic', () => {
    const result = calculateOption(oneWay(60), settingsFor('electric'));
    expect(result.fuelCost).toBeCloseTo(19 * 0.17 * 0.41, 10);
    expect(result.rucCost).toBeCloseTo(1.444, 10);
    expect(result.congestionFuelCost).toBe(0);
  });

  it('splits a plug-in hybrid between fuel and battery and charges half-rate RUC', () => {
    const result = calculateOption(oneWay(), settingsFor('plug-in-hybrid'));
    expect(result.fuelCost).toBeCloseTo(19 * 0.06 * 3.5 * 0.5 + 19 * 0.18 * 0.41 * 0.5, 10);
    expect(result.rucCost).toBeCloseTo(0.722, 10);
  });

  it('uses the battery share only for plug-in hybrids', () => {
    expect(energyShares({ ...DEFAULT_SETTINGS, vehicleKind: 'hybrid' })).toEqual({
      fuel: 1,
      electric: 0,
    });
    expect(
      energyShares({ ...DEFAULT_SETTINGS, vehicleKind: 'plug-in-hybrid', electricShare: 0.8 }),
    ).toEqual({ fuel: 0.19999999999999996, electric: 0.8 });
  });

  it('rejects an unknown vehicle type and a battery share above one', () => {
    expect(() =>
      calculateOption(oneWay(), {
        ...DEFAULT_SETTINGS,
        vehicleKind: 'steam' as CommuteSettings['vehicleKind'],
      }),
    ).toThrow(TypeError);
    expect(() => calculateOption(oneWay(), { ...DEFAULT_SETTINGS, electricShare: 1.2 })).toThrow(
      RangeError,
    );
  });
});
