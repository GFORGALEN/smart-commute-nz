import { type JourneyOption, type Location, type TravelLeg } from '@smart-commute/core';
import { AT_FARE_RULES } from '@smart-commute/providers';
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
 * An AT fare for one integrated journey: every boarding within 30 minutes of the last and the
 * whole trip within four hours, so one fare by zones crossed covers it. Only such a fare, a range
 * or a count read off AT's zone map, can be set by a zone count; split journeys and CityLink keep
 * their own pricing.
 */
const singleJourneyRange = (leg: TravelLeg) =>
  leg.fareRange?.basis === 'standard-adult' &&
  (leg.fareRange.mapZones !== undefined ||
    (leg.fareRange.min === AT_FARE_RULES.adult[0] &&
      leg.fareRange.max === AT_FARE_RULES.adult.at(-1)));
/** The zone count read off AT's zone map for the outbound journey, when one was counted. */
export const mapZoneCount = (option: JourneyOption) =>
  option.outbound.find((leg) => leg.fareRange?.mapZones)?.fareRange?.mapZones;
export const canChooseATZones = (option: JourneyOption) => {
  const ranged = [...option.outbound, ...option.inbound].filter((leg) => leg.fareRange);
  return ranged.length > 0 && ranged.every(singleJourneyRange);
};
/** The AT HOP/contactless adult fare for the zones a rider says the trip passes through. */
export const atZoneFare = (zones: number) =>
  AT_FARE_RULES.adult[Math.min(Math.max(Math.round(zones), 1), AT_FARE_RULES.adult.length) - 1]!;
/** Narrows each direction's AT range to the fare for the chosen zone count; nothing is fetched. */
export const withATZones = (option: JourneyOption, zones: number): JourneyOption => {
  if (!canChooseATZones(option)) return option;
  const fare = atZoneFare(zones);
  const narrow = (legs: TravelLeg[]) =>
    legs.map((leg): TravelLeg =>
      leg.fareRange
        ? {
            ...leg,
            fareRange: {
              ...leg.fareRange,
              min: fare,
              max: fare,
              assumptions: [
                ...(leg.fareRange.assumptions ?? []),
                `Priced for ${zones >= 4 ? '4 or more zones' : `${zones} zone${zones === 1 ? '' : 's'}`} as chosen by the rider.`,
              ],
            },
          }
        : leg,
    );
  return { ...option, outbound: narrow(option.outbound), inbound: narrow(option.inbound) };
};

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
