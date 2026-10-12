/** The planner serves Auckland commutes, so entered dates and times are Auckland wall-clock times. */
export const AUCKLAND_TIME_ZONE = 'Pacific/Auckland';

/**
 * How a wall-clock time maps onto real instants in a time zone. A daylight-saving change can
 * skip a local time (nonexistent) or repeat it (ambiguous), so a local time alone is not always
 * one instant.
 */
export type ZonedTimeResolution =
  | { kind: 'valid'; instant: number }
  | { kind: 'ambiguous'; earlier: number; later: number }
  | { kind: 'nonexistent' }
  | { kind: 'invalid' };

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The zone's offset from UTC at an instant, in milliseconds, using the zone's own rules. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - Math.floor(instant / 60000) * 60000;
}

/** Resolves a `YYYY-MM-DDTHH:mm` wall-clock time in an IANA zone to absolute instants. */
export function resolveZonedTime(local: string, timeZone: string): ZonedTimeResolution {
  const match = LOCAL_TIME.exec(local);
  if (!match) return { kind: 'invalid' };
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    return { kind: 'invalid' };
  // Offsets a day either side cover any daylight-saving change near this time.
  const candidates = [
    ...new Set([
      asUtc - offsetAt(asUtc - 86_400_000, timeZone),
      asUtc - offsetAt(asUtc + 86_400_000, timeZone),
    ]),
  ]
    .filter((instant) => {
      const wall = wallClock(instant, timeZone);
      return (
        wall.year === year &&
        wall.month === month &&
        wall.day === day &&
        wall.hour === hour &&
        wall.minute === minute
      );
    })
    .sort((left, right) => left - right);
  if (candidates.length === 0) return { kind: 'nonexistent' };
  if (candidates.length === 1) return { kind: 'valid', instant: candidates[0]! };
  return { kind: 'ambiguous', earlier: candidates[0]!, later: candidates[1]! };
}

/** The `YYYY-MM-DDTHH:mm` wall-clock time of an instant in an IANA zone. */
export function formatZonedTime(instant: number, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${wall.year}-${two(wall.month)}-${two(wall.day)}T${two(wall.hour)}:${two(wall.minute)}`;
}
