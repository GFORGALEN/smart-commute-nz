import { Bookmark, ChevronDown, Info, MapPin, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type JourneyOption,
  type TravelLeg,
  type VehicleKind,
} from '@smart-commute/core';
import { type MessageKey } from '@smart-commute/i18n';
import { NZ_FUEL_PRICES, fuelPriceFor } from '@smart-commute/providers';
import { ATFareHelper } from '../../ATFareHelper';
import { directionKeys, legKeys } from '../constants';
import { NumberField, TextField } from '../fields';
import {
  atFareContext,
  cloneOption,
  hasGoogleProvenance,
  shortNumber,
  usesATFare,
} from '../helpers';
import { type Direction } from '../types';
import { type PlannerModel } from '../usePlannerModel';

export const renderDriveLeg = (
  m: PlannerModel,
  option: JourneyOption,
  direction: Direction,
  index: number,
  showDistance = true,
) => {
  const { driveDistanceLabel, drivingPreference, state, t, updateDrivingCosts, updateLeg } = m;
  const leg = option[direction][index];
  const directionName = t(directionKeys[direction]);
  return (
    <div className="sc-driving-fields" key={`${direction}-${index}`}>
      <div className="sc-field-grid">
        {hasGoogleProvenance(option) ? (
          <div className="sc-route-measurements">
            <div>
              <span>{t('legDistance', { direction: directionName })}</span>
              <input
                aria-label={t('legDistance', { direction: directionName })}
                readOnly
                value={shortNumber(leg.distanceKm ?? 0)}
              />
            </div>
            <div>
              <span>{t('legDuration', { direction: directionName })}</span>
              <input
                aria-label={t('legDuration', { direction: directionName })}
                readOnly
                value={shortNumber(leg.durationMinutes)}
              />
            </div>
          </div>
        ) : (
          <>
            {showDistance && (
              <NumberField
                label={driveDistanceLabel(option, direction)}
                value={leg.distanceKm ?? 0}
                onChange={(distanceKm) => updateLeg(option.id, direction, index, { distanceKm })}
                t={t}
              />
            )}
            <NumberField
              label={t('legDuration', { direction: directionName })}
              value={leg.durationMinutes}
              onChange={(durationMinutes) =>
                updateLeg(option.id, direction, index, { durationMinutes })
              }
              t={t}
              step="1"
            />
            <NumberField
              label={t('legConsumption', { direction: directionName })}
              value={leg.fuelConsumption ?? state.settings.fuelConsumption}
              onChange={(fuelConsumption) =>
                updateLeg(option.id, direction, index, { fuelConsumption })
              }
              t={t}
            />
          </>
        )}
        <NumberField
          label={t('legToll', { direction: directionName })}
          value={leg.toll ?? 0}
          onChange={(toll) =>
            hasGoogleProvenance(option) || option.id === drivingPreference?.id
              ? updateDrivingCosts(
                  direction === 'outbound' ? { outboundToll: toll } : { inboundToll: toll },
                )
              : updateLeg(option.id, direction, index, { toll })
          }
          t={t}
        />
      </div>
      {leg.fuelConsumption !== undefined && (
        <button
          className="sc-text-button"
          onClick={() => updateLeg(option.id, direction, index, { fuelConsumption: undefined })}
        >
          {t('useDefaultConsumption')}
        </button>
      )}
    </div>
  );
};

export const renderTransitLeg = (
  m: PlannerModel,
  option: JourneyOption,
  direction: Direction,
  index: number,
  showPrimaryFare = true,
) => {
  const {
    firstLegIndex,
    moneyWithRange,
    t,
    transitFareLabel,
    updateLeg,
    updateLiveTransitFare,
    updateOption,
  } = m;
  const leg = option[direction][index];
  const live = hasGoogleProvenance(option);
  if (live && leg.mode !== 'bus' && leg.mode !== 'train')
    return (
      <div className="sc-live-step" key={`${direction}-${index}`}>
        <span>{t(legKeys[leg.mode])}</span>
        <strong>{t('minutes', { count: shortNumber(leg.durationMinutes) })}</strong>
      </div>
    );
  const transitIndex = firstLegIndex(option[direction], 'transit');
  const fareLabel =
    index === transitIndex
      ? transitFareLabel(option, direction)
      : t('segmentFare', { mode: t(legKeys[leg.mode]) });
  const showFare = live ? index === transitIndex : showPrimaryFare || index !== transitIndex;
  return (
    <div className="sc-transit-segment" key={`${direction}-${index}`}>
      <div className="sc-segment-head">
        <label>
          {t('legType')}
          {live ? (
            <input aria-label={t('legType')} readOnly value={t(legKeys[leg.mode])} />
          ) : (
            <select
              value={leg.mode}
              onChange={(event) =>
                updateLeg(option.id, direction, index, {
                  mode: event.target.value as TravelLeg['mode'],
                  fare: ['bus', 'train'].includes(event.target.value) ? (leg.fare ?? 0) : undefined,
                  transfers: 0,
                })
              }
            >
              {(['bus', 'train', 'walk', 'wait', 'parking'] as const).map((mode) => (
                <option value={mode} key={mode}>
                  {t(legKeys[mode])}
                </option>
              ))}
            </select>
          )}
        </label>
        {!live && (
          <button
            className="sc-icon-button"
            aria-label={t('removeSegment')}
            onClick={() =>
              updateOption(option.id, {
                [direction]: option[direction].filter((_, segmentIndex) => segmentIndex !== index),
              })
            }
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="sc-field-grid">
        {live ? (
          <label className="sc-route-measurements">
            <span>{t('segmentDuration', { mode: t(legKeys[leg.mode]) })}</span>
            <input
              aria-label={t('segmentDuration', { mode: t(legKeys[leg.mode]) })}
              readOnly
              value={shortNumber(leg.durationMinutes)}
            />
          </label>
        ) : (
          <NumberField
            label={t('segmentDuration', { mode: t(legKeys[leg.mode]) })}
            value={leg.durationMinutes}
            onChange={(durationMinutes) =>
              updateLeg(option.id, direction, index, { durationMinutes })
            }
            t={t}
            step="1"
          />
        )}
        {['bus', 'train'].includes(leg.mode) && (
          <>
            {showFare && (
              <NumberField
                label={fareLabel}
                value={live ? (leg.fare ?? Number.NaN) : (leg.fare ?? 0)}
                allowEmpty={live && leg.fare === undefined && Boolean(leg.fareRange)}
                onChange={(fare) =>
                  live
                    ? updateLiveTransitFare(
                        option,
                        direction,
                        Number.isNaN(fare) ? undefined : fare,
                      )
                    : updateLeg(option.id, direction, index, {
                        fare,
                        fareRange: undefined,
                        fareSource: 'manual',
                      })
                }
                t={t}
              />
            )}
            {live ? (
              <label className="sc-route-measurements">
                <span>{t('transfers')}</span>
                <input aria-label={t('transfers')} readOnly value={leg.transfers ?? 0} />
              </label>
            ) : (
              <NumberField
                label={t('transfers')}
                value={leg.transfers ?? 0}
                onChange={(transfers) => updateLeg(option.id, direction, index, { transfers })}
                t={t}
                step="1"
                integer
              />
            )}
          </>
        )}
      </div>
      {leg.fare === undefined && leg.fareRange && (
        <div className="sc-fare-range-note">
          <strong>
            {t('fareRangeBadge')}: {moneyWithRange(leg.fareRange.max, leg.fareRange)}
          </strong>
          <p>{t(leg.fareRange.basis === 'citylink' ? 'cityLinkFareRangeHelp' : 'fareRangeHelp')}</p>
          <p>{t('actualFareHint')}</p>
        </div>
      )}
      {leg.transit && (
        <div className="sc-transit-details">
          <span>{leg.transit.lineShortName || leg.transit.lineName}</span>
          {leg.transit.departureStop && leg.transit.arrivalStop && (
            <span>
              {leg.transit.departureStop} → {leg.transit.arrivalStop}
            </span>
          )}
          {leg.transit.stopCount !== undefined && (
            <span>{t('transitStopCount', { count: leg.transit.stopCount })}</span>
          )}
          {index === transitIndex && <small>{t('transitStopCountHelp')}</small>}
        </div>
      )}
    </div>
  );
};

export const renderDirections = (
  m: PlannerModel,
  option: JourneyOption,
  essentialsShown: boolean,
) => {
  const { firstLegIndex, includedDirections, t, updateOption } = m;
  return includedDirections.map((direction) => {
    const firstDrive = firstLegIndex(option[direction], 'drive');
    const firstTransit = firstLegIndex(option[direction], 'transit');
    return (
      <details className="sc-direction" open={direction === 'outbound'} key={direction}>
        <summary>
          {t(directionKeys[direction])}
          <ChevronDown size={16} />
        </summary>
        <div className="sc-direction-body">
          {option[direction].map((leg, index) =>
            leg.mode === 'drive'
              ? renderDriveLeg(
                  m,
                  option,
                  direction,
                  index,
                  !essentialsShown || index !== firstDrive,
                )
              : renderTransitLeg(
                  m,
                  option,
                  direction,
                  index,
                  !essentialsShown || index !== firstTransit,
                ),
          )}
          {option.mode !== 'drive' && !hasGoogleProvenance(option) && (
            <button
              className="sc-small-button"
              onClick={() =>
                updateOption(option.id, {
                  [direction]: [
                    ...option[direction],
                    { mode: 'walk', durationMinutes: 5, source: 'manual', estimated: true },
                  ],
                })
              }
            >
              <Plus size={15} />
              {t('addSegment')}
            </button>
          )}
        </div>
      </details>
    );
  });
};

export const renderFareHelper = (m: PlannerModel, option: JourneyOption) => {
  const { currentMinute, departureAt, locale, returnAt, setATFareContexts, state, updateOption } =
    m;
  return (
    <ATFareHelper
      option={option}
      locale={locale}
      roundTrip={state.settings.roundTrip}
      locationContext={JSON.stringify([state.origin, state.destination])}
      departureTime={new Date(departureAt ?? Date.now())}
      returnTime={returnAt !== undefined ? new Date(returnAt) : undefined}
      onApply={(outboundFare, returnFare) => {
        setATFareContexts((current) => ({
          ...current,
          [option.id]: atFareContext(option, state, currentMinute),
        }));
        const assign = (legs: TravelLeg[], fare: number) => {
          const first = legs.findIndex((leg) => leg.mode === 'bus' || leg.mode === 'train');
          return legs.map((leg, index): TravelLeg =>
            leg.mode === 'bus' || leg.mode === 'train'
              ? {
                  ...leg,
                  fare: index === first ? fare : 0,
                  fareRange: undefined,
                  fareSource: 'at-rule',
                  source: hasGoogleProvenance(option) ? leg.source : 'at-rule',
                  estimated: true,
                }
              : leg,
          );
        };
        updateOption(option.id, {
          outbound: assign(option.outbound, outboundFare),
          ...(state.settings.roundTrip ? { inbound: assign(option.inbound, returnFare) } : {}),
        });
      }}
    />
  );
};

// The values that decide most of a manual estimate stay visible; the rest is one click away.
export const renderEssentials = (m: PlannerModel, option: JourneyOption) => {
  const {
    driveDistanceLabel,
    drivingPreference,
    firstLegIndex,
    includedDirections,
    placeLabel,
    t,
    transitFareLabel,
    updateDrivingCosts,
    updateLeg,
    updateOption,
  } = m;
  return (
    <>
      {!['drive', 'transit', 'hybrid'].includes(option.id) && (
        <TextField
          label={t('routeName')}
          value={option.name}
          onChange={(name) => updateOption(option.id, { name })}
        />
      )}
      {option.mode === 'hybrid' && (
        <TextField
          label={t('hub')}
          value={placeLabel(option.waypoints[0]?.label ?? '')}
          onChange={(label) =>
            updateOption(option.id, {
              waypoints: [{ label }, ...option.waypoints.slice(1)],
              parkingVerified: false,
            })
          }
        />
      )}
      <div className="sc-field-grid">
        {option.mode !== 'transit' &&
          includedDirections.map((direction) => {
            const index = firstLegIndex(option[direction], 'drive');
            const leg = option[direction][index];
            if (!leg) return null;
            return (
              <NumberField
                key={`distance-${direction}`}
                label={driveDistanceLabel(option, direction)}
                value={leg.distanceKm ?? 0}
                onChange={(distanceKm) => updateLeg(option.id, direction, index, { distanceKm })}
                t={t}
              />
            );
          })}
        {option.mode !== 'drive' &&
          includedDirections.map((direction) => {
            const index = firstLegIndex(option[direction], 'transit');
            const leg = option[direction][index];
            if (!leg) return null;
            return (
              <NumberField
                key={`fare-${direction}`}
                label={transitFareLabel(option, direction)}
                value={leg.fare ?? 0}
                onChange={(fare) =>
                  updateLeg(option.id, direction, index, {
                    fare,
                    fareRange: undefined,
                    fareSource: 'manual',
                  })
                }
                t={t}
              />
            );
          })}
        {option.mode !== 'transit' && (
          <NumberField
            label={t(option.mode === 'hybrid' ? 'stationParking' : 'parking')}
            value={option.parkingCost}
            onChange={(parkingCost) =>
              option.id === drivingPreference?.id
                ? updateDrivingCosts({ parkingCost })
                : updateOption(option.id, { parkingCost, parkingVerified: false })
            }
            t={t}
          />
        )}
      </div>
      {option.mode === 'hybrid' && (
        <>
          <p className="sc-parking-alert">
            <Info size={16} />
            <span>{t('parkingUnknown')}</span>
          </p>
          <label className="sc-checkbox">
            <input
              type="checkbox"
              checked={Boolean(option.parkingVerified)}
              onChange={(event) =>
                updateOption(option.id, { parkingVerified: event.target.checked })
              }
            />
            <span>{t('parkingAcknowledgment')}</span>
          </label>
        </>
      )}
    </>
  );
};

export const renderWaypoints = (m: PlannerModel, option: JourneyOption) => {
  const { addWaypoint, setWaypointDraft, t, updateOption, waypointDraft } = m;
  return (
    <div className="sc-waypoints">
      <h4>{t('waypoints')}</h4>
      <p className="sc-help">{t('waypointNote')}</p>
      {option.waypoints.map((place, index) => (
        <div className="sc-waypoint-chip" key={`${index}-${place.label}`}>
          <MapPin size={15} />
          <span>{place.label}</span>
          <button
            className="sc-icon-button"
            aria-label={`${t('removeWaypoint')} ${place.label}`}
            onClick={() =>
              updateOption(option.id, {
                waypoints: option.waypoints.filter((_, placeIndex) => placeIndex !== index),
              })
            }
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <div className="sc-inline-field">
        <input
          aria-label={t('waypoints')}
          placeholder={t('waypointPlaceholder')}
          value={waypointDraft}
          onChange={(event) => setWaypointDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addWaypoint(option);
          }}
        />
        <button
          className="sc-icon-button sc-solid"
          aria-label={t('addWaypoint')}
          disabled={!waypointDraft.trim()}
          onClick={() => addWaypoint(option)}
        >
          <Plus size={17} />
        </button>
      </div>
    </div>
  );
};

export const renderOptionEditor = (m: PlannerModel, option: JourneyOption, showTitle: boolean) => {
  const { comparison, nameOf, saveRoute, setState, t, updateDrivingCosts } = m;
  const live = hasGoogleProvenance(option);
  return (
    <div key={option.id} className="sc-option-editor" data-testid={`route-editor-${option.id}`}>
      {(showTitle || live) && (
        <div className="sc-editor-title">
          <h3>{nameOf(option)}</h3>
          {option.id !== 'drive' && option.mode === 'drive' && !live && (
            <button
              className="sc-icon-button"
              aria-label={t('removeRoute')}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  options: current.options.filter((route) => route.id !== option.id),
                }))
              }
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
      {live ? (
        <>
          {renderDirections(m, option, false)}
          {option.mode !== 'transit' && (
            <NumberField
              label={t('parking')}
              value={option.parkingCost}
              onChange={(parkingCost) => updateDrivingCosts({ parkingCost })}
              t={t}
            />
          )}
          {option.mode !== 'drive' && renderFareHelper(m, option)}
        </>
      ) : (
        <>
          {renderEssentials(m, option)}
          {option.mode !== 'drive' && renderFareHelper(m, option)}
          <details className="sc-more-details">
            <summary>
              {t('moreRouteDetails')}
              <ChevronDown size={16} />
            </summary>
            <div className="sc-more-details-body">
              {renderDirections(m, option, true)}
              {option.mode === 'drive' && renderWaypoints(m, option)}
              <button
                className="sc-text-button"
                disabled={comparison.error}
                onClick={() => saveRoute(option)}
              >
                <Bookmark size={15} />
                {t('saveRoute')}
              </button>
            </div>
          </details>
        </>
      )}
    </div>
  );
};

const vehicleLabels: Record<VehicleKind, MessageKey> = {
  petrol: 'vehiclePetrol',
  diesel: 'vehicleDiesel',
  hybrid: 'vehicleHybrid',
  'plug-in-hybrid': 'vehiclePlugInHybrid',
  electric: 'vehicleElectric',
};

/** The vehicle and what it runs on; only the fields that apply to its type are shown. */
// Says where the fuel price comes from: MBIE's weekly average, followed until a price is typed,
// or the rider's own, with a way back to the average.
const renderFuelPriceSource = (m: PlannerModel) => {
  const { applyAverageFuelPrice, followsAverageFuel, money, props, state, t } = m;
  const average = fuelPriceFor(state.settings.vehicleKind);
  if (!props.googleApiKey || average === undefined) return null;
  if (followsAverageFuel)
    return (
      <p className="sc-help">{t('fuelFollowsAverage', { date: NZ_FUEL_PRICES.weekEnding })}</p>
    );
  return (
    <p className="sc-help">
      {t('fuelYours')}{' '}
      <button className="sc-text-button" onClick={applyAverageFuelPrice}>
        {t('fuelUseThis', { price: money(average) })}
      </button>
    </p>
  );
};

export const renderCarFields = (m: PlannerModel) => {
  const { chooseVehicle, state, t, updateSettings } = m;
  const { settings } = state;
  const kind = settings.vehicleKind ?? 'petrol';
  const usesFuel = kind !== 'electric';
  const usesBattery = kind === 'electric' || kind === 'plug-in-hybrid';
  const paysRuc = kind === 'diesel' || usesBattery || (settings.rucPer1000Km ?? 0) > 0;
  return (
    <div className="sc-car-fields">
      <label className="sc-field">
        <span>{t('vehicleKind')}</span>
        <select value={kind} onChange={(event) => chooseVehicle(event.target.value as VehicleKind)}>
          {(Object.keys(vehicleLabels) as VehicleKind[]).map((option) => (
            <option key={option} value={option}>
              {t(vehicleLabels[option])}
            </option>
          ))}
        </select>
      </label>
      <p className="sc-help">{t('vehiclePresetHelp')}</p>
      <div className="sc-field-grid">
        {usesFuel && (
          <>
            <div className="sc-fuel-price-field">
              <NumberField
                label={t('fuelPrice')}
                value={settings.fuelPrice}
                onChange={(fuelPrice) => updateSettings({ fuelPrice })}
                t={t}
              />
              {renderFuelPriceSource(m)}
            </div>
            <NumberField
              label={t(kind === 'plug-in-hybrid' ? 'fuelConsumptionOnFuel' : 'fuelConsumption')}
              value={settings.fuelConsumption}
              onChange={(fuelConsumption) => updateSettings({ fuelConsumption })}
              t={t}
            />
          </>
        )}
        {usesBattery && (
          <>
            <NumberField
              label={t('electricityPrice')}
              value={settings.electricityPrice ?? DEFAULT_SETTINGS.electricityPrice!}
              onChange={(electricityPrice) => updateSettings({ electricityPrice })}
              t={t}
              step="0.01"
            />
            <NumberField
              label={t('electricityConsumption')}
              value={settings.electricityConsumption ?? DEFAULT_SETTINGS.electricityConsumption!}
              onChange={(electricityConsumption) => updateSettings({ electricityConsumption })}
              t={t}
            />
          </>
        )}
        {kind === 'plug-in-hybrid' && (
          <NumberField
            label={t('electricSharePercent')}
            value={Math.round((settings.electricShare ?? DEFAULT_SETTINGS.electricShare!) * 100)}
            onChange={(percent) => updateSettings({ electricShare: percent / 100 })}
            t={t}
            step="5"
            max={100}
          />
        )}
        {paysRuc && (
          <NumberField
            label={t('rucPer1000Km')}
            value={settings.rucPer1000Km ?? 0}
            onChange={(rucPer1000Km) => updateSettings({ rucPer1000Km })}
            t={t}
            step="1"
          />
        )}
      </div>
      {usesBattery && <p className="sc-help">{t('electricityExplanation')}</p>}
      {paysRuc && <p className="sc-help">{t('rucExplanation')}</p>}
    </div>
  );
};

export const renderSavedRoutes = (m: PlannerModel) => {
  const { nameOf, setATFareContexts, setEditingMode, setState, state, t } = m;
  return (
    state.savedRoutes.length > 0 && (
      <details className="sc-saved-places">
        <summary>
          {t('savedRoutes')}
          <ChevronDown size={15} />
        </summary>
        {state.savedRoutes.map((option) => (
          <div className="sc-saved-place" key={option.id}>
            <span>{nameOf(option)}</span>
            <button
              className="sc-icon-button"
              aria-label={`${t('loadRoute')} ${nameOf(option)}`}
              onClick={() => {
                if (usesATFare(option, state.settings.roundTrip))
                  setATFareContexts((current) => {
                    const next = { ...current };
                    delete next[option.id];
                    return next;
                  });
                setState((current) => ({
                  ...current,
                  options: [
                    ...current.options.filter((route) => route.id !== option.id),
                    cloneOption(option),
                  ],
                }));
                setEditingMode(option.mode);
              }}
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="sc-icon-button"
              aria-label={`${t('deleteSavedRoute')} ${nameOf(option)}`}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  savedRoutes: current.savedRoutes.filter((route) => route.id !== option.id),
                }))
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </details>
    )
  );
};
