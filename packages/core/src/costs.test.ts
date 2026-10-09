import { describe, expect, it } from 'vitest';
import {
  calculateFuelCost,
  calculateOption,
  compareOptions,
  createExampleOptions,
  DEFAULT_SETTINGS,
  type CommuteSettings,
  type JourneyOption,
} from './index';

const settings: CommuteSettings = { ...DEFAULT_SETTINGS };

function driveOption(overrides: Partial<JourneyOption> = {}): JourneyOption {
  return {
    id: 'test-drive',
    name: 'Test driving route',
    mode: 'drive',
    parkingCost: 0,
    parkingVerified: true,
    waypoints: [],
    outbound: [
      { mode: 'drive', distanceKm: 19, durationMinutes: 35, source: 'manual', estimated: true },
    ],
    inbound: [
      { mode: 'drive', distanceKm: 19, durationMinutes: 35, source: 'manual', estimated: true },
    ],
    ...overrides,
  };
}

function transitOption(id: string, fare: number, minutes: number, transfers = 0): JourneyOption {
  return {
    id,
    name: id,
    mode: 'transit',
    parkingCost: 0,
    waypoints: [],
    outbound: [
      {
        mode: 'bus',
        fare,
        durationMinutes: minutes,
        transfers,
        source: 'manual',
        estimated: false,
      },
    ],
    inbound: [],
  };
}

describe('fuel cost', () => {
  it('calculates the supplied 19 km demonstration without premature cent rounding', () => {
    expect(calculateFuelCost(19, 8.2, 3.5)).toBeCloseTo(5.453, 10);
  });

  it('accepts zero distance, fuel consumption and price', () => {
    expect(calculateFuelCost(0, 8.2, 3.5)).toBe(0);
    expect(calculateFuelCost(19, 0, 3.5)).toBe(0);
    expect(calculateFuelCost(19, 8.2, 0)).toBe(0);
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid fuel input %s', (value) => {
    expect(() => calculateFuelCost(value, 8.2, 3.5)).toThrow();
    expect(() => calculateFuelCost(19, value, 3.5)).toThrow();
    expect(() => calculateFuelCost(19, 8.2, value)).toThrow();
  });

  it('rejects values whose multiplication would overflow', () => {
    expect(() => calculateFuelCost(Number.MAX_VALUE, Number.MAX_VALUE, 3.5)).toThrow();
  });
});

describe('independent journey calculation', () => {
  it('calculates full driving fuel costs and daily, weekly and monthly projections', () => {
    const result = calculateOption(driveOption(), settings);
    expect(result.fuelCost).toBeCloseTo(10.906, 10);
    expect(result.totalCost).toBeCloseTo(10.906, 10);
    expect(result.distanceKm).toBe(38);
    expect(result.totalMinutes).toBe(70);
    expect(result.dailyCost).toBe(result.totalCost);
    expect(result.weeklyCost).toBeCloseTo(54.53, 10);
    expect(result.monthlyCost).toBeCloseTo(236.1149, 10);
    expect(result.generalizedCost).toBeCloseTo(28.406, 10);
  });

  it('combines hybrid driving fuel, fares and all access/waiting time', () => {
    const option = createExampleOptions().find((candidate) => candidate.id === 'hybrid')!;
    const result = calculateOption(option, settings);
    expect(result.fuelCost).toBeCloseTo(8.61, 10);
    expect(result.fareCost).toBeCloseTo(9.8, 10);
    expect(result.totalCost).toBeCloseTo(18.41, 10);
    expect(result.totalMinutes).toBe(140);
    expect(result.distanceKm).toBe(30);
    expect(result.transfers).toBe(2);
    expect(result.warnings).toContain('unverified-parking');
  });

  it('calculates public transport fares without applying vehicle consumption or maintenance', () => {
    const option = createExampleOptions().find((candidate) => candidate.id === 'transit')!;
    option.outbound[0]!.distanceKm = 21;
    option.inbound[0]!.distanceKm = 23;
    const result = calculateOption(option, { ...settings, maintenancePerKm: 0.3 });
    expect(result.fareCost).toBe(13);
    expect(result.fuelCost).toBe(0);
    expect(result.maintenanceCost).toBe(0);
    expect(result.totalCost).toBe(13);
    expect(result.totalMinutes).toBe(120);
    expect(result.distanceKm).toBe(44);
  });

  it('calculates different outward and return distances, time, consumption and tolls', () => {
    const option = driveOption({
      outbound: [
        {
          mode: 'drive',
          distanceKm: 10,
          durationMinutes: 20,
          fuelConsumption: 7,
          toll: 2,
          source: 'manual',
          estimated: false,
        },
      ],
      inbound: [
        {
          mode: 'drive',
          distanceKm: 15,
          durationMinutes: 45,
          fuelConsumption: 11,
          toll: 3,
          source: 'google',
          estimated: true,
        },
      ],
    });
    const result = calculateOption(option, settings);
    expect(result.breakdown.outbound.fuelCost).toBeCloseTo(2.45, 10);
    expect(result.breakdown.inbound.fuelCost).toBeCloseTo(5.775, 10);
    expect(result.distanceKm).toBe(25);
    expect(result.totalMinutes).toBe(65);
    expect(result.tollCost).toBe(5);
    expect(result.totalCost).toBeCloseTo(13.225, 10);
  });

  it('charges parking once per commute, even for a return trip', () => {
    const option = driveOption({ parkingCost: 12 });
    expect(calculateOption(option, settings).totalCost).toBeCloseTo(22.906, 10);
    const result = calculateOption(option, { ...settings, roundTrip: false });
    expect(result.totalCost).toBeCloseTo(17.453, 10);
    expect(result.parkingCost).toBe(12);
    expect(result.breakdown.inbound.totalCost).toBe(0);
    expect(result.totalMinutes).toBe(35);
    expect(result.distanceKm).toBe(19);
  });

  it('includes an optional maintenance allowance for driving kilometres only', () => {
    const option = driveOption();
    option.outbound.push({
      mode: 'walk',
      distanceKm: 1,
      durationMinutes: 10,
      source: 'manual',
      estimated: false,
    });
    const result = calculateOption(option, { ...settings, maintenancePerKm: 0.2 });
    expect(result.maintenanceCost).toBeCloseTo(7.6, 10);
    expect(result.totalCost).toBeCloseTo(18.506, 10);
    expect(result.distanceKm).toBe(39);
    expect(calculateOption(option, settings).maintenanceCost).toBe(0);
  });

  it('uses updated fuel price and default consumption, preserving explicit leg overrides', () => {
    const option = driveOption();
    const result = calculateOption(option, { ...settings, fuelPrice: 4, fuelConsumption: 10 });
    expect(result.fuelCost).toBeCloseTo(15.2, 10);
    option.outbound[0]!.fuelConsumption = 12;
    expect(
      calculateOption(option, { ...settings, fuelPrice: 4, fuelConsumption: 10 }).fuelCost,
    ).toBeCloseTo(16.72, 10);
  });

  it('never invents a return when no return route is supplied', () => {
    const result = calculateOption(driveOption({ inbound: [] }), settings);
    expect(result.distanceKm).toBe(19);
    expect(result.warnings).toContain('missing-return');
    expect(result.breakdown.inbound.totalCost).toBe(0);
    expect(
      calculateOption(driveOption({ inbound: [] }), { ...settings, roundTrip: false }).warnings,
    ).not.toContain('missing-return');
  });

  it('evaluates estimate warnings only for included directions and does not treat zero parking as verified', () => {
    const option = driveOption({ parkingVerified: false });
    option.outbound[0]!.estimated = false;
    expect(calculateOption(option, { ...settings, roundTrip: false }).warnings).toEqual([
      'unverified-parking',
    ]);
    expect(calculateOption(option, settings).warnings).toEqual([
      'estimated-data',
      'unverified-parking',
    ]);
  });

  it('accepts a zero-distance route and zero commuting days', () => {
    const option = driveOption();
    option.outbound[0]!.distanceKm = 0;
    option.inbound[0]!.distanceKm = 0;
    const result = calculateOption(option, { ...settings, daysPerWeek: 0 });
    expect(result.fuelCost).toBe(0);
    expect(result.weeklyCost).toBe(0);
    expect(result.monthlyCost).toBe(0);
  });
});

describe('deterministic comparison', () => {
  const oneWaySettings = { ...settings, roundTrip: false };

  it('selects separate cheapest, fastest, fewest-transfer and best-value options', () => {
    const options = [
      transitOption('cheap', 2, 120, 3),
      transitOption('fast', 20, 10, 2),
      transitOption('direct', 15, 60, 0),
      transitOption('balanced', 5, 30, 1),
    ];
    const comparison = compareOptions(options, oneWaySettings);
    expect(comparison.results.map((result) => result.id)).toEqual([
      'cheap',
      'balanced',
      'direct',
      'fast',
    ]);
    expect(comparison.cheapest.id).toBe('cheap');
    expect(comparison.fastest.id).toBe('fast');
    expect(comparison.fewestTransfers.id).toBe('direct');
    expect(comparison.bestValue.id).toBe('balanced');
    expect(options.map((option) => option.id)).toEqual(['cheap', 'fast', 'direct', 'balanced']);
  });

  it('responds to changed fares and time value', () => {
    const options = [transitOption('bus', 10, 60), transitOption('train', 20, 20)];
    expect(compareOptions(options, { ...oneWaySettings, valueOfTime: 0 }).bestValue.id).toBe('bus');
    expect(compareOptions(options, { ...oneWaySettings, valueOfTime: 30 }).bestValue.id).toBe(
      'train',
    );
    options[1]!.outbound[0]!.fare = 5;
    expect(compareOptions(options, oneWaySettings).cheapest.id).toBe('train');
  });

  it('resolves complete ties by identifier regardless of input order', () => {
    const options = [transitOption('b', 5, 30), transitOption('a', 5, 30)];
    const first = compareOptions(options, oneWaySettings);
    const second = compareOptions([...options].reverse(), oneWaySettings);
    for (const key of ['cheapest', 'fastest', 'fewestTransfers', 'bestValue'] as const) {
      expect(first[key].id).toBe('a');
      expect(second[key].id).toBe('a');
    }
  });

  it('breaks cheapest-cost ties using time before transfers', () => {
    const options = [transitOption('slower', 5, 60, 0), transitOption('faster', 5, 20, 1)];
    expect(compareOptions(options, oneWaySettings).cheapest.id).toBe('faster');
  });

  it('rejects empty comparisons and duplicate identifiers', () => {
    expect(() => compareOptions([], settings)).toThrow('At least one');
    expect(() => compareOptions([driveOption(), driveOption()], settings)).toThrow('unique');
  });
});

describe('invalid-input protection', () => {
  it.each([
    'fuelPrice',
    'fuelConsumption',
    'valueOfTime',
    'daysPerWeek',
    'weeksPerMonth',
    'maintenancePerKm',
  ] as const)('rejects non-finite and negative settings.%s', (key) => {
    for (const value of [-1, NaN, Infinity]) {
      expect(() => calculateOption(driveOption(), { ...settings, [key]: value })).toThrow();
    }
  });

  it.each([
    'distanceKm',
    'durationMinutes',
    'fuelConsumption',
    'fare',
    'toll',
    'transfers',
  ] as const)('rejects non-finite and negative leg.%s', (key) => {
    for (const value of [-1, NaN, Infinity]) {
      const option = driveOption();
      option.outbound[0]![key] = value;
      expect(() => calculateOption(option, settings)).toThrow();
    }
  });

  it('rejects invalid parking, fractional transfers and driving without a distance', () => {
    expect(() => calculateOption(driveOption({ parkingCost: -1 }), settings)).toThrow();
    expect(() => calculateOption(driveOption({ parkingCost: NaN }), settings)).toThrow();
    const option = driveOption();
    option.outbound[0]!.transfers = 0.5;
    expect(() => calculateOption(option, settings)).toThrow('whole number');
    delete option.outbound[0]!.transfers;
    delete option.outbound[0]!.distanceKm;
    expect(() => calculateOption(option, settings)).toThrow('required for driving');
  });

  it('requires one outbound leg, a name and reasonable days per week', () => {
    expect(() => calculateOption(driveOption({ outbound: [] }), settings)).toThrow('outbound');
    expect(() => calculateOption(driveOption({ name: ' ' }), settings)).toThrow('non-empty');
    expect(() => calculateOption(driveOption(), { ...settings, daysPerWeek: 8 })).toThrow('seven');
  });

  it('rejects invalid waypoint coordinates, while accepting valid Auckland coordinates', () => {
    const option = driveOption({
      waypoints: [{ label: 'Auckland', coordinates: { lat: -36.85, lng: 174.76 } }],
    });
    expect(() => calculateOption(option, settings)).not.toThrow();
    for (const coordinates of [
      { lat: NaN, lng: 174.76 },
      { lat: 91, lng: 174.76 },
      { lat: -36.85, lng: 181 },
    ]) {
      option.waypoints[0]!.coordinates = coordinates;
      expect(() => calculateOption(option, settings)).toThrow();
    }
  });

  it('rejects overflow in projected or accumulated costs', () => {
    expect(() =>
      calculateOption(driveOption({ parkingCost: Number.MAX_VALUE }), settings),
    ).toThrow();
    const option = driveOption();
    option.outbound[0]!.durationMinutes = Number.MAX_VALUE;
    option.inbound[0]!.durationMinutes = Number.MAX_VALUE;
    expect(() => calculateOption(option, settings)).toThrow();
  });
});

describe('demonstration data', () => {
  it('provides all three manual modes and creates independently editable objects', () => {
    const first = createExampleOptions();
    const second = createExampleOptions();
    expect(first.map((option) => option.mode)).toEqual(['drive', 'hybrid', 'transit']);
    expect(first.every((option) => option.parkingCost === 0)).toBe(true);
    expect(
      first
        .flatMap((option) => [...option.outbound, ...option.inbound])
        .every((leg) => leg.source === 'manual' && leg.estimated),
    ).toBe(true);
    first[0]!.outbound[0]!.distanceKm = 100;
    expect(second[0]!.outbound[0]!.distanceKm).toBe(19);
    expect(compareOptions(second, settings).results).toHaveLength(3);
  });
});
