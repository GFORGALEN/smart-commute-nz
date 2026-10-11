/**
 * Opening hours for a Google place and whether it is open at an arrival instant. Periods use
 * Google's convention: day 0 is Sunday, times are local to the place, and a period without a
 * close time means open 24 hours.
 */

export interface OpeningPoint {
  day: number;
  hour: number;
  minute: number;
}
export interface OpeningPeriod {
  open: OpeningPoint;
  close?: OpeningPoint;
}
export type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
export interface PlaceHours {
  placeId: string;
  businessStatus?: BusinessStatus;
  periods: OpeningPeriod[];
  /** The place's offset from UTC, used to read its local weekday and time. */
  utcOffsetMinutes?: number;
  fetchedAt: number;
}
export type OpeningState =
  | { state: 'open'; closesAt: number }
  | { state: 'closed'; opensAt?: number }
  | { state: 'always-open' }
  | { state: 'closed-permanently' }
  | { state: 'closed-temporarily' }
  | { state: 'unknown' };

const WEEK = 7 * 24 * 60;
const minuteOfWeek = (point: OpeningPoint) => point.day * 1440 + point.hour * 60 + point.minute;

/** Whether a place is open at `at`, and when that next changes. Unknown is never shown as open. */
export function openingStatus(hours: PlaceHours, at: number): OpeningState {
  if (hours.businessStatus === 'CLOSED_PERMANENTLY') return { state: 'closed-permanently' };
  if (hours.businessStatus === 'CLOSED_TEMPORARILY') return { state: 'closed-temporarily' };
  if (!hours.periods.length || hours.utcOffsetMinutes === undefined) return { state: 'unknown' };
  if (hours.periods.some((period) => !period.close)) return { state: 'always-open' };
  const local = new Date(at + hours.utcOffsetMinutes * 60_000);
  const now = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  const intervals = hours.periods.map((period) => {
    const start = minuteOfWeek(period.open);
    let end = minuteOfWeek(period.close!);
    if (end <= start) end += WEEK;
    return { start, end };
  });
  for (const { start, end } of intervals) {
    // A period that runs past Saturday midnight is matched one week later as well.
    for (const moment of [now, now + WEEK]) {
      if (moment >= start && moment < end)
        return { state: 'open', closesAt: at + (end - moment) * 60_000 };
    }
  }
  const nextOpen = Math.min(
    ...intervals.map(({ start }) => (((start - now) % WEEK) + WEEK) % WEEK),
  );
  return { state: 'closed', opensAt: at + nextOpen * 60_000 };
}
