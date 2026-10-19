import { describe, expect, it } from 'vitest';
import { googleMapsDirectionsUrl } from './helpers';

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
