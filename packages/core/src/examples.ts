import type { JourneyOption, TravelLeg } from './types';

function manualLeg(
  mode: TravelLeg['mode'],
  durationMinutes: number,
  extras: Partial<TravelLeg> = {},
): TravelLeg {
  return { mode, durationMinutes, source: 'manual', estimated: true, ...extras };
}

/**
 * Places of the offline sample. Live planning starts with empty places instead, because
 * these labels describe the sample distances and fares, not anyone's commute.
 */
export const EXAMPLE_ORIGIN = '4 Fong Road, Auckland';
export const EXAMPLE_DESTINATION = 'Britomart, Auckland';

/** A saved place that is still the untouched sample label, never chosen from search or the map. */
export const isExamplePlace = (place: { label: string; coordinates?: unknown } | undefined) =>
  Boolean(
    place &&
    !place.coordinates &&
    (place.label === EXAMPLE_ORIGIN || place.label === EXAMPLE_DESTINATION),
  );

/** Stored label of the sample interchange; interfaces may show a translated equivalent. */
export const EXAMPLE_INTERCHANGE_LABEL = 'User-selected interchange (example assumption)';

/**
 * Offline assumptions for 4 Fong Road → Britomart, Auckland. These are editable
 * demonstration inputs, not verified routes, live fares, or a parking permission check.
 * A fresh object is returned on each call so a planner can edit it safely.
 */
export function createExampleOptions(): JourneyOption[] {
  return [
    {
      id: 'drive',
      name: 'Full drive',
      mode: 'drive',
      outbound: [manualLeg('drive', 35, { distanceKm: 19 })],
      inbound: [manualLeg('drive', 35, { distanceKm: 19 })],
      parkingCost: 0,
      parkingVerified: false,
      waypoints: [],
    },
    {
      id: 'hybrid',
      name: 'Drive + train',
      mode: 'hybrid',
      outbound: [
        manualLeg('drive', 25, { distanceKm: 15 }),
        manualLeg('parking', 3),
        manualLeg('walk', 5),
        manualLeg('wait', 7),
        manualLeg('train', 25, { fare: 4.9, transfers: 1 }),
        manualLeg('walk', 5),
      ],
      inbound: [
        manualLeg('walk', 5),
        manualLeg('wait', 7),
        manualLeg('train', 25, { fare: 4.9, transfers: 1 }),
        manualLeg('walk', 5),
        manualLeg('parking', 3),
        manualLeg('drive', 25, { distanceKm: 15 }),
      ],
      parkingCost: 0,
      parkingVerified: false,
      waypoints: [{ label: EXAMPLE_INTERCHANGE_LABEL }],
    },
    {
      id: 'transit',
      name: 'Public transport',
      mode: 'transit',
      outbound: [manualLeg('bus', 60, { fare: 6.5 })],
      inbound: [manualLeg('bus', 60, { fare: 6.5 })],
      parkingCost: 0,
      parkingVerified: false,
      waypoints: [],
    },
  ];
}
