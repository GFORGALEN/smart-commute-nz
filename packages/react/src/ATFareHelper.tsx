import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, Info } from 'lucide-react';
import type { JourneyOption, TravelLeg } from '@smart-commute/core';
import {
  ATFareProvider,
  AT_FARE_RULES,
  type FareQuote,
  type PassengerType,
} from '@smart-commute/providers';
import {
  createFareHelperTranslator,
  formatMoney,
  type Locale,
  type FareHelperMessageKey,
} from '@smart-commute/i18n';

export interface ATFareHelperProps {
  option: JourneyOption;
  locale: Locale;
  onApply: (outboundFare: number, returnFare: number) => void;
  roundTrip: boolean;
  /** Commute departure. First bus/train tag-on is estimated from preceding legs. */
  departureTime: Date;
  /** Independently selected return departure, with its own access legs. */
  returnTime?: Date;
  /** Endpoint context changes invalidate previously verified fare zones. */
  locationContext?: string;
}

type Direction = 'outbound' | 'inbound';
interface DirectionInput {
  zones: string;
  maximumGap: string;
  transfersConfirmed: boolean;
  publicHoliday: boolean;
}
interface DirectionEstimate {
  quote: FareQuote | null;
  error: FareHelperMessageKey | null;
  boardings: number;
  durationMinutes: number;
  boardingDate?: Date;
  accessMinutes: number;
}
const emptyDirection = (): DirectionInput => ({
  zones: '',
  maximumGap: '',
  transfersConfirmed: false,
  publicHoliday: false,
});
const isTransit = (leg: TravelLeg) => leg.mode === 'bus' || leg.mode === 'train';
function firstBoarding(legs: TravelLeg[], departure: Date | undefined) {
  const firstRide = legs.findIndex(isTransit);
  const accessLegs = firstRide < 0 ? [] : legs.slice(0, firstRide);
  const accessMinutes = accessLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
  const validAccess =
    accessLegs.every((leg) => Number.isFinite(leg.durationMinutes) && leg.durationMinutes >= 0) &&
    Number.isFinite(accessMinutes);
  const date =
    firstRide >= 0 && departure && Number.isFinite(departure.getTime()) && validAccess
      ? new Date(departure.getTime() + accessMinutes * 60000)
      : undefined;
  return { accessMinutes, validAccess, date };
}
const passengers: PassengerType[] = [
  'adult',
  'under5',
  'child',
  'secondary',
  'tertiary',
  'accessible',
  'community',
  'supergold',
];

/**
 * User-verified static fare estimator. It does not infer fare zones, fetch AT data,
 * or assume transfer eligibility. Its parent chooses how to assign the total.
 */
export function ATFareHelper({
  option,
  locale,
  onApply,
  roundTrip,
  departureTime,
  returnTime,
  locationContext,
}: ATFareHelperProps) {
  const t = useMemo(() => createFareHelperTranslator(locale), [locale]);
  const provider = useMemo(() => new ATFareProvider(), []);
  const [directions, setDirections] = useState<Record<Direction, DirectionInput>>({
    outbound: emptyDirection(),
    inbound: emptyDirection(),
  });
  const [payment, setPayment] = useState<'hop' | 'contactless'>('hop');
  const [passenger, setPassenger] = useState<PassengerType>('adult');
  const [zonesVerified, setZonesVerified] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [accompanied, setAccompanied] = useState(false);
  const [applied, setApplied] = useState(false);
  const [needsReapplication, setNeedsReapplication] = useState(false);
  const lastAppliedTime = useRef<string | null>(null);
  const helperId = useId();
  const fingerprint = JSON.stringify([
    option.id,
    option.waypoints.map((place) => place.label),
    option.outbound.map((leg) => [leg.mode, leg.durationMinutes, leg.distanceKm, leg.transfers]),
    option.inbound.map((leg) => [leg.mode, leg.durationMinutes, leg.distanceKm, leg.transfers]),
  ]);
  const zoneFingerprint = JSON.stringify([
    option.id,
    option.waypoints.map((place) => place.label),
    option.outbound.map((leg) => [leg.mode, leg.distanceKm, leg.transfers]),
    option.inbound.map((leg) => [leg.mode, leg.distanceKm, leg.transfers]),
  ]);
  const calendarDay = (date: Date | undefined) =>
    date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Pacific/Auckland',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(date)
      : '';
  const outboundBoarding = firstBoarding(option.outbound, departureTime);
  const inboundBoarding = firstBoarding(option.inbound, returnTime);
  const departureDay = calendarDay(outboundBoarding.date);
  const returnDay = calendarDay(inboundBoarding.date);
  // datetime-local inputs have minute precision; avoid invalidating a "leave now"
  // quote just because a parent renders again a few milliseconds later.
  const boardingMinute = (date: Date | undefined) =>
    date && Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 60000) : null;
  const fareTimeFingerprint = JSON.stringify([
    boardingMinute(outboundBoarding.date),
    roundTrip ? boardingMinute(inboundBoarding.date) : null,
  ]);

  // Changes in journey shape/time invalidate a previous transfer attestation.
  // Fare-only changes from applying a quote leave the attestation intact.
  useEffect(() => {
    setDirections((current) => ({
      outbound: { ...current.outbound, transfersConfirmed: false },
      inbound: { ...current.inbound, transfersConfirmed: false },
    }));
    setApplied(false);
  }, [fingerprint]);
  useEffect(() => {
    setZonesVerified(false);
    setApplied(false);
  }, [zoneFingerprint, locationContext]);
  useEffect(() => {
    setDirections((current) => ({
      ...current,
      outbound: { ...current.outbound, publicHoliday: false },
    }));
    setApplied(false);
  }, [departureDay]);
  useEffect(() => {
    setDirections((current) => ({
      ...current,
      inbound: { ...current.inbound, publicHoliday: false },
    }));
    setApplied(false);
  }, [returnDay]);
  useEffect(() => {
    if (lastAppliedTime.current !== null && lastAppliedTime.current !== fareTimeFingerprint) {
      setApplied(false);
      setNeedsReapplication(true);
    }
  }, [fareTimeFingerprint]);

  const updateDirection = (direction: Direction, patch: Partial<DirectionInput>) => {
    setDirections((current) => ({ ...current, [direction]: { ...current[direction], ...patch } }));
    setApplied(false);
    if (patch.zones !== undefined) setZonesVerified(false);
  };

  const estimateDirection = (direction: Direction): DirectionEstimate => {
    const legs = option[direction];
    const transitLegs = legs.filter(isTransit);
    const boarding = direction === 'outbound' ? outboundBoarding : inboundBoarding;
    const fareLegs = legs.filter((leg) => ['bus', 'train', 'walk', 'wait'].includes(leg.mode));
    const durationMinutes = fareLegs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
    const result = (
      error: FareHelperMessageKey | null,
      quote: FareQuote | null = null,
    ): DirectionEstimate => ({
      quote,
      error,
      boardings: transitLegs.length,
      durationMinutes,
      boardingDate: boarding.date,
      accessMinutes: boarding.accessMinutes,
    });
    if (!transitLegs.length) return result('noRide');
    if (!boarding.validAccess) return result('invalidAccessDuration');
    if (
      transitLegs.some(
        (leg) =>
          leg.transfers !== undefined &&
          (!Number.isFinite(leg.transfers) ||
            !Number.isInteger(leg.transfers) ||
            leg.transfers < 0),
      )
    )
      return result('invalidTransfers');
    const declaredTransfers = transitLegs.reduce((sum, leg) => sum + (leg.transfers ?? 0), 0);
    if (declaredTransfers > transitLegs.length - 1) return result('embeddedTransfers');
    if (
      fareLegs.some((leg) => !Number.isFinite(leg.durationMinutes) || leg.durationMinutes < 0) ||
      transitLegs.some((leg) => leg.durationMinutes <= 0)
    )
      return result('invalidDuration');
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return result('invalidDuration');
    if (durationMinutes > AT_FARE_RULES.maximumJourneyMinutes) return result('tooLong');
    const departure = direction === 'outbound' ? departureTime : returnTime;
    if (!departure) return result('returnTimeRequired');
    const date = boarding.date;
    if (!date || !Number.isFinite(date.getTime())) return result('invalidDate');
    const input = directions[direction];
    if (!input.zones) return result('chooseZones');
    if (!zonesVerified) return result('verifyZonesRequired');
    if (passenger === 'under5' && !accompanied) return result('accompanyRequired');
    let transferGapsMinutes: number[] = [];
    if (transitLegs.length > 1) {
      if (!input.transfersConfirmed) return result('transferConfirmation');
      if (!input.maximumGap.trim()) return result('gapRequired');
      const gap = Number(input.maximumGap);
      if (!Number.isFinite(gap) || gap < 0) return result('gapInvalid');
      if (gap > AT_FARE_RULES.transferWindowMinutes) return result('gapTooLong');
      // The user-supplied maximum is a conservative bound for every actual gap.
      transferGapsMinutes = Array.from({ length: transitLegs.length - 1 }, () => gap);
    }
    const quote = provider.getFare(
      {
        zones: Number(input.zones),
        payment,
        concessionRegistered: registered,
        accompaniedByPayingPassenger: accompanied,
        isPublicHoliday: input.publicHoliday,
        transferGapsMinutes,
        journeyDurationMinutes: durationMinutes,
        samePaymentMethod: transitLegs.length > 1 ? input.transfersConfirmed : undefined,
      },
      passenger,
      date,
    );
    return quote.requiresManualInput || quote.amount === null
      ? result('unavailable')
      : result(null, quote);
  };

  const outbound = estimateDirection('outbound');
  const inbound = roundTrip ? estimateDirection('inbound') : null;
  const canApply =
    outbound.quote?.amount !== null &&
    outbound.quote?.amount !== undefined &&
    (!roundTrip || (inbound?.quote?.amount !== null && inbound?.quote?.amount !== undefined));
  const activeDirections: Direction[] = roundTrip ? ['outbound', 'inbound'] : ['outbound'];
  const snapshotDate = (value: string) =>
    new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-NZ', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));
  const boardingTime = (date: Date) =>
    new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-NZ', {
      timeZone: 'Pacific/Auckland',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  const adultFallback =
    passenger !== 'adult' && passenger !== 'under5' && (payment !== 'hop' || !registered);

  return (
    <details className="sc-at-fare-helper" data-testid={`at-fare-helper-${option.id}`}>
      <summary>
        <Info size={14} />
        {t('title')}
        <ChevronDown size={14} />
      </summary>
      <div className="sc-at-fare-helper-content">
        <p className="sc-help">{t('description')}</p>
        <p className="sc-help">
          {t('snapshot', {
            verified: snapshotDate(AT_FARE_RULES.verifiedOn),
            effective: snapshotDate(AT_FARE_RULES.effectiveFrom),
            updated: snapshotDate(AT_FARE_RULES.sourceUpdatedOn),
          })}
        </p>
        <div className="sc-at-source-links">
          <a href={AT_FARE_RULES.sourceUrl} target="_blank" rel="noreferrer">
            {t('source')}
            <ExternalLink size={11} />
          </a>
          <a
            href="https://at.govt.nz/bus-train-ferry/journey-planner"
            target="_blank"
            rel="noreferrer"
          >
            {t('zonesSource')}
            <ExternalLink size={11} />
          </a>
        </div>
        <div className="sc-field-grid">
          <label className="sc-field" htmlFor={`${helperId}-payment`}>
            {t('payment')}
            <select
              id={`${helperId}-payment`}
              value={payment}
              onChange={(event) => {
                setPayment(event.target.value as 'hop' | 'contactless');
                setApplied(false);
              }}
            >
              <option value="hop">{t('hop')}</option>
              <option value="contactless">{t('contactless')}</option>
            </select>
          </label>
          <label className="sc-field" htmlFor={`${helperId}-passenger`}>
            {t('passenger')}
            <select
              id={`${helperId}-passenger`}
              value={passenger}
              onChange={(event) => {
                setPassenger(event.target.value as PassengerType);
                setRegistered(false);
                setAccompanied(false);
                setApplied(false);
              }}
            >
              {passengers.map((type) => (
                <option key={type} value={type}>
                  {t(type)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {passenger !== 'adult' && passenger !== 'under5' && (
          <>
            <label className="sc-checkbox">
              <input
                type="checkbox"
                checked={registered}
                disabled={payment !== 'hop'}
                onChange={(event) => {
                  setRegistered(event.target.checked);
                  setApplied(false);
                }}
              />
              <span>{t('registered')}</span>
            </label>
            <p className="sc-help">{t('concessionNote')}</p>
          </>
        )}
        {passenger === 'under5' && (
          <label className="sc-checkbox">
            <input
              type="checkbox"
              checked={accompanied}
              onChange={(event) => {
                setAccompanied(event.target.checked);
                setApplied(false);
              }}
            />
            <span>{t('accompanied')}</span>
          </label>
        )}
        {adultFallback && (
          <p className="sc-help sc-at-fare-notice">
            <Info size={12} />
            {t('adultFallback')}
          </p>
        )}
        {passenger === 'supergold' && <p className="sc-help">{t('supergoldNote')}</p>}
        {activeDirections.map((direction) => {
          const input = directions[direction];
          const estimate = direction === 'outbound' ? outbound : inbound!;
          const id = `${helperId}-${direction}`;
          const labelKey = direction === 'outbound' ? 'outbound' : 'inbound';
          return (
            <div className="sc-at-fare-direction" key={direction}>
              <h4>{t(labelKey)}</h4>
              <label className="sc-field" htmlFor={`${id}-zones`}>
                {t(direction === 'outbound' ? 'outboundZones' : 'inboundZones')}
                <select
                  id={`${id}-zones`}
                  value={input.zones}
                  onChange={(event) => updateDirection(direction, { zones: event.target.value })}
                >
                  <option value="">{t('unknownZones')}</option>
                  {Array.from({ length: 9 }, (_, index) => (
                    <option value={index + 1} key={index + 1}>
                      {t('zoneCount', { count: index + 1 })}
                    </option>
                  ))}
                </select>
              </label>
              <p className="sc-help">
                {t('durationNote', {
                  boardings: estimate.boardings,
                  minutes: Number.isFinite(estimate.durationMinutes)
                    ? estimate.durationMinutes
                    : '—',
                })}
              </p>
              {estimate.boardingDate && Number.isFinite(estimate.boardingDate.getTime()) && (
                <p className="sc-help sc-at-boarding-time">
                  {t('boardingTime', {
                    direction: t(labelKey),
                    time: boardingTime(estimate.boardingDate),
                    minutes: estimate.accessMinutes,
                  })}
                </p>
              )}
              {estimate.boardings > 1 && (
                <>
                  <label className="sc-field" htmlFor={`${id}-gap`}>
                    {t(direction === 'outbound' ? 'maxGapOutbound' : 'maxGapInbound')}
                    <input
                      id={`${id}-gap`}
                      type="number"
                      min="0"
                      step="1"
                      value={input.maximumGap}
                      onChange={(event) =>
                        updateDirection(direction, { maximumGap: event.target.value })
                      }
                      aria-invalid={['gapInvalid', 'gapTooLong'].includes(estimate.error ?? '')}
                    />
                  </label>
                  <p className="sc-help">{t('transferNote')}</p>
                  <label className="sc-checkbox">
                    <input
                      type="checkbox"
                      checked={input.transfersConfirmed}
                      onChange={(event) =>
                        updateDirection(direction, { transfersConfirmed: event.target.checked })
                      }
                    />
                    <span>
                      {t(direction === 'outbound' ? 'confirmOutbound' : 'confirmInbound')}
                    </span>
                  </label>
                </>
              )}
              <label className="sc-checkbox">
                <input
                  type="checkbox"
                  checked={input.publicHoliday}
                  onChange={(event) =>
                    updateDirection(direction, { publicHoliday: event.target.checked })
                  }
                />
                <span>{t(direction === 'outbound' ? 'holidayOutbound' : 'holidayInbound')}</span>
              </label>
              {estimate.error && (
                <p className="sc-help sc-at-fare-error" role="status">
                  {t(estimate.error)}
                </p>
              )}
              {estimate.quote?.amount !== null && estimate.quote?.amount !== undefined && (
                <strong className="sc-at-fare-quote" role="status">
                  {t('estimate', {
                    direction: t(labelKey),
                    amount: formatMoney(estimate.quote.amount, locale),
                  })}
                </strong>
              )}
            </div>
          );
        })}
        <label className="sc-checkbox">
          <input
            type="checkbox"
            checked={zonesVerified}
            onChange={(event) => {
              setZonesVerified(event.target.checked);
              setApplied(false);
            }}
          />
          <span>{t('verifyZones')}</span>
        </label>
        <p className="sc-help">{t('holidayNote')}</p>
        <p className="sc-help">{t('inputNote')}</p>
        <p className="sc-help">{t('boardingNote')}</p>
        {canApply && roundTrip && (
          <p className="sc-at-fare-total">
            {t('roundTripEstimate', {
              amount: formatMoney(outbound.quote!.amount! + inbound!.quote!.amount!, locale),
            })}
          </p>
        )}
        {canApply && (outbound.quote?.amount === 0 || inbound?.quote?.amount === 0) && (
          <p className="sc-help">{t('freeFare')}</p>
        )}
        <p className="sc-help">{t('replaceNotice')}</p>
        <button
          className="sc-small-button sc-full-width"
          disabled={!canApply}
          onClick={() => {
            if (!canApply) return;
            onApply(outbound.quote!.amount!, roundTrip ? inbound!.quote!.amount! : 0);
            lastAppliedTime.current = fareTimeFingerprint;
            setNeedsReapplication(false);
            setApplied(true);
          }}
        >
          {applied ? <Check size={14} /> : <Info size={14} />}
          {t('apply')}
        </button>
        {applied && (
          <p className="sc-help" role="status">
            {t('applied')}
          </p>
        )}
        {needsReapplication && (
          <p className="sc-help sc-at-fare-error" role="status">
            {t('reapplyAfterTimeChange')}
          </p>
        )}
        <p className="sc-help">{t('staticOnly')}</p>
        <p className="sc-help">{t('capsNote')}</p>
      </div>
    </details>
  );
}
