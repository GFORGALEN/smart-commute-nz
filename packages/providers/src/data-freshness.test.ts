import { describe, expect, it } from 'vitest';
import { AT_FARE_RULES, fareSnapshotDaysLeft } from './fares';

/**
 * Runs on the real clock, so CI starts failing a month before the AT fare snapshot stops
 * covering travel; the weekly data-freshness workflow runs it even without new commits.
 */
describe('data freshness', () => {
  it('keeps the AT fare snapshot refreshed at least 30 days before it expires', () => {
    expect(
      fareSnapshotDaysLeft(),
      `AT_FARE_RULES covers travel until ${AT_FARE_RULES.validUntil}. Check ${AT_FARE_RULES.sourceUrl} for the new table, then update the amounts, dates and validUntil.`,
    ).toBeGreaterThan(30);
  });
});

describe('fareSnapshotDaysLeft', () => {
  it('counts Auckland calendar days to the first uncovered date', () => {
    // 11:30 UTC on 31 January is already 1 February in Auckland (UTC+13).
    expect(fareSnapshotDaysLeft(new Date('2027-01-31T10:59:00Z'))).toBe(1);
    expect(fareSnapshotDaysLeft(new Date('2027-01-31T11:00:00Z'))).toBe(0);
    expect(fareSnapshotDaysLeft(new Date('2027-01-02T00:00:00+13:00'))).toBe(30);
    expect(fareSnapshotDaysLeft(new Date('2027-03-01T12:00:00+13:00'))).toBe(-28);
  });
});
