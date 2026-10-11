import { describe, expect, it, vi } from 'vitest';
import { GoogleRouteProvider, openingStatus, type PlaceHours } from './index';

const NZDT = 13 * 60;
// Monday 12 October 2026, local NZDT time → UTC instant.
const at = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 9, 12 + day, hour, minute) - NZDT * 60_000;
const weekdays = (open: number, close: number) =>
  [1, 2, 3, 4, 5].map((day) => ({
    open: { day, hour: open, minute: 0 },
    close: { day, hour: close, minute: 0 },
  }));
const hours = (overrides: Partial<PlaceHours> = {}): PlaceHours => ({
  placeId: 'place',
  periods: weekdays(9, 17),
  utcOffsetMinutes: NZDT,
  fetchedAt: 0,
  ...overrides,
});

describe('opening status at arrival', () => {
  it('is open during a period and reports the closing time', () => {
    expect(openingStatus(hours(), at(0, 10, 30))).toEqual({ state: 'open', closesAt: at(0, 17) });
  });

  it('is closed outside a period and reports the next opening, across the weekend', () => {
    expect(openingStatus(hours(), at(0, 18))).toEqual({ state: 'closed', opensAt: at(1, 9) });
    expect(openingStatus(hours(), at(4, 18))).toEqual({ state: 'closed', opensAt: at(7, 9) });
  });

  it('handles periods that run past midnight, including Saturday into Sunday', () => {
    const late = hours({
      periods: [
        { open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } },
        { open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 3, minute: 0 } },
      ],
    });
    expect(openingStatus(late, at(5, 1))).toEqual({ state: 'open', closesAt: at(5, 2) });
    expect(openingStatus(late, at(6, 2))).toEqual({ state: 'open', closesAt: at(6, 3) });
  });

  it('recognises 24-hour places, closures and missing data', () => {
    expect(
      openingStatus(hours({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }), at(0, 3)),
    ).toEqual({
      state: 'always-open',
    });
    expect(openingStatus(hours({ businessStatus: 'CLOSED_PERMANENTLY' }), at(0, 10))).toEqual({
      state: 'closed-permanently',
    });
    expect(openingStatus(hours({ businessStatus: 'CLOSED_TEMPORARILY' }), at(0, 10))).toEqual({
      state: 'closed-temporarily',
    });
    expect(openingStatus(hours({ periods: [] }), at(0, 10))).toEqual({ state: 'unknown' });
    expect(openingStatus(hours({ utcOffsetMinutes: undefined }), at(0, 10))).toEqual({
      state: 'unknown',
    });
  });
});

describe('Google opening hours lookup', () => {
  it('requests only hours fields and asks once per place', async () => {
    const fetchFields = vi.fn(async () => undefined);
    class Place {
      businessStatus = 'OPERATIONAL';
      utcOffsetMinutes = NZDT;
      regularOpeningHours = {
        periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
      };
      fetchFields = fetchFields;
      constructor(public readonly options: { id: string }) {}
    }
    const loadLibrary = vi.fn(async () => ({ Place }));
    const provider = new GoogleRouteProvider({ apiKey: 'test-key', loadLibrary });
    const [first, second] = await Promise.all([
      provider.getPlaceHours('place-1'),
      provider.getPlaceHours('place-1'),
    ]);
    expect(second).toBe(first);
    expect(fetchFields).toHaveBeenCalledTimes(1);
    expect(fetchFields).toHaveBeenCalledWith({
      fields: ['businessStatus', 'regularOpeningHours', 'utcOffsetMinutes'],
    });
    expect(first).toMatchObject({
      placeId: 'place-1',
      businessStatus: 'OPERATIONAL',
      utcOffsetMinutes: NZDT,
      periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
    });
  });
});
