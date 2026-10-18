import { describe, expect, it } from 'vitest';
import { type JourneyOption, type TravelLeg } from '@smart-commute/core';
import { atZoneFare, canChooseATZones, withATZones } from './helpers';

const bus = (min: number, max: number): TravelLeg => ({
  mode: 'bus',
  durationMinutes: 20,
  source: 'google',
  estimated: true,
  fareSource: 'at-estimate',
  fareRange: { min, max, source: 'at-estimate', basis: 'standard-adult' },
});
const option = (outbound: TravelLeg[], inbound: TravelLeg[] = []): JourneyOption => ({
  id: 'google-transit-0',
  name: 'Bus',
  mode: 'transit',
  outbound,
  inbound,
  parkingCost: 0,
  waypoints: [],
});

describe('AT zone pricing', () => {
  it('uses the published adult fare for 1, 2, 3 and 4 or more zones', () => {
    expect([1, 2, 3, 4, 6].map(atZoneFare)).toEqual([3, 4.9, 6.5, 7.9, 7.9]);
  });

  it('narrows one integrated journey in each direction to the chosen zone fare', () => {
    const priced = withATZones(option([bus(3, 7.9)], [bus(3, 7.9)]), 2);
    expect(priced.outbound[0]!.fareRange).toMatchObject({ min: 4.9, max: 4.9 });
    expect(priced.inbound[0]!.fareRange).toMatchObject({ min: 4.9, max: 4.9 });
  });

  it('leaves split journeys and CityLink alone, since one zone count cannot price them', () => {
    const split = option([bus(6, 15.8)]);
    expect(canChooseATZones(split)).toBe(false);
    expect(withATZones(split, 1)).toBe(split);
    const cityLink = option([
      { ...bus(0.95, 0.95), fareRange: { ...bus(0.95, 0.95).fareRange!, basis: 'citylink' } },
    ]);
    expect(canChooseATZones(cityLink)).toBe(false);
  });
});
