export type PassengerType =
  | 'adult'
  | 'under5'
  | 'child'
  | 'secondary'
  | 'tertiary'
  | 'accessible'
  | 'community'
  | 'supergold';
export type FarePayment = 'hop' | 'contactless' | 'cash';

export interface FareJourney {
  /** Combined zone count verified by the user against AT Journey Planner. */
  zones?: number;
  payment: FarePayment;
  cityLink?: boolean;
  manualFare?: number;
  concessionRegistered?: boolean;
  accompaniedByPayingPassenger?: boolean;
  isPublicHoliday?: boolean;
  transferGapsMinutes?: number[];
  journeyDurationMinutes?: number;
  samePaymentMethod?: boolean;
  /** Already paid in the same AT HOP 7-day period, not a calendar week. */
  hopSpendInCurrentPeriod?: number;
  /** Already paid today using the same contactless card/device. */
  contactlessSpendToday?: number;
}

export interface FareQuote {
  amount: number | null;
  currency: 'NZD';
  source: 'manual' | 'at-rule';
  estimated: true;
  requiresManualInput: boolean;
  warnings: string[];
  verifiedOn?: string;
  sourceUrl?: string;
}

export interface FareProvider {
  readonly id: string;
  getFare(journey: FareJourney, passenger: PassengerType, dateTime: Date): FareQuote;
}

/** Published tables, not a guessed percentage. Verified 9 October 2026. */
export const AT_FARE_RULES = {
  verifiedOn: '2026-10-09',
  effectiveFrom: '2026-02-01',
  /** First Auckland travel date this snapshot does not cover; AT reviews fares each February. */
  validUntil: '2027-02-01',
  sourceUpdatedOn: '2026-08-13',
  sourceUrl: 'https://at.govt.nz/bus-train-ferry/fares-and-discounts/public-transport-fare-changes',
  adult: [3, 4.9, 6.5, 7.9],
  concession: [1.55, 2.9, 3.9, 4.75],
  community: [1.5, 2.45, 3.25, 3.95],
  adultCash: [4, 6, 8, 10],
  childCash: [2, 3.5, 4.5, 5.5],
  cityLink: { adult: 0.95, concession: 0.5, community: 0.47, cashAdult: 1, cashChild: 0.5 },
  hop7DayCap: 50,
  contactlessDailyCap: 20,
  transferWindowMinutes: 30,
  maximumJourneyMinutes: 240,
} as const;

function positiveNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function nzDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === name)?.value ?? '';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    weekend: part('weekday') === 'Sat' || part('weekday') === 'Sun',
    hour: Number(part('hour')),
  };
}

/** Whole Auckland days until the fare snapshot stops covering travel; zero or less once it has. */
export function fareSnapshotDaysLeft(now: Date = new Date()): number {
  const day = (value: string) =>
    Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10));
  return Math.round((day(AT_FARE_RULES.validUntil) - day(nzDate(now).day)) / 86_400_000);
}

export class ManualFareProvider implements FareProvider {
  readonly id = 'manual';
  getFare(journey: FareJourney, _passenger: PassengerType, _dateTime: Date): FareQuote {
    const valid = positiveNumber(journey.manualFare);
    return {
      amount: valid ? journey.manualFare! : null,
      currency: 'NZD',
      source: 'manual',
      estimated: true,
      requiresManualInput: !valid,
      warnings: [
        valid
          ? 'User supplied one-way fare; validate it with the operator.'
          : 'Enter a finite, non-negative one-way fare.',
      ],
    };
  }
}

/** Bus/train fare estimates only; does not infer zones from road distance or Google geometry. */
export class ATFareProvider implements FareProvider {
  readonly id = 'at-static';

  getFare(
    journey: FareJourney,
    passenger: PassengerType = 'adult',
    dateTime = new Date(),
  ): FareQuote {
    if (journey.manualFare !== undefined)
      return new ManualFareProvider().getFare(journey, passenger, dateTime);
    const warnings = [
      'Static AT bus/train estimate. Verify zones, concession eligibility and your fare-cap period in AT Journey Planner/MyAT.',
    ];
    const quote = (amount: number | null): FareQuote => ({
      amount,
      currency: 'NZD',
      source: 'at-rule',
      estimated: true,
      requiresManualInput: amount === null,
      warnings,
      verifiedOn: AT_FARE_RULES.verifiedOn,
      sourceUrl: AT_FARE_RULES.sourceUrl,
    });
    const reject = (reason: string): FareQuote => {
      warnings.push(reason);
      return quote(null);
    };
    if (
      !['hop', 'contactless', 'cash'].includes(journey.payment) ||
      ![
        'adult',
        'under5',
        'child',
        'secondary',
        'tertiary',
        'accessible',
        'community',
        'supergold',
      ].includes(passenger)
    ) {
      return reject(
        'Choose a supported payment method and passenger type, or supply a verified manual fare.',
      );
    }
    if (!Number.isFinite(dateTime.getTime()))
      return reject('Choose a valid journey date/time or enter a manual fare.');
    const local = nzDate(dateTime);
    if (local.day < AT_FARE_RULES.effectiveFrom)
      return reject('This fare snapshot does not cover travel before 1 February 2026.');
    if (local.day >= AT_FARE_RULES.validUntil)
      return reject(
        'The annual fare review may have changed this table. Enter a verified manual fare until the snapshot is refreshed.',
      );
    if (passenger === 'under5') {
      return journey.accompaniedByPayingPassenger
        ? quote(0)
        : reject('Under-5 free travel requires an accompanying paying passenger.');
    }
    if (journey.payment === 'cash' && (passenger === 'secondary' || passenger === 'accessible')) {
      return reject(
        'A paper-ticket concession requires separate eligibility/ID verification. Enter the verified ticket fare manually.',
      );
    }
    if (
      !journey.cityLink &&
      (!journey.zones || !Number.isInteger(journey.zones) || journey.zones < 1 || journey.zones > 9)
    ) {
      return reject(
        'Provide a verified fare-zone count (1–9). Zones cannot be inferred reliably from distance alone.',
      );
    }
    const gaps = journey.transferGapsMinutes ?? [];
    if (gaps.some((gap) => !positiveNumber(gap)))
      return reject('Transfer intervals must be finite, non-negative numbers.');
    if (
      gaps.length &&
      (journey.payment === 'cash' ||
        journey.samePaymentMethod !== true ||
        !positiveNumber(journey.journeyDurationMinutes))
    ) {
      return reject(
        'Transfer pricing needs the same HOP/contactless card, tag-off/tag-on intervals and whole-journey duration. Otherwise enter a manual total fare.',
      );
    }
    if (
      gaps.some((gap) => gap > AT_FARE_RULES.transferWindowMinutes) ||
      (journey.journeyDurationMinutes !== undefined &&
        (!positiveNumber(journey.journeyDurationMinutes) ||
          journey.journeyDurationMinutes > AT_FARE_RULES.maximumJourneyMinutes))
    ) {
      return reject(
        'This trip exceeds the 30-minute transfer or 4-hour journey rule. Price its separate journeys manually.',
      );
    }
    const weekendOrHoliday = local.weekend || journey.isPublicHoliday === true;
    let effectivePassenger = passenger;
    if (
      passenger !== 'adult' &&
      !(passenger === 'child' && journey.payment === 'cash') &&
      (journey.payment !== 'hop' || !journey.concessionRegistered)
    ) {
      warnings.push(
        'Concession is not active on a registered HOP card; the applicable adult fare is used.',
      );
      effectivePassenger = 'adult';
    }
    if (
      effectivePassenger === 'child' &&
      journey.payment === 'hop' &&
      journey.concessionRegistered &&
      weekendOrHoliday
    )
      return quote(0);
    if (effectivePassenger === 'supergold') {
      if (weekendOrHoliday || local.hour >= 9) return quote(0);
      effectivePassenger = 'adult';
    }
    if (journey.payment === 'cash')
      warnings.push(
        'Cash fare means a full-price paper ticket; cash/EFTPOS is not accepted on board buses.',
      );
    const index = Math.min(journey.zones ?? 1, 4) - 1;
    let amount: number;
    if (journey.cityLink) {
      amount =
        journey.payment === 'cash'
          ? effectivePassenger === 'child'
            ? AT_FARE_RULES.cityLink.cashChild
            : AT_FARE_RULES.cityLink.cashAdult
          : effectivePassenger === 'adult'
            ? AT_FARE_RULES.cityLink.adult
            : effectivePassenger === 'community'
              ? AT_FARE_RULES.cityLink.community
              : AT_FARE_RULES.cityLink.concession;
    } else {
      const table =
        journey.payment === 'cash'
          ? effectivePassenger === 'child'
            ? AT_FARE_RULES.childCash
            : AT_FARE_RULES.adultCash
          : effectivePassenger === 'adult'
            ? AT_FARE_RULES.adult
            : effectivePassenger === 'community'
              ? AT_FARE_RULES.community
              : AT_FARE_RULES.concession;
      amount = table[index]!;
    }
    if (journey.payment === 'hop' && journey.hopSpendInCurrentPeriod !== undefined) {
      if (!positiveNumber(journey.hopSpendInCurrentPeriod))
        return reject('Enter a valid amount already spent in the same HOP 7-day period.');
      amount = Math.min(
        amount,
        Math.max(0, AT_FARE_RULES.hop7DayCap - journey.hopSpendInCurrentPeriod),
      );
    }
    if (journey.payment === 'contactless' && journey.contactlessSpendToday !== undefined) {
      if (!positiveNumber(journey.contactlessSpendToday))
        return reject('Enter a valid amount already spent today on this contactless card/device.');
      amount = Math.min(
        amount,
        Math.max(0, AT_FARE_RULES.contactlessDailyCap - journey.contactlessSpendToday),
      );
    }
    return quote(Math.round(amount * 100) / 100);
  }
}
