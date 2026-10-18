import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Bookmark,
  ChevronDown,
  Clock3,
  House,
  LocateFixed,
  MapPin,
  Plus,
  Route,
  X,
} from 'lucide-react';
import { AUCKLAND_TIME_ZONE } from '@smart-commute/core';
import { openingStatus } from '@smart-commute/providers';
import { ModeIcon, TextField } from '../fields';
import { hasGoogleProvenance } from '../helpers';
import { type PlannerState } from '../types';
import { type PlannerModel } from '../usePlannerModel';
import { renderCarFields, renderOptionEditor, renderSavedRoutes } from './routeEditor';

export const renderLocationRow = (m: PlannerModel, field: 'origin' | 'destination') => {
  const {
    addressSearchEnabled,
    addressSearchPending,
    destinationMissing,
    destinationSearchRef,
    googleMode,
    originMissing,
    originSearchRef,
    plannerId,
    savePlace,
    setState,
    state,
    t,
  } = m;
  const missing = field === 'origin' ? originMissing : destinationMissing;
  const error = missing ? t(field === 'origin' ? 'originRequired' : 'destinationRequired') : '';
  const errorId = `${plannerId}-${field}-error`;
  return (
    <div className="sc-location-row">
      <span
        className={`sc-route-dot ${field === 'destination' ? 'sc-route-dot-end' : ''}`}
        aria-hidden="true"
      />
      {googleMode ? (
        <div
          className={`sc-field sc-live-address ${missing ? 'sc-field-invalid' : ''}`}
          aria-describedby={missing ? errorId : undefined}
        >
          <span>{t(field)}</span>
          <div ref={field === 'origin' ? originSearchRef : destinationSearchRef} />
          {!addressSearchEnabled && (
            <small>{addressSearchPending ? t('googleLoading') : state[field].label}</small>
          )}
          {missing && (
            <small id={errorId} className="sc-error">
              {error}
            </small>
          )}
        </div>
      ) : (
        <TextField
          label={t(field)}
          value={state[field].label}
          onChange={(label) => setState((current) => ({ ...current, [field]: { label } }))}
          error={error || undefined}
        />
      )}
      <button
        className="sc-icon-button"
        aria-label={t(field === 'origin' ? 'saveOrigin' : 'saveDestination')}
        onClick={() => savePlace(state[field])}
      >
        <Bookmark size={16} />
      </button>
    </div>
  );
};

// Arrival = departure plus the selected Google route's outbound time.
export const renderDestinationHours = (m: PlannerModel) => {
  const { departureAt, destinationHours, destinationPlaceId, locale, selected, t } = m;
  if (!destinationPlaceId) return null;
  const entry = destinationHours?.placeId === destinationPlaceId ? destinationHours : undefined;
  const arrivalAt =
    departureAt === undefined
      ? undefined
      : departureAt +
        (selected && hasGoogleProvenance(selected.option)
          ? selected.breakdown.outbound.totalMinutes
          : 0) *
          60000;
  let tone: 'open' | 'closed' | 'neutral' = 'neutral';
  let text = t('placeHoursLoading');
  if (entry?.failed || (entry && !entry.hours)) text = t('placeHoursError');
  else if (entry?.hours && arrivalAt === undefined) text = t('placeHoursNeedTime');
  else if (entry?.hours && arrivalAt !== undefined) {
    const offset = (entry.hours.utcOffsetMinutes ?? 0) * 60000;
    const day = (time: number) => Math.floor((time + offset) / 86_400_000);
    // Times are read in the place's own offset, so they match the opening hours shown.
    const language = locale === 'zh-CN' ? 'zh-CN' : 'en-NZ';
    const placeClock = (time: number) => {
      const clock = new Intl.DateTimeFormat(language, {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(time + offset);
      if (day(time) === day(arrivalAt)) return clock;
      // Weekday and time are joined explicitly so every language keeps a space between them.
      const weekday = new Intl.DateTimeFormat(language, {
        timeZone: 'UTC',
        weekday: 'short',
      }).format(time + offset);
      return `${weekday} ${clock}`;
    };
    const status = openingStatus(entry.hours, arrivalAt);
    const arrival = placeClock(arrivalAt);
    if (status.state === 'open') {
      tone = 'open';
      text = t('placeOpenAtArrival', { arrival, closes: placeClock(status.closesAt) });
    } else if (status.state === 'closed') {
      tone = 'closed';
      text = t('placeClosedAtArrival', {
        arrival,
        opens: status.opensAt === undefined ? '—' : placeClock(status.opensAt),
      });
    } else if (status.state === 'always-open') {
      tone = 'open';
      text = t('placeAlwaysOpen');
    } else if (status.state === 'closed-permanently' || status.state === 'closed-temporarily') {
      tone = 'closed';
      text = t(
        status.state === 'closed-permanently' ? 'placeClosedPermanently' : 'placeClosedTemporarily',
      );
    } else text = t('placeHoursUnknown');
  }
  return (
    <p className="sc-place-hours" data-tone={tone}>
      <Clock3 size={14} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
};

export const renderStopovers = (m: PlannerModel) => {
  const {
    addressSearchEnabled,
    appendDrivingStop,
    beginMapStopoverPick,
    drivingPreference,
    drivingStops,
    editingMode,
    googleMode,
    googleStatus,
    isMobile,
    moveDrivingStop,
    setStopoverDraft,
    setStopoverSearchOpen,
    stopoverDraft,
    stopoverRoutingBlocked,
    stopoverSearchOpen,
    stopoverSearchRef,
    t,
    updateOption,
  } = m;
  return (
    googleMode &&
    drivingPreference &&
    (editingMode === 'drive' || drivingStops.length > 0) && (
      <section className="sc-stopovers" aria-label={t('waypoints')}>
        <div className="sc-stopover-heading">
          <h3>{t('waypoints')}</h3>
          <span>{drivingStops.length}/10</span>
        </div>
        {drivingStops.length > 1 && <p className="sc-help">{t('stopoverHelp')}</p>}
        {drivingStops.length > 0 && (
          <ol className="sc-stopover-list">
            {drivingStops.map((place, index) => (
              <li key={`${index}-${place.label}`}>
                <span className="sc-stopover-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="sc-stopover-label">{place.label}</span>
                <div className="sc-stopover-controls">
                  <button
                    className="sc-icon-button"
                    aria-label={`${t('moveStopoverUp')} ${place.label}`}
                    disabled={index === 0}
                    onClick={() => moveDrivingStop(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="sc-icon-button"
                    aria-label={`${t('moveStopoverDown')} ${place.label}`}
                    disabled={index === drivingStops.length - 1}
                    onClick={() => moveDrivingStop(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="sc-icon-button"
                    aria-label={`${t('removeWaypoint')} ${place.label}`}
                    onClick={() =>
                      updateOption(drivingPreference.id, {
                        waypoints: drivingStops.filter((_, item) => item !== index),
                      })
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {stopoverSearchOpen && editingMode === 'drive' ? (
          <div className="sc-stopover-search">
            <div className="sc-field sc-live-address">
              <span>{t('stopoverSearch')}</span>
              <div ref={stopoverSearchRef} />
            </div>
            <div className="sc-stopover-search-actions">
              <button
                className="sc-small-button"
                disabled={!stopoverDraft.label.trim() || drivingStops.length >= 10}
                onClick={() => appendDrivingStop(stopoverDraft)}
              >
                <Plus size={15} />
                {t('addStopover')}
              </button>
              <button
                className="sc-icon-button"
                aria-label={t('cancelStopoverSearch')}
                onClick={() => {
                  setStopoverSearchOpen(false);
                  setStopoverDraft({ label: '' });
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              className="sc-text-button sc-stopover-add"
              onClick={() => {
                setStopoverDraft({ label: '' });
                setStopoverSearchOpen(true);
              }}
              disabled={
                editingMode !== 'drive' || drivingStops.length >= 10 || !addressSearchEnabled
              }
            >
              <Plus size={16} />
              {t('addStopover')}
            </button>
            {/* Phones have no map toolbar; the route page offers the map pick here. */}
            {isMobile && (
              <button
                className="sc-text-button sc-stopover-add"
                onClick={beginMapStopoverPick}
                disabled={
                  googleStatus !== 'ready' || editingMode !== 'drive' || drivingStops.length >= 10
                }
              >
                <MapPin size={16} />
                {t('pickStopoverOnMap')}
              </button>
            )}
          </>
        )}
        {drivingStops.length >= 10 && <p className="sc-help">{t('stopoverLimit')}</p>}
        {stopoverRoutingBlocked && (
          <p className="sc-error" role="status">
            {t('transitStopoverUnsupported')}
          </p>
        )}
      </section>
    )
  );
};

export const renderSavedPlaces = (m: PlannerModel) => {
  const { setState, state, t } = m;
  return (
    state.places.length > 0 && (
      <details className="sc-saved-places">
        <summary>
          {t('savedPlaces')}
          <ChevronDown size={15} />
        </summary>
        {state.places.map((place) => (
          <div className="sc-saved-place" key={place.label}>
            <span>{place.label}</span>
            <button
              className="sc-icon-button"
              title={t('applyOrigin')}
              aria-label={`${t('applyOrigin')} ${place.label}`}
              onClick={() => setState((current) => ({ ...current, origin: place }))}
            >
              <House size={15} />
            </button>
            <button
              className="sc-icon-button"
              title={t('applyDestination')}
              aria-label={`${t('applyDestination')} ${place.label}`}
              onClick={() => setState((current) => ({ ...current, destination: place }))}
            >
              <MapPin size={15} />
            </button>
            <button
              className="sc-icon-button"
              aria-label={`${t('removePlace')} ${place.label}`}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  places: current.places.filter((saved) => saved.label !== place.label),
                }))
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </details>
    )
  );
};

export const renderLocationSection = (m: PlannerModel) => {
  const {
    beginMapDestinationPick,
    googleMode,
    googleResponse,
    googleStatus,
    isMobile,
    locationError,
    locationLoading,
    plannerId,
    swapPlaces,
    t,
    useLocation,
  } = m;
  return (
    <section className="sc-input-section">
      <h2 id={`${plannerId}-journey`} className="sc-visually-hidden">
        {t('yourJourney')}
      </h2>
      <div className="sc-location-fields">
        {renderLocationRow(m, 'origin')}
        {renderStopovers(m)}
        {renderLocationRow(m, 'destination')}
        {renderDestinationHours(m)}
        <button className="sc-swap" aria-label={t('swap')} onClick={swapPlaces}>
          <ArrowDownUp size={16} />
        </button>
      </div>
      <div className="sc-location-actions">
        <button className="sc-text-button" onClick={useLocation} disabled={locationLoading}>
          <LocateFixed size={15} />
          {t(locationLoading ? 'locating' : 'useLocation')}
        </button>
        {isMobile && googleMode && (
          <button
            className="sc-text-button"
            onClick={beginMapDestinationPick}
            disabled={googleStatus !== 'ready'}
          >
            <MapPin size={15} />
            {t('pickDestinationOnMap')}
          </button>
        )}
      </div>
      {locationError && (
        <p role="alert" className="sc-error">
          {t(locationError)}
        </p>
      )}
      {(!googleMode || !googleResponse) && (
        <p className="sc-help">{t(googleMode ? 'liveAddressHint' : 'manualLocationNote')}</p>
      )}
      {renderSavedPlaces(m)}
    </section>
  );
};

export const renderFoldChoice = (m: PlannerModel, field: 'departure' | 'return') => {
  const { departureEntry, editTime, plannerId, returnEntry, state, t } = m;
  const entry = field === 'departure' ? departureEntry : returnEntry;
  if (entry.resolution.kind !== 'ambiguous') return null;
  const key = field === 'departure' ? 'departureFold' : 'returnFold';
  return (
    <fieldset className="sc-fold-choice">
      <legend>{t('timeRepeated')}</legend>
      {(['earlier', 'later'] as const).map((fold) => (
        <label className="sc-checkbox" key={fold}>
          <input
            type="radio"
            name={`${plannerId}-${field}-fold`}
            checked={state[key] === fold}
            onChange={() => editTime({ [key]: fold })}
          />
          <span>{t(fold === 'earlier' ? 'timeRepeatedEarlier' : 'timeRepeatedLater')}</span>
        </label>
      ))}
    </fieldset>
  );
};

/** Date and time fields with their Auckland-time rules; shared by the wide and phone layouts. */
export const renderTimeFields = (m: PlannerModel) => {
  const {
    browserTimeZone,
    departureEntry,
    departureInvalid,
    editTime,
    returnFieldError,
    showReturnTime,
    state,
    t,
    timeError,
    timesNeedReview,
  } = m;
  return (
    <>
      {(!state.leaveNow || showReturnTime) && (
        <div className="sc-field-grid">
          {!state.leaveNow && (
            <TextField
              type="datetime-local"
              label={t('departure')}
              value={state.departure}
              onChange={(departure) => editTime({ departure, departureFold: undefined })}
              error={
                departureInvalid
                  ? timeError(departureEntry, state.departure, 'departureRequired')
                  : undefined
              }
            />
          )}
          {showReturnTime && (
            <TextField
              type="datetime-local"
              label={t('returnTime')}
              value={state.returnTime}
              onChange={(returnTime) => editTime({ returnTime, returnFold: undefined })}
              error={returnFieldError}
            />
          )}
        </div>
      )}
      {!state.leaveNow && renderFoldChoice(m, 'departure')}
      {showReturnTime && renderFoldChoice(m, 'return')}
      {timesNeedReview && (
        <div className="sc-times-review" role="alert">
          <p>{t('timesNeedReview')}</p>
          <button className="sc-small-button" onClick={() => editTime({})}>
            {t('timesConfirm')}
          </button>
        </div>
      )}
      <p
        className={`sc-help ${browserTimeZone !== AUCKLAND_TIME_ZONE ? 'sc-timezone-warning' : ''}`}
      >
        {t('aucklandTimeNote')}
        {browserTimeZone !== AUCKLAND_TIME_ZONE &&
          ` ${t('browserZoneDiffers', { zone: browserTimeZone })}`}
      </p>
    </>
  );
};

export const renderReturnPolicy = (m: PlannerModel) => {
  const { editTime, googleMode, plannerId, state, t } = m;
  return (
    googleMode &&
    state.settings.roundTrip && (
      <div className="sc-field sc-return-policy">
        <label htmlFor={`${plannerId}-return-policy`}>{t('returnPolicyLabel')}</label>
        <select
          id={`${plannerId}-return-policy`}
          value={state.returnPolicy}
          onChange={(event) =>
            editTime({ returnPolicy: event.target.value as PlannerState['returnPolicy'] })
          }
        >
          <option value="estimate">{t('returnPolicyEstimate')}</option>
          <option value="scheduled">{t('returnPolicyScheduled')}</option>
        </select>
        {state.returnPolicy === 'estimate' && (
          <small className="sc-help">{t('returnEstimateNote')}</small>
        )}
      </div>
    )
  );
};

export const renderScheduleSection = (m: PlannerModel) => {
  const { setState, state, t, updateSettings } = m;
  return (
    <section className="sc-input-section sc-schedule">
      <div className="sc-schedule-toggles">
        <label className="sc-checkbox">
          <input
            type="checkbox"
            checked={state.settings.roundTrip}
            onChange={(event) => updateSettings({ roundTrip: event.target.checked })}
          />
          <span>{t('roundTrip')}</span>
        </label>
        <label className="sc-checkbox">
          <input
            type="checkbox"
            checked={state.leaveNow}
            onChange={(event) =>
              setState((current) => ({ ...current, leaveNow: event.target.checked }))
            }
          />
          <span>{t('leaveNow')}</span>
        </label>
      </div>
      {renderReturnPolicy(m)}
      {renderTimeFields(m)}
    </section>
  );
};

export const renderModeSwitch = (m: PlannerModel) => {
  const {
    comparison,
    editingMode,
    googleMode,
    selectResult,
    selected,
    setEditingMode,
    switchLiveMode,
    t,
  } = m;
  return (
    <div className="sc-mode-switch" role="group" aria-label={t('routeParameters')}>
      {(googleMode
        ? (['drive', 'transit'] as const)
        : (['drive', 'transit', 'hybrid'] as const)
      ).map((mode) => (
        <button
          key={mode}
          className={editingMode === mode ? 'is-active' : ''}
          onClick={() => {
            if (googleMode && mode !== 'hybrid') {
              switchLiveMode(mode);
              return;
            }
            setEditingMode(mode);
            // Keep the summary and schematic on the option being edited.
            const edited = comparison.result?.results.find((result) => result.mode === mode);
            if (!googleMode && edited && selected?.mode !== mode) selectResult(edited);
          }}
          aria-pressed={editingMode === mode}
        >
          <ModeIcon mode={mode} size={16} />
          <span>{t(mode)}</span>
        </button>
      ))}
    </div>
  );
};

// Phones confirm the route page from its footer, so the inline plan button is left out there.
export const renderRoutingActions = (m: PlannerModel, showPlanButton: boolean) => {
  const {
    addressResolving,
    editingMode,
    getGoogleRoutes,
    googleError,
    googleRequests,
    liveMode,
    planDisabled,
    routeLoading,
    t,
  } = m;
  return (
    <div className="sc-routing-actions">
      {showPlanButton && (
        <button
          className="sc-primary-button sc-full-width"
          onClick={() => void getGoogleRoutes(liveMode, { force: true })}
          disabled={planDisabled}
        >
          <Route size={16} />
          {t(
            routeLoading
              ? 'googleRoutesLoading'
              : addressResolving
                ? 'addressResolving'
                : 'planRoute',
          )}
        </button>
      )}
      {googleError && (
        <p className="sc-error" role="alert">
          {googleError}
        </p>
      )}
      {googleRequests > 0 && (
        <small className="sc-help">{t('googleMetrics', { count: googleRequests })}</small>
      )}
      {editingMode === 'transit' && (
        <div className="sc-at-fare-link">
          <a
            href="https://at.govt.nz/bus-train-ferry/journey-planner"
            target="_blank"
            rel="noreferrer"
          >
            {t('verifyATFare')}
          </a>
          <p className="sc-help">{t('atFareLinkHelp')}</p>
        </div>
      )}
    </div>
  );
};

// Fares, fuel, parking and tolls for the option being edited; live routes edit the selected one.
export const renderCostEditors = (m: PlannerModel) => {
  const { addDrivingRoute, editingMode, googleMode, selected, selectedId, t, visibleOptions } = m;
  const editorOptions = visibleOptions.filter(
    (option) =>
      option.mode === editingMode && (!googleMode || option.id === (selected?.id ?? selectedId)),
  );
  return googleMode ? (
    <>
      {editingMode !== 'transit' && renderCarFields(m)}
      {editorOptions.map((option) => renderOptionEditor(m, option, true))}
      {renderSavedRoutes(m)}
    </>
  ) : (
    <>
      <p className="sc-help">{t('routeHint')}</p>
      {editingMode !== 'transit' && renderCarFields(m)}
      {editorOptions.map((option) => renderOptionEditor(m, option, editorOptions.length > 1))}
      {editingMode === 'drive' && (
        <button className="sc-text-button" onClick={addDrivingRoute}>
          <Plus size={15} />
          {t('alternativeRoute')}
        </button>
      )}
      {renderSavedRoutes(m)}
    </>
  );
};

export const renderManualFallback = (m: PlannerModel) => {
  const { googleError, googleMode, online, props, reconnectGoogle, t } = m;
  return (
    props.googleApiKey &&
    !googleMode && (
      <div className="sc-manual-fallback">
        <p>{t(!online ? 'offlineFallback' : 'manualFallback')}</p>
        {googleError && (
          <p className="sc-error" role="alert">
            {googleError}
          </p>
        )}
        <button className="sc-small-button" onClick={reconnectGoogle} disabled={!online}>
          {t('reconnectGoogle')}
        </button>
      </div>
    )
  );
};

export const renderInputs = (m: PlannerModel) => {
  const { googleMode, plannerId, setManualRequested, t } = m;
  return (
    <section className="sc-input-panel" aria-labelledby={`${plannerId}-journey`}>
      {renderLocationSection(m)}
      {renderScheduleSection(m)}
      <section className="sc-input-section">
        <h3 className="sc-section-label">{t('chooseMode')}</h3>
        {renderModeSwitch(m)}
        {googleMode ? (
          <>
            {renderRoutingActions(m, true)}
            <details className="sc-advanced-inputs">
              <summary>
                {t('adjustCosts')}
                <ChevronDown size={16} />
              </summary>
              <div className="sc-advanced-content">{renderCostEditors(m)}</div>
            </details>
          </>
        ) : (
          <div className="sc-mode-editor">{renderCostEditors(m)}</div>
        )}
      </section>
      {renderManualFallback(m)}
      {googleMode && (
        <button className="sc-text-button" onClick={() => setManualRequested(true)}>
          {t('useManualInputs')}
        </button>
      )}
      {!googleMode && <p className="sc-help sc-return-note">{t('estimatedReturn')}</p>}
    </section>
  );
};
