import { describe, expect, it } from 'vitest';
import { type JourneyOption, type TravelLeg } from '@smart-commute/core';
import { atZoneFare, canChooseATZones, googleMapsDirectionsUrl, withATZones } from './helpers';

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

  it('re-prices a fare counted on the AT zone map, keeping the count it was read from', () => {
    const leg = bus(4.9, 4.9);
    leg.fareRange!.mapZones = { count: 2, names: ['Isthmus', 'City'] };
    const priced = withATZones(option([leg]), 3);
    expect(priced.outbound[0]!.fareRange).toMatchObject({
      min: 6.5,
      max: 6.5,
      mapZones: { count: 2 },
    });
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

describe('Google Maps directions link', () => {
  const read = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it('leaves out a current-location start so Google Maps follows the phone', () => {
    const url = googleMapsDirectionsUrl({
      origin: { label: 'My current location', coordinates: { lat: -36.87, lng: 174.78 } },
      destination: { label: 'Britomart, Auckland', placeId: 'ChIJbm' },
      mode: 'transit',
      currentLocationLabels: ['My current location', '我的当前位置'],
    });
    expect(url.startsWith('https://www.google.com/maps/dir/?')).toBe(true);
    expect(read(url)).toEqual({
      api: '1',
      destination: 'Britomart, Auckland',
      destination_place_id: 'ChIJbm',
      travelmode: 'transit',
    });
  });

  it('passes a chosen start, coordinates and driving stops', () => {
    const url = googleMapsDirectionsUrl({
      origin: { label: 'Newmarket, Auckland' },
      destination: { label: 'Map pick', coordinates: { lat: -36.9, lng: 174.8 } },
      mode: 'drive',
      waypoints: [
        { label: 'Stop 1', coordinates: { lat: -36.88, lng: 174.79 } },
        { label: 'Epsom' },
      ],
    });
    expect(read(url)).toMatchObject({
      origin: 'Newmarket, Auckland',
      destination: '-36.9,174.8',
      travelmode: 'driving',
      waypoints: '-36.88,174.79|Epsom',
    });
  });

  it('drops stops for public transport, which Google Maps cannot route through', () => {
    const url = googleMapsDirectionsUrl({
      origin: { label: 'Newmarket' },
      destination: { label: 'Britomart' },
      mode: 'transit',
      waypoints: [{ label: 'Epsom' }],
    });
    expect(read(url).waypoints).toBeUndefined();
  });
});
