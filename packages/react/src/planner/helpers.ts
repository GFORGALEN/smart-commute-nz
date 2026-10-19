import { type JourneyOption, type Location } from '@smart-commute/core';
import { type PlannerState } from './types';

export const toLocation = (value: Location | string): Location =>
  typeof value === 'string' ? { label: value } : value;
export const cloneOption = (option: JourneyOption): JourneyOption => ({
  ...option,
  outbound: option.outbound.map((leg) => ({ ...leg })),
  inbound: option.inbound.map((leg) => ({ ...leg })),
  waypoints: option.waypoints.map((place) => ({ ...place })),
});
export const shortNumber = (value: number) =>
  new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 1 }).format(value);
export const hasGoogleProvenance = (option: JourneyOption) =>
  option.id.startsWith('google-') ||
  [...option.outbound, ...option.inbound].some((leg) => leg.source === 'google');
export const usesATFare = (option: JourneyOption, roundTrip: boolean) =>
  [...option.outbound, ...(roundTrip ? option.inbound : [])].some(
    (leg) =>
      (leg.mode === 'bus' || leg.mode === 'train') &&
      (leg.fareSource === 'at-rule' || leg.source === 'at-rule'),
  );
export const atFareContext = (option: JourneyOption, state: PlannerState, currentMinute: number) =>
  JSON.stringify({
    origin: state.origin,
    destination: state.destination,
    leaveNow: state.leaveNow,
    departure: state.leaveNow ? currentMinute : state.departure,
    returnTime: state.returnTime,
    roundTrip: state.settings.roundTrip,
    waypoints: option.waypoints,
    outbound: option.outbound.map((leg) => [
      leg.mode,
      leg.durationMinutes,
      leg.distanceKm,
      leg.transfers,
    ]),
    inbound: option.inbound.map((leg) => [
      leg.mode,
      leg.durationMinutes,
      leg.distanceKm,
      leg.transfers,
    ]),
  });

/**
 * A Google Maps directions link for the planned trip, which phones open in the Google Maps app.
 * A start that is "my current location" is left out, so Google Maps follows the live position;
 * stops are passed only for driving, as Google Maps transit takes none.
 */
export const googleMapsDirectionsUrl = ({
  origin,
  destination,
  mode,
  waypoints = [],
  currentLocationLabels = [],
}: {
  origin: Location;
  destination: Location;
  mode: 'drive' | 'transit';
  waypoints?: Location[];
  currentLocationLabels?: string[];
}) => {
  const place = (location: Location) =>
    location.coordinates
      ? `${location.coordinates.lat},${location.coordinates.lng}`
      : location.label.trim();
  const params = new URLSearchParams({ api: '1' });
  const followsYou = !origin.label.trim() || currentLocationLabels.includes(origin.label);
  if (!followsYou) {
    params.set('origin', place(origin));
    if (origin.placeId) params.set('origin_place_id', origin.placeId);
  }
  params.set('destination', place(destination));
  if (destination.placeId) params.set('destination_place_id', destination.placeId);
  params.set('travelmode', mode === 'drive' ? 'driving' : 'transit');
  const stops = mode === 'drive' ? waypoints.filter((stop) => stop.label.trim()) : [];
  if (stops.length) params.set('waypoints', stops.map(place).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
};
