import { useId } from 'react';
import { Car, Layers3, TrainFront } from 'lucide-react';
import { type JourneyOption } from '@smart-commute/core';
import { type Translator } from './types';

export function NumberField({
  label,
  value,
  onChange,
  t,
  step = '0.1',
  max,
  suffix,
  integer = false,
  allowEmpty = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  t: Translator;
  step?: string;
  max?: number;
  suffix?: string;
  integer?: boolean;
  allowEmpty?: boolean;
}) {
  const id = useId();
  const invalid =
    (!Number.isFinite(value) && !(allowEmpty && Number.isNaN(value))) ||
    value < 0 ||
    (max !== undefined && value > max) ||
    (integer && !Number.isInteger(value));
  return (
    <div className={`sc-field ${invalid ? 'sc-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="sc-number-wrap">
        <input
          id={id}
          type="number"
          min="0"
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))
          }
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {invalid && (
        <small id={`${id}-error`} className="sc-error">
          {t('invalidNumber')}
        </small>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  type?: 'text' | 'datetime-local';
}) {
  const id = useId();
  return (
    <div className={`sc-field ${error ? 'sc-field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <small id={`${id}-error`} className="sc-error">
          {error}
        </small>
      )}
    </div>
  );
}

export function ModeIcon({ mode, size = 19 }: { mode: JourneyOption['mode']; size?: number }) {
  return mode === 'drive' ? (
    <Car size={size} />
  ) : mode === 'transit' ? (
    <TrainFront size={size} />
  ) : (
    <Layers3 size={size} />
  );
}
