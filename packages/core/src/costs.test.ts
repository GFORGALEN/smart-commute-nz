import { describe, expect, it } from 'vitest';
import {
  calculateFuelCost,
  calculateOption,
  compareOptions,
  createExampleOptions,
  DEFAULT_SETTINGS,
  estimateReturnLegs,
  type CommuteSettings,
  type JourneyOption,
  type TransitFareRange,
} from './index';

// Fuel-formula tests isolate upkeep; the default upkeep has its own test below.
const settings: CommuteSettings = { ...DEFAULT_SETTINGS, maintenancePerKm: 0 };

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

function estimatedTransitOption(id: string, min = 3, max = 7.9): JourneyOption {
  const option = transitOption(id, 0, 40);
  delete option.outbound[0]!.fare;
  option.outbound[0]!.fareRange = {
    min,
    max,
    source: 'at-estimate',
    basis: 'standard-adult',
    assumptions: ['Adult HOP or contactless fare; zones are not verified.'],
  };
  option.outbound[0]!.source = 'google';
  option.outbound[0]!.estimated = true;
  return option;
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

  it('applies the IRD-derived upkeep default to driving kilometres', () => {
    const option = createExampleOptions().find((item) => item.id === 'drive')!;
    const result = calculateOption(option, DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.maintenancePerKm).toBe(0.08);
    expect(result.maintenanceCost).toBeCloseTo(38 * 0.08, 10);
    expect(result.totalCost).toBeCloseTo(10.906 + 3.04, 10);
  });

  it('adds fuel lost in traffic delay separately from distance-based fuel', () => {
    const option = driveOption({
      outbound: [
        {
          mode: 'drive',
          distanceKm: 20,
          durationMinutes: 45,
          congestionMinutes: 15,
          source: 'google',
          estimated: true,
        },
      ],
      inbound: [
        {
          mode: 'drive',
          distanceKm: 20,
          durationMinutes: 30,
          congestionMinutes: 0,
          source: 'google',
          estimated: true,
        },
      ],
    });
    const result = calculateOption(option, { ...settings, congestionFuelPerHour: 0.8 });
    expect(result.congestionMinutes).toBe(15);
    expect(result.congestionFuelCost).toBeCloseTo(0.25 * 0.8 * 3.5, 10);
    expect(result.fuelCost).toBeCloseTo((40 / 100) * 8.2 * 3.5, 10);
    expect(result.totalCost).toBeCloseTo(result.fuelCost + result.congestionFuelCost, 10);
    expect(
      calculateOption(option, { ...settings, congestionFuelPerHour: undefined }).congestionFuelCost,
    ).toBe(0);
    expect(() => calculateOption(option, { ...settings, congestionFuelPerHour: -1 })).toThrow(
      RangeError,
    );
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

  it('selects the shortest distance, ranking routes with missing distances last', () => {
    const short = driveOption({ id: 'short' });
    short.outbound[0]!.distanceKm = 12;
    const long = driveOption({ id: 'long' });
    long.outbound[0]!.distanceKm = 25;
    const unknown = transitOption('unknown', 2, 40);
    const comparison = compareOptions([long, unknown, short], oneWaySettings);
    expect(comparison.shortest.id).toBe('short');
    expect(comparison.shortest.distanceComplete).toBe(true);
    expect(comparison.results.find((result) => result.id === 'unknown')!.distanceComplete).toBe(
      false,
    );
    // An incomplete route is still the shortest when nothing else is known.
    expect(compareOptions([unknown], oneWaySettings).shortest.id).toBe('unknown');
  });

  it('breaks shortest-distance ties using time', () => {
    const slower = driveOption({ id: 'slower' });
    slower.outbound[0]!.durationMinutes = 50;
    const faster = driveOption({ id: 'faster' });
    expect(compareOptions([slower, faster], settings).shortest.id).toBe('faster');
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
    for (const key of [
      'cheapest',
      'fastest',
      'fewestTransfers',
      'bestValue',
      'shortest',
    ] as const) {
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

describe('approximate transit fare ranges', () => {
  const oneWaySettings = { ...settings, roundTrip: false };

  it('keeps fare uncertainty through daily, weekly and monthly projections', () => {
    const option = estimatedTransitOption('estimated');
    option.outbound.push({
      mode: 'train',
      durationMinutes: 20,
      fare: 0,
      transfers: 1,
      source: 'google',
      estimated: true,
    });
    const result = calculateOption(option, oneWaySettings);
    expect(result.fareCost).toBe(7.9);
    expect(result.totalCost).toBe(7.9);
    expect(result.generalizedCost).toBe(22.9);
    expect(result.fareCostRange).toEqual({ min: 3, max: 7.9 });
    expect(result.totalCostRange).toEqual({ min: 3, max: 7.9 });
    expect(result.dailyCostRange).toEqual({ min: 3, max: 7.9 });
    expect(result.weeklyCostRange).toEqual({ min: 15, max: 39.5 });
    expect(result.monthlyCostRange?.min).toBeCloseTo(64.95, 10);
    expect(result.monthlyCostRange?.max).toBeCloseTo(171.035, 10);
    expect(result.breakdown.outbound.fareCostRange).toEqual({ min: 3, max: 7.9 });
    expect(result.warnings).toContain('fare-range-estimate');
  });

  it('adds independent return ranges, exact fares, driving costs and parking once', () => {
    const option = estimatedTransitOption('hybrid');
    option.mode = 'hybrid';
    option.parkingCost = 2;
    option.parkingVerified = true;
    option.outbound.push(
      {
        mode: 'drive',
        distanceKm: 10,
        durationMinutes: 10,
        toll: 1,
        source: 'manual',
        estimated: false,
      },
      { mode: 'train', durationMinutes: 10, fare: 2, source: 'manual', estimated: false },
    );
    option.inbound = estimatedTransitOption('return', 4.9, 6.5).outbound;
    const result = calculateOption(option, {
      ...settings,
      fuelPrice: 2,
      fuelConsumption: 10,
      maintenancePerKm: 0.1,
    });
    expect(result.breakdown.outbound.fareCostRange).toEqual({ min: 5, max: 9.9 });
    expect(result.breakdown.outbound.totalCostRange).toEqual({ min: 9, max: 13.9 });
    expect(result.breakdown.inbound.fareCostRange).toEqual({ min: 4.9, max: 6.5 });
    expect(result.fareCostRange?.min).toBeCloseTo(9.9, 10);
    expect(result.fareCostRange?.max).toBeCloseTo(16.4, 10);
    expect(result.totalCostRange?.min).toBeCloseTo(15.9, 10);
    expect(result.totalCostRange?.max).toBeCloseTo(22.4, 10);
    expect(result.totalCost).toBeCloseTo(22.4, 10);
    expect(result.weeklyCostRange?.min).toBeCloseTo(79.5, 10);
    expect(result.weeklyCostRange?.max).toBeCloseTo(112, 10);
    expect(result.monthlyCostRange?.min).toBeCloseTo(344.235, 10);
    expect(result.monthlyCostRange?.max).toBeCloseTo(484.96, 10);
  });

  it('uses explicit fares, including zero, in preference to an earlier estimate', () => {
    const option = estimatedTransitOption('overridden');
    option.outbound[0]!.fare = 0;
    const result = calculateOption(option, oneWaySettings);
    expect(result.fareCost).toBe(0);
    expect(result.fareCostRange).toBeUndefined();
    expect(result.totalCostRange).toBeUndefined();
    expect(result.weeklyCostRange).toBeUndefined();
    expect(result.warnings).not.toContain('fare-range-estimate');
    option.outbound[0]!.fare = 4.9;
    expect(calculateOption(option, oneWaySettings).totalCost).toBe(4.9);
  });

  it('retains the estimate warning for a single possible fare', () => {
    const result = calculateOption(estimatedTransitOption('citylink', 1, 1), oneWaySettings);
    expect(result.totalCostRange).toEqual({ min: 1, max: 1 });
    expect(result.warnings).toContain('fare-range-estimate');
  });

  it('includes uncertainty only for selected directions', () => {
    const option = transitOption('exact-outbound', 4.9, 30);
    option.inbound = estimatedTransitOption('estimated-return').outbound;
    const result = calculateOption(option, oneWaySettings);
    expect(result.totalCost).toBe(4.9);
    expect(result.totalCostRange).toBeUndefined();
    expect(result.breakdown.inbound.fareCostRange).toBeUndefined();
    expect(result.warnings).not.toContain('fare-range-estimate');
    const roundTrip = calculateOption(option, settings);
    expect(roundTrip.totalCostRange?.min).toBeCloseTo(7.9, 10);
    expect(roundTrip.totalCostRange?.max).toBeCloseTo(12.8, 10);
  });

  it('ranks monetary and value comparisons by the estimate upper bound', () => {
    const approximate = estimatedTransitOption('approximate', 3, 7.9);
    const exact = transitOption('exact', 4.9, 40);
    const comparison = compareOptions([approximate, exact], oneWaySettings);
    expect(comparison.cheapest.id).toBe('exact');
    expect(comparison.bestValue.id).toBe('exact');
    expect(comparison.results.map((result) => result.id)).toEqual(['exact', 'approximate']);
    approximate.outbound[0]!.fare = 3;
    expect(compareOptions([approximate, exact], oneWaySettings).cheapest.id).toBe('approximate');
  });

  it('does not treat any unpriced Google bus or train segment as free', () => {
    const option = estimatedTransitOption('partial');
    delete option.outbound[0]!.fareRange;
    expect(() => calculateOption(option, oneWaySettings)).toThrow(
      'missing fare is not free travel',
    );
    option.outbound[0]!.fare = 4.9;
    option.outbound.push({ mode: 'train', durationMinutes: 20, source: 'google', estimated: true });
    expect(() => calculateOption(option, oneWaySettings)).toThrow(
      'missing fare is not free travel',
    );
    option.outbound[1]!.fare = 0;
    expect(calculateOption(option, oneWaySettings).totalCost).toBe(4.9);
  });

  it('preserves existing manually entered journeys without range outputs', () => {
    const result = calculateOption(transitOption('manual', 6.5, 30), oneWaySettings);
    expect(result.totalCost).toBe(6.5);
    expect(result.fareCostRange).toBeUndefined();
    expect(result.totalCostRange).toBeUndefined();
    expect(result.monthlyCostRange).toBeUndefined();
    expect(result.warnings).not.toContain('fare-range-estimate');
  });

  it.each([
    { min: -1, max: 3 },
    { min: 3, max: -1 },
    { min: NaN, max: 3 },
    { min: 3, max: Infinity },
    { min: 7.9, max: 3 },
  ])('rejects invalid fare bounds $min to $max', (bounds) => {
    const option = estimatedTransitOption('invalid');
    option.outbound[0]!.fareRange = { ...bounds, source: 'at-estimate' };
    expect(() => calculateOption(option, oneWaySettings)).toThrow();
  });

  it('rejects unsupported range provenance and projection overflow', () => {
    const option = estimatedTransitOption('invalid-source');
    option.outbound[0]!.fareRange = {
      min: 3,
      max: 7.9,
      source: 'unknown',
    } as unknown as TransitFareRange;
    expect(() => calculateOption(option, oneWaySettings)).toThrow('source is not supported');
    expect(() =>
      calculateOption(estimatedTransitOption('overflow', 3, Number.MAX_VALUE), oneWaySettings),
    ).toThrow();
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

describe('budget return estimated from the outbound route', () => {
  const settings: CommuteSettings = { ...DEFAULT_SETTINGS, roundTrip: true };
  const range: TransitFareRange = { min: 3, max: 7.9, source: 'at-estimate' };

  it('mirrors driving distance and tolls without the outbound traffic delay', () => {
    const outbound = [
      {
        mode: 'drive' as const,
        distanceKm: 20,
        durationMinutes: 30,
        toll: 2.6,
        congestionMinutes: 12,
        source: 'google' as const,
        estimated: true,
      },
    ];
    const inbound = estimateReturnLegs(outbound);
    expect(inbound).toEqual([
      {
        mode: 'drive',
        distanceKm: 20,
        durationMinutes: 30,
        toll: 2.6,
        source: 'google',
        estimated: true,
      },
    ]);
    const result = calculateOption(
      {
        id: 'drive',
        name: 'Drive',
        mode: 'drive',
        outbound,
        inbound,
        parkingCost: 10,
        waypoints: [],
        returnBasis: 'estimated-from-outbound',
      },
      settings,
    );
    // Parking is charged once for the commute, not once per direction.
    expect(result.parkingCost).toBe(10);
    expect(result.tollCost).toBeCloseTo(5.2);
    expect(result.warnings).not.toContain('missing-return');
  });

  it('keeps a fare range for the return but leaves an exact fare pending, never free', () => {
    const transitLeg = (fare: Partial<{ fare: number; fareRange: TransitFareRange }>) => ({
      mode: 'bus' as const,
      durationMinutes: 20,
      distanceKm: 8,
      source: 'google' as const,
      estimated: true,
      transit: { departureStop: 'A', arrivalStop: 'B' },
      ...fare,
    });
    const ranged = estimateReturnLegs([transitLeg({ fareRange: range }), transitLeg({ fare: 0 })]);
    expect(ranged[0]).toMatchObject({ fareRange: { min: 3, max: 7.9 }, fareSource: 'at-estimate' });
    expect(ranged[1]).toMatchObject({ fare: 0 });
    expect(ranged[0]!.transit).toEqual({ departureStop: 'B', arrivalStop: 'A' });

    const exact = estimateReturnLegs([transitLeg({ fare: 4.9 })]);
    expect(exact[0]).toMatchObject({ farePending: true });
    expect(exact[0]!.fare).toBeUndefined();
    const result = calculateOption(
      {
        id: 'transit',
        name: 'Transit',
        mode: 'transit',
        outbound: [transitLeg({ fare: 4.9 })],
        inbound: exact,
        parkingCost: 0,
        waypoints: [],
        returnBasis: 'estimated-from-outbound',
      },
      settings,
    );
    expect(result.warnings).toContain('fare-pending');
    expect(result.fareCost).toBeCloseTo(4.9);
    // A confirmed return fare clears the pending state.
    const confirmed = calculateOption(
      { ...result.option, inbound: [{ ...exact[0]!, fare: 5.4 }] },
      settings,
    );
    expect(confirmed.warnings).not.toContain('fare-pending');
    expect(confirmed.fareCost).toBeCloseTo(10.3);
  });

  it('rejects an unknown return basis', () => {
    const [option] = createExampleOptions();
    expect(() =>
      calculateOption(
        { ...option!, returnBasis: 'guessed' as JourneyOption['returnBasis'] },
        settings,
      ),
    ).toThrow(/returnBasis/);
  });
});
