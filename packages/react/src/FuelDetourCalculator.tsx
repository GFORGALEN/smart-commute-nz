import { useId, useState } from 'react';
import { type CommuteSettings, fuelDetourValue } from '@smart-commute/core';
import { type MessageKey } from '@smart-commute/i18n';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export interface FuelDetourCalculatorProps {
  settings: CommuteSettings;
  t: Translate;
  money: (value: number) => string;
}

/** Gaspy and pump boards show cents (289.9); a figure above 20 is read as cents per litre. */
export function parseFuelPrice(text: string): number | undefined {
  const value = Number(text.replace(/[$,\s]/g, ''));
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return undefined;
  return value > 20 ? value / 100 : value;
}
const parseAmount = (text: string) => {
  const value = Number(text.trim());
  return text.trim() && Number.isFinite(value) && value >= 0 ? value : undefined;
};
const decimal = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Is the cheaper station worth the drive? The nearby price and the car's fuel use start from
 * the rider's settings; nothing typed here changes them or is saved.
 */
export function FuelDetourCalculator({ settings, t, money }: FuelDetourCalculatorProps) {
  const id = useId();
  const [nearby, setNearby] = useState(decimal(settings.fuelPrice));
  const [cheaper, setCheaper] = useState('');
  const [litres, setLitres] = useState('40');
  const [extraKm, setExtraKm] = useState('');
  const [consumption, setConsumption] = useState(decimal(settings.fuelConsumption));
  const [minutes, setMinutes] = useState('');
  const [countTime, setCountTime] = useState(false);

  const nearbyPrice = parseFuelPrice(nearby);
  const cheaperPrice = parseFuelPrice(cheaper);
  const fill = parseAmount(litres);
  const distance = parseAmount(extraKm);
  const use = parseAmount(consumption);
  const result =
    nearbyPrice !== undefined &&
    cheaperPrice !== undefined &&
    fill !== undefined &&
    distance !== undefined &&
    use !== undefined
      ? fuelDetourValue({
          nearbyPrice,
          cheaperPrice,
          litres: fill,
          extraKm: distance,
          consumptionPer100Km: use,
          runningCostPerKm: settings.maintenancePerKm + (settings.rucPer1000Km ?? 0) / 1000,
          extraMinutes: countTime ? (parseAmount(minutes) ?? 0) : 0,
          valueOfTimePerHour: countTime ? settings.valueOfTime : 0,
        })
      : undefined;

  const field = (
    key: string,
    label: MessageKey,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <label className="sc-field" htmlFor={`${id}-${key}`}>
      <span>{t(label)}</span>
      <input
        id={`${id}-${key}`}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
  // Fields go in pairs with their hint on a line of its own, so the two columns stay level.
  const hint = (key: MessageKey) => <p className="sc-help sc-fuel-detour-hint">{t(key)}</p>;

  return (
    <section className="sc-page-content sc-fuel-detour">
      <p className="sc-help">{t('fuelDetourIntro')}</p>
      <div className="sc-fuel-detour-grid">
        {field('nearby', 'fuelDetourNearby', nearby, setNearby)}
        {field('cheaper', 'fuelDetourCheaper', cheaper, setCheaper)}
        {hint('fuelDetourPriceHint')}
        {field('litres', 'fuelDetourLitres', litres, setLitres)}
        {field('km', 'fuelDetourExtraKm', extraKm, setExtraKm)}
        {hint('fuelDetourExtraKmHint')}
        {field('consumption', 'fuelConsumption', consumption, setConsumption)}
      </div>
      <label className="sc-checkbox">
        <input
          type="checkbox"
          checked={countTime}
          onChange={(event) => setCountTime(event.target.checked)}
        />
        <span>{t('fuelDetourCountTime', { value: money(settings.valueOfTime) })}</span>
      </label>
      {countTime && field('minutes', 'fuelDetourMinutes', minutes, setMinutes)}

      {!result ? (
        <p className="sc-fuel-detour-empty">{t('fuelDetourFill')}</p>
      ) : (
        <div
          className={`sc-fuel-detour-result ${result.worthIt ? 'is-worth' : 'is-not'}`}
          role="status"
        >
          <strong>
            {result.worthIt
              ? t('fuelDetourWorth', { amount: money(result.net) })
              : t('fuelDetourNotWorth', { amount: money(-result.net) })}
          </strong>
          <dl>
            <div>
              <dt>{t('fuelDetourSaving')}</dt>
              <dd>{money(result.fuelSaving)}</dd>
            </div>
            <div>
              <dt>{t('fuelDetourDriveFuel', { litres: decimal(result.detourLitres) })}</dt>
              <dd>−{money(result.detourFuelCost)}</dd>
            </div>
            <div>
              <dt>{t('fuelDetourWear')}</dt>
              <dd>−{money(result.runningCost)}</dd>
            </div>
            {countTime && (
              <div>
                <dt>{t('fuelDetourTime')}</dt>
                <dd>−{money(result.timeCost)}</dd>
              </div>
            )}
          </dl>
          {result.breakEvenLitres !== undefined && (
            <p>
              {t('fuelDetourLimits', {
                litres: Math.ceil(result.breakEvenLitres),
                km: Math.floor(result.maxExtraKm),
              })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
