import { type TravelLeg } from '@smart-commute/core';
import { type RouteErrorCode } from '@smart-commute/providers';
import { type MessageKey } from '@smart-commute/i18n';

export const STORAGE_KEY = 'smart-commute-nz:v1';
/** Storage version 2 records times as Auckland wall-clock times with their instants. */
export const TIMES_VERSION = 2;
/** A cached leave-now result goes stale; a scheduled one stays valid for its instant. */
export const LEAVE_NOW_CACHE_MS = 10 * 60_000;
export const ROUTE_CACHE_SIZE = 8;
/** Below the wide two-column layout, or a phone held sideways, the planner becomes map-first. */
export const MOBILE_QUERY = '(max-width: 899px), (max-height: 520px) and (pointer: coarse)';
export const SHORT_VIEWPORT_QUERY = '(max-height: 600px)';
/** Route framing on the phone map keeps clear of the route card above and the tools beside it. */
export const MOBILE_MAP_PADDING = { top: 150, right: 40, bottom: 40, left: 40 };
export const HISTORY_LAYER_KEY = 'smartCommuteLayer';
export const historyLayer = (value: unknown) => {
  const layer = (value as Record<string, unknown> | null)?.[HISTORY_LAYER_KEY];
  return typeof layer === 'number' && layer > 0 ? layer : 0;
};
export const directionKeys = { outbound: 'outbound', inbound: 'inbound' } as const;
export const legKeys = {
  drive: 'drive',
  bus: 'bus',
  train: 'train',
  walk: 'walk',
  wait: 'wait',
  parking: 'parkingTime',
} as const;
export const warningKeys = {
  'estimated-data': 'estimatedWarning',
  'unverified-parking': 'parkingWarning',
  'missing-return': 'returnWarning',
  'fare-range-estimate': 'fareRangeHelp',
  'fare-pending': 'farePendingWarning',
} as const;
export const googleErrorKeys: Record<RouteErrorCode, MessageKey> = {
  MISSING_KEY: 'googleErrorMissingKey',
  INVALID_INPUT: 'googleErrorInvalidInput',
  UNSUPPORTED: 'googleErrorUnsupported',
  QUOTA_EXCEEDED: 'googleErrorQuota',
  REQUEST_DENIED: 'googleErrorDenied',
  NETWORK_ERROR: 'googleErrorNetwork',
  NO_ROUTES: 'googleErrorNoRoutes',
  INCOMPLETE_RESULT: 'googleErrorIncomplete',
  BUSY: 'googleErrorBusy',
};
/** Leg types that cover ground; waiting and parking have no distance to report. */
export const distanceModes: ReadonlySet<TravelLeg['mode']> = new Set([
  'drive',
  'bus',
  'train',
  'walk',
]);
export const minorModes: ReadonlySet<TravelLeg['mode']> = new Set(['walk', 'wait', 'parking']);
/** Fixed notes written by the Google provider, matched by their opening words. */
export const providerNoteKeys: [string, MessageKey][] = [
  ['Route durations are estimates.', 'providerNoteEstimates'],
  ['This request uses traffic-unaware driving', 'providerNoteTrafficUnaware'],
  ['Outbound alternatives are paired', 'providerNotePairedReturn'],
  ['Google used fallback routing', 'providerNoteFallback'],
  ['Google also suggested routes it could not price', 'providerNoteUnpricedLeftOut'],
];
