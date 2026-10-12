import { describe, expect, it } from 'vitest';
import { AUCKLAND_TIME_ZONE, formatZonedTime, resolveZonedTime } from './zoned-time';

describe('Auckland wall-clock times', () => {
  it('resolves daylight time and standard time with the offset for that date', () => {
    expect(resolveZonedTime('2026-10-13T08:00', AUCKLAND_TIME_ZONE)).toEqual({
      kind: 'valid',
      instant: Date.UTC(2026, 9, 12, 19, 0),
    });
    expect(resolveZonedTime('2026-06-15T08:00', AUCKLAND_TIME_ZONE)).toEqual({
      kind: 'valid',
      instant: Date.UTC(2026, 5, 14, 20, 0),
    });
  });

  it('rejects a time skipped when daylight time starts', () => {
    expect(resolveZonedTime('2026-09-27T02:30', AUCKLAND_TIME_ZONE)).toEqual({
      kind: 'nonexistent',
    });
  });

  it('offers both instants for a time repeated when daylight time ends', () => {
    expect(resolveZonedTime('2026-04-05T02:30', AUCKLAND_TIME_ZONE)).toEqual({
      kind: 'ambiguous',
      earlier: Date.UTC(2026, 3, 4, 13, 30),
      later: Date.UTC(2026, 3, 4, 14, 30),
    });
  });

  it('rejects malformed and impossible dates', () => {
    expect(resolveZonedTime('2026-02-30T08:00', AUCKLAND_TIME_ZONE).kind).toBe('invalid');
    expect(resolveZonedTime('2026-10-13 08:00', AUCKLAND_TIME_ZONE).kind).toBe('invalid');
    expect(resolveZonedTime('', AUCKLAND_TIME_ZONE).kind).toBe('invalid');
  });

  it('formats an instant back to the Auckland wall clock, across midnight', () => {
    expect(formatZonedTime(Date.UTC(2026, 9, 12, 19, 0), AUCKLAND_TIME_ZONE)).toBe(
      '2026-10-13T08:00',
    );
    expect(formatZonedTime(Date.UTC(2026, 9, 13, 11, 30), AUCKLAND_TIME_ZONE)).toBe(
      '2026-10-14T00:30',
    );
  });
});
