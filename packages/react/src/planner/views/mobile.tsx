import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock3,
  CloudSun,
  LocateFixed,
  MapPin,
  Plus,
  Route,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { type RouteResult } from '@smart-commute/core';
import { type MessageKey } from '@smart-commute/i18n';
import { WeatherBar } from '../../WeatherBar';
import { ModeIcon } from '../fields';
import { type MobilePage } from '../types';
import { type PlannerModel } from '../usePlannerModel';
import {
  renderCostEditors,
  renderDestinationHours,
  renderManualFallback,
  renderModeSwitch,
  renderSavedPlaces,
  renderStopovers,
  renderTimeFields,
} from './journeyInputs';
import {
  renderBreakdown,
  renderComparison,
  renderGoogleAttribution,
  renderSchematic,
} from './results';
import {
  renderAbout,
  renderBanners,
  renderRegistry,
  renderRouteStatus,
  renderSettings,
} from './screens';

export const renderMapTop = (m: PlannerModel) => {
  const {
    beginMapDestinationPick,
    googleMode,
    googleStatus,
    hasDestination,
    mobileTopRef,
    openPage,
    setWeatherOpen,
    shortPlace,
    startPlaceSearch,
    state,
    t,
    tripSummary,
    weatherOpen,
  } = m;
  return (
    <div className="sc-mobile-top" ref={mobileTopRef}>
      <button
        className="sc-route-card"
        onClick={() => (hasDestination ? openPage('route') : startPlaceSearch('destination'))}
      >
        <span className="sc-visually-hidden">{t('mobileEditRoute')}: </span>
        <span className="sc-route-card-text">
          {hasDestination ? (
            <span className="sc-route-card-places">
              <span>{shortPlace(state.origin.label) || t('origin')}</span>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>{shortPlace(state.destination.label)}</strong>
            </span>
          ) : (
            <span className="sc-route-card-empty">
              <MapPin size={17} aria-hidden="true" />
              {t('mobileWhereTo')}
            </span>
          )}
          <span className="sc-route-card-meta">{tripSummary()}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <div className="sc-map-tools" role="group" aria-label={t('mobileMapTools')}>
        <button className="sc-map-tool" onClick={() => openPage('settings')}>
          <SettingsIcon size={18} aria-hidden="true" />
          <span>{t('settings')}</span>
        </button>
        {googleMode && (
          <button
            className="sc-map-tool"
            onClick={beginMapDestinationPick}
            disabled={googleStatus !== 'ready'}
            title={t('pickDestinationOnMap')}
          >
            <MapPin size={18} aria-hidden="true" />
            <span>{t('mobilePick')}</span>
          </button>
        )}
        <button
          className="sc-map-tool"
          aria-expanded={weatherOpen}
          onClick={() => setWeatherOpen((open) => !open)}
        >
          <CloudSun size={18} aria-hidden="true" />
          <span>{t('mobileWeather')}</span>
        </button>
      </div>
    </div>
  );
};

export const renderPickBar = (m: PlannerModel) => {
  const { goBack, mapDestinationPicking, t } = m;
  return (
    <div className="sc-mobile-top sc-mobile-pick" role="status">
      <span>{t(mapDestinationPicking ? 'pickDestinationHint' : 'pickStopoverHint')}</span>
      <button className="sc-small-button" onClick={goBack}>
        <X size={15} />
        {t(mapDestinationPicking ? 'cancelDestinationPick' : 'cancelStopoverPick')}
      </button>
    </div>
  );
};

// Like a map app, the locate button sits at the map's lower right, clear of Google's terms.
export const renderLocateButton = (m: PlannerModel) => {
  const { locationLoading, showMyLocation, t } = m;
  return (
    <button
      className="sc-map-locate"
      onClick={showMyLocation}
      disabled={locationLoading}
      aria-label={t(locationLoading ? 'locating' : 'mobileShowMyLocation')}
      title={t('mobileShowMyLocation')}
    >
      {locationLoading ? (
        <span className="sc-spinner" aria-hidden="true" />
      ) : (
        <LocateFixed size={22} aria-hidden="true" />
      )}
    </button>
  );
};

// Drive and public transport stay switchable in every state, including loading and errors.
export const renderModeBar = (m: PlannerModel) => {
  const { liveMode, switchLiveMode, t } = m;
  return (
    <div className="sc-mode-bar" role="group" aria-label={t('chooseMode')}>
      {(['drive', 'transit'] as const).map((mode) => (
        <button
          key={mode}
          className={liveMode === mode ? 'is-active' : ''}
          aria-pressed={liveMode === mode}
          onClick={() => switchLiveMode(mode)}
        >
          <ModeIcon mode={mode} size={17} />
          <span>{t(mode)}</span>
        </button>
      ))}
    </div>
  );
};

export const renderSelectedSummary = (m: PlannerModel, result: RouteResult) => {
  const {
    cardLabel,
    clockSpan,
    departureAt,
    moneyWithRange,
    resultSource,
    t,
    tripScope,
    valueUpdates,
    wholeMinutes,
  } = m;
  return (
    <div className="sc-sheet-selected">
      <span className="sc-sheet-name">
        <ModeIcon mode={result.mode} size={16} />
        <span>{cardLabel(result)}</span>
      </span>
      <strong
        key={valueUpdates}
        className={`sc-sheet-cost ${result.totalCostRange ? 'sc-sheet-cost-range' : ''} ${valueUpdates ? 'sc-value-updated' : ''}`}
        data-testid="selected-cost"
      >
        {moneyWithRange(result.totalCost, result.totalCostRange)}
      </strong>
      <span className="sc-sheet-meta">
        <span>{tripScope}</span>
        {` · ${wholeMinutes(result.totalMinutes)}`}
        {departureAt !== undefined &&
          ` · ${clockSpan(departureAt, result.breakdown.outbound.totalMinutes)}`}
      </span>
      <span className="sc-sheet-source">
        {[
          resultSource(result),
          result.totalCostRange ? t('fareRangeBadge') : '',
          result.warnings.includes('unverified-parking') ? t('parkingWarning') : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
};

export const renderSheetCards = (m: PlannerModel) => {
  const {
    describeCard,
    distanceText,
    moneyWithRange,
    resultSource,
    selectResult,
    selected,
    sharedSheetSource,
    sheetCards,
    t,
    wholeMinutes,
  } = m;
  return (
    <ol className="sc-option-list sc-sheet-options">
      {sheetCards.map((result) => {
        const { label, tags } = describeCard(result);
        const isSelected = selected?.id === result.id;
        return (
          <li key={result.id} className={`sc-option ${isSelected ? 'is-selected' : ''}`}>
            <button
              className="sc-result-card sc-sheet-card"
              onClick={() => selectResult(result)}
              aria-pressed={isSelected}
              data-testid={`route-card-${result.id}`}
            >
              <span className="sc-result-radio" aria-hidden="true" />
              <span className="sc-result-main">
                <span className="sc-result-name">{label}</span>
                <span className="sc-result-meta">
                  {[
                    wholeMinutes(result.totalMinutes),
                    distanceText(result),
                    t('transferCount', { count: result.transfers }),
                  ].join(' · ')}
                </span>
                {!sharedSheetSource && (
                  <span className="sc-result-source">{resultSource(result)}</span>
                )}
                {tags.length > 0 && <span className="sc-result-tags">{tags}</span>}
              </span>
              <span
                className={`sc-money ${result.totalCostRange ? 'sc-money-range' : ''}`}
                data-testid={`cost-${result.id}`}
              >
                {moneyWithRange(result.totalCost, result.totalCostRange)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

export const renderSheet = (m: PlannerModel) => {
  const {
    comparison,
    estimatedReturn,
    googleMode,
    hasFareRanges,
    locationError,
    openPage,
    selected,
    setSheetOpen,
    setShowAllRoutes,
    setSortBy,
    sharedSheetSource,
    sheetBodyId,
    sheetCards,
    sheetDrag,
    sheetDragged,
    sheetExpandable,
    sheetNotices,
    sheetOpen,
    showAllRoutes,
    sortBy,
    t,
  } = m;
  return (
    <section className="sc-sheet" aria-label={t('mobileSheetLabel')}>
      {sheetExpandable && (
        <div
          className="sc-sheet-grip"
          aria-hidden="true"
          onPointerDown={(event) => {
            sheetDrag.current = { y: event.clientY, dragged: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = sheetDrag.current;
            if (drag && Math.abs(event.clientY - drag.y) > 8) drag.dragged = true;
          }}
          onPointerUp={(event) => {
            const drag = sheetDrag.current;
            sheetDrag.current = null;
            if (!drag?.dragged) return;
            sheetDragged.current = true;
            const distance = event.clientY - drag.y;
            if (Math.abs(distance) > 24) setSheetOpen(distance < 0);
          }}
          onPointerCancel={() => {
            sheetDrag.current = null;
          }}
          onClick={() => {
            if (sheetDragged.current) sheetDragged.current = false;
            else setSheetOpen((open) => !open);
          }}
        >
          <span />
        </div>
      )}
      {googleMode && renderModeBar(m)}
      <div className="sc-sheet-head">
        {selected
          ? renderSelectedSummary(m, selected)
          : renderRouteStatus(m, 'sc-sheet-status-view')}
        {sheetExpandable && (
          <button
            className="sc-icon-button sc-sheet-toggle"
            aria-expanded={sheetOpen}
            aria-controls={sheetBodyId}
            aria-label={t(sheetOpen ? 'mobileCollapseSheet' : 'mobileExpandSheet')}
            onClick={() => setSheetOpen((open) => !open)}
          >
            <ChevronDown size={20} />
          </button>
        )}
      </div>
      {(sheetExpandable || sheetNotices) && (
        <div id={sheetBodyId} className="sc-sheet-body" hidden={sheetExpandable && !sheetOpen}>
          {renderBanners(m)}
          {locationError && (
            <p role="alert" className="sc-error">
              {t(locationError)}
            </p>
          )}
          {sheetCards.length > 0 && (
            <>
              <div className="sc-sheet-list-head">
                <h2>{t('yourOptions')}</h2>
                {(comparison.result?.results.length ?? 0) > 1 && (
                  <label className="sc-sheet-sort">
                    <span>{t('sortBy')}</span>
                    <select
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                    >
                      <option value="cost">{t('sortCost')}</option>
                      <option value="time">{t('sortTime')}</option>
                      <option value="distance">{t('sortDistance')}</option>
                      <option value="value">{t('sortValue')}</option>
                    </select>
                  </label>
                )}
              </div>
              {renderSheetCards(m)}
            </>
          )}
          {googleMode && (comparison.result?.results.length ?? 0) > 3 && (
            <button
              className="sc-show-routes"
              onClick={() => setShowAllRoutes((current) => !current)}
              aria-expanded={showAllRoutes}
            >
              {t(showAllRoutes ? 'showFewerRoutes' : 'showAllRoutes', {
                count: comparison.result!.results.length,
              })}
              <ChevronDown size={16} />
            </button>
          )}
          {sheetExpandable && (
            <div className="sc-sheet-actions">
              <button className="sc-small-button" onClick={() => openPage('comparison')}>
                {t('mobileCompareAll')}
              </button>
              <button className="sc-small-button" onClick={() => openPage('breakdown')}>
                {t('breakdown')}
              </button>
              <button className="sc-small-button" onClick={() => openPage('costs')}>
                {t('adjustCosts')}
              </button>
            </div>
          )}
          {/* Mode and data notices follow the options, which come first on a small screen. */}
          {!googleMode && (
            <div className="sc-demo-banner">
              <span className="sc-tag">{t('demoData')}</span>
              <p>{t('demoNotice')}</p>
            </div>
          )}
          {renderManualFallback(m)}
          {sheetCards.length > 0 && (
            <div className="sc-results-notes">
              {sharedSheetSource && <p>{t('sharedSource', { source: sharedSheetSource })}</p>}
              {estimatedReturn && <p>{t('returnEstimateNote')}</p>}
              {sheetCards.some(
                (result) =>
                  result.mode === 'drive' && result.warnings.includes('unverified-parking'),
              ) && <p>{t('drivingParkingNote')}</p>}
              {hasFareRanges && <p>{t('fareRangeRankHelp')}</p>}
            </div>
          )}
          {renderGoogleAttribution(m)}
          {!googleMode && <p className="sc-help">{t('estimatedReturn')}</p>}
        </div>
      )}
    </section>
  );
};

// Route page: two compact place rows over the map; searching a place keeps the map in view.
export const renderPlaceRow = (m: PlannerModel, field: 'origin' | 'destination') => {
  const {
    destinationMissing,
    googleMode,
    originMissing,
    searchField,
    searchPlaces,
    setSearchField,
    setState,
    state,
    t,
  } = m;
  const missing = field === 'origin' ? originMissing : destinationMissing;
  const label = state[field].label;
  return (
    <div
      className={`sc-place-row ${missing ? 'sc-field-invalid' : ''}`}
      data-field={field}
      data-active={searchField === field || undefined}
      hidden={searchField !== null && searchField !== field}
      onFocus={() => setSearchField(field)}
    >
      <span
        className={`sc-route-dot ${field === 'destination' ? 'sc-route-dot-end' : ''}`}
        aria-hidden="true"
      />
      {/* A plain field on phones: Google's own widget would cover the map with a full page. */}
      <input
        className="sc-place-input"
        aria-label={t(field)}
        placeholder={t(field === 'origin' ? 'mobileSearchStart' : 'mobileWhereTo')}
        value={label}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(event) =>
          googleMode
            ? searchPlaces(field, event.target.value)
            : setState((current) => ({ ...current, [field]: { label: event.target.value } }))
        }
      />
      {searchField === field && label && (
        <button
          className="sc-icon-button sc-place-clear"
          aria-label={t('mobileClearSearch')}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (googleMode) searchPlaces(field, '');
            else setState((current) => ({ ...current, [field]: { label: '' } }));
            event.currentTarget.parentElement?.querySelector('input')?.focus();
          }}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
};

export const renderSearchActions = (m: PlannerModel, field: 'origin' | 'destination') => {
  const {
    applyPlace,
    beginMapDestinationPick,
    choosePlaceSuggestion,
    googleMode,
    googleStatus,
    locationLoading,
    placeSuggestions,
    state,
    t,
    useLocation,
  } = m;
  const suggestions =
    googleMode && placeSuggestions?.field === field && state[field].label.trim()
      ? placeSuggestions.items
      : [];
  return (
    <ul className="sc-search-actions">
      {suggestions.map((suggestion) => (
        <li key={suggestion.id}>
          <button onClick={() => choosePlaceSuggestion(field, suggestion)}>
            <MapPin size={18} aria-hidden="true" />
            <span>
              {suggestion.main}
              {suggestion.secondary && <small>{suggestion.secondary}</small>}
            </span>
          </button>
        </li>
      ))}
      {suggestions.length > 0 && (
        <li className="sc-search-attribution">
          <span>{t('poweredByGoogle')}</span>
        </li>
      )}
      {field === 'origin' && (
        <li>
          <button onClick={useLocation} disabled={locationLoading}>
            <LocateFixed size={18} aria-hidden="true" />
            {t(locationLoading ? 'locating' : 'useLocation')}
          </button>
        </li>
      )}
      {field === 'destination' && googleMode && (
        <li>
          <button onClick={beginMapDestinationPick} disabled={googleStatus !== 'ready'}>
            <MapPin size={18} aria-hidden="true" />
            {t('mobilePickOnMap')}
          </button>
        </li>
      )}
      {state.places.map((place) => (
        <li key={place.label}>
          <button onClick={() => applyPlace(field, place)}>
            <Bookmark size={18} aria-hidden="true" />
            <span>
              <small>{t('mobileSavedPlaces')}</small>
              {place.label}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

export const renderSegmented = <T extends string>(
  m: PlannerModel,
  label: MessageKey,
  value: T,
  choices: [T, MessageKey][],
  onChange: (value: T) => void,
) => {
  const { t } = m;
  return (
    <fieldset className="sc-segmented">
      <legend>{t(label)}</legend>
      <div>
        {choices.map(([choice, text]) => (
          <button key={choice} aria-pressed={value === choice} onClick={() => onChange(choice)}>
            {t(text)}
          </button>
        ))}
      </div>
    </fieldset>
  );
};

export const renderSchedulePanel = (m: PlannerModel) => {
  const { editTime, goBack, googleMode, plannerId, state, t, updateSettings } = m;
  return (
    <div
      className="sc-schedule-panel"
      role="dialog"
      aria-labelledby={`${plannerId}-schedule-title`}
    >
      <h2 id={`${plannerId}-schedule-title`}>{t('mobileTimeTitle')}</h2>
      {renderSegmented(
        m,
        'tripLabel',
        state.settings.roundTrip ? 'round' : 'one-way',
        [
          ['one-way', 'tripOneWay'],
          ['round', 'tripRoundTrip'],
        ],
        (trip) => updateSettings({ roundTrip: trip === 'round' }),
      )}
      {renderSegmented(
        m,
        'departureLabel',
        state.leaveNow ? 'now' : 'at',
        [
          ['now', 'departNow'],
          ['at', 'departAt'],
        ],
        (when) => editTime({ leaveNow: when === 'now' }),
      )}
      {googleMode &&
        state.settings.roundTrip &&
        renderSegmented(
          m,
          'returnPolicyLabel',
          state.returnPolicy,
          [
            ['estimate', 'returnPolicyEstimate'],
            ['scheduled', 'returnPolicyScheduled'],
          ],
          (returnPolicy) => editTime({ returnPolicy }),
        )}
      {googleMode && state.settings.roundTrip && state.returnPolicy === 'estimate' && (
        <p className="sc-help">{t('returnEstimateNote')}</p>
      )}
      {renderTimeFields(m)}
      <button className="sc-primary-button sc-full-width" onClick={goBack}>
        {t('mobileDone')}
      </button>
    </div>
  );
};

export const renderRoutePage = (m: PlannerModel) => {
  const {
    drivingStops,
    goBack,
    googleError,
    googleMode,
    locationError,
    plannerId,
    routePanel,
    runStatusAction,
    savePlace,
    schedulePanelOpen,
    searchField,
    setRoutePanel,
    state,
    stopoverRoutingBlocked,
    swapPlaces,
    switchLiveMode,
    t,
  } = m;
  return (
    <>
      <div className="sc-route-panel" data-searching={searchField ? true : undefined}>
        <h2 id={`${plannerId}-journey`} className="sc-visually-hidden">
          {t('yourJourney')}
        </h2>
        <div className="sc-place-rows">
          {renderPlaceRow(m, 'origin')}
          {renderPlaceRow(m, 'destination')}
          {!searchField && (
            <button className="sc-swap" aria-label={t('swap')} onClick={swapPlaces}>
              <ArrowDownUp size={16} />
            </button>
          )}
        </div>
        {searchField ? (
          renderSearchActions(m, searchField)
        ) : (
          <>
            {drivingStops.length > 0 && routePanel !== 'stops' && (
              <button className="sc-text-button" onClick={() => setRoutePanel('stops')}>
                <MapPin size={15} />
                {t('mobileStopCount', { count: drivingStops.length })}
              </button>
            )}
            {routePanel === 'stops' && renderStopovers(m)}
            {stopoverRoutingBlocked && routePanel !== 'stops' && (
              <div className="sc-status-actions" role="alert">
                <p className="sc-error">{t('transitStopoverUnsupported')}</p>
                <button className="sc-small-button" onClick={() => runStatusAction('removeStops')}>
                  {t('removeStopsContinue')}
                </button>
                <button className="sc-small-button" onClick={() => switchLiveMode('drive')}>
                  {t('switchToDrive')}
                </button>
              </div>
            )}
            {routePanel === 'more' && (
              <div className="sc-route-more">
                <div className="sc-route-more-actions">
                  <button className="sc-small-button" onClick={() => savePlace(state.origin)}>
                    <Bookmark size={15} />
                    {t('saveOrigin')}
                  </button>
                  <button className="sc-small-button" onClick={() => savePlace(state.destination)}>
                    <Bookmark size={15} />
                    {t('saveDestination')}
                  </button>
                </div>
                {renderSavedPlaces(m)}
                {renderDestinationHours(m)}
                <p className="sc-help">
                  {t(googleMode ? 'liveAddressHint' : 'manualLocationNote')}
                </p>
              </div>
            )}
            {locationError && (
              <p role="alert" className="sc-error">
                {t(locationError)}
              </p>
            )}
            {googleMode && googleError && (
              <p className="sc-error" role="alert">
                {googleError}
              </p>
            )}
          </>
        )}
      </div>
      {/* The map stays in view below the search; tapping it ends the search, as in a map app. */}
      <div
        className="sc-route-map-gap"
        aria-hidden="true"
        onClick={searchField ? goBack : undefined}
      />
      {schedulePanelOpen && !searchField && renderSchedulePanel(m)}
    </>
  );
};

export const renderPageContent = (m: PlannerModel, page: MobilePage) => {
  const { editingMode, goBack, googleMode, openPage, setManualRequested, t } = m;
  switch (page) {
    case 'route':
      return renderRoutePage(m);
    case 'costs':
      return (
        <div className="sc-input-panel">
          <section className="sc-input-section">
            {!googleMode && (
              <>
                <h3 className="sc-section-label">{t('chooseMode')}</h3>
                {renderModeSwitch(m)}
              </>
            )}
            <div className="sc-mode-editor">{renderCostEditors(m)}</div>
            {googleMode && editingMode === 'transit' && (
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
          </section>
          <p className="sc-help sc-return-note">
            {t('mobileCostsLive')} {!googleMode && t('estimatedReturn')}
          </p>
        </div>
      );
    case 'comparison':
      return (
        <>
          {renderComparison(m)}
          {renderGoogleAttribution(m)}
        </>
      );
    case 'breakdown':
      return (
        <>
          {renderBreakdown(m)}
          {renderGoogleAttribution(m)}
        </>
      );
    case 'settings':
      return (
        <>
          {renderSettings(m)}
          <section className="sc-page-content">
            {googleMode && (
              <div className="sc-surface">
                <h2>{t('manualEstimateSetting')}</h2>
                <p className="sc-help">{t('manualEstimateHelp')}</p>
                <button
                  className="sc-small-button"
                  onClick={() => {
                    setManualRequested(true);
                    goBack();
                  }}
                >
                  {t('useManualInputs')}
                </button>
              </div>
            )}
            <button className="sc-small-button sc-full-width" onClick={() => openPage('about')}>
              {t('about')}
              <ChevronRight size={16} />
            </button>
          </section>
        </>
      );
    case 'about':
      return (
        <>
          {renderAbout(m)}
          {renderRegistry(m)}
          <p className="sc-page-content sc-help">{t('footer')}</p>
        </>
      );
  }
};

export const renderPageFooter = (m: PlannerModel, page: MobilePage) => {
  const {
    addressResolving,
    cardLabel,
    confirmRoute,
    goBack,
    googleMode,
    moneyWithRange,
    routeConfirmBlocked,
    schedulePanelOpen,
    searchField,
    selected,
    setSchedulePanelOpen,
    t,
    tripScope,
    tripSummary,
  } = m;
  return page === 'route' ? (
    // Search and the time panel each have their own Done; the footer waits for them.
    !searchField && !schedulePanelOpen && (
      <footer className="sc-page-footer sc-route-footer">
        <button
          className="sc-small-button sc-trip-button"
          aria-expanded={schedulePanelOpen}
          onClick={() => (schedulePanelOpen ? goBack() : setSchedulePanelOpen(true))}
        >
          <Clock3 size={16} aria-hidden="true" />
          <span>{tripSummary()}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button className="sc-primary-button" onClick={confirmRoute} disabled={routeConfirmBlocked}>
          {googleMode && <Route size={16} />}
          {t(!googleMode ? 'mobileDone' : addressResolving > 0 ? 'addressResolving' : 'planRoute')}
        </button>
      </footer>
    )
  ) : page === 'costs' ? (
    <footer className="sc-page-footer sc-cost-footer">
      {selected && (
        <span className="sc-cost-footer-total">
          <span>{cardLabel(selected)}</span>
          <strong>{moneyWithRange(selected.totalCost, selected.totalCostRange)}</strong>
          <span>{tripScope}</span>
        </span>
      )}
      <button className="sc-primary-button" onClick={goBack}>
        {t('mobileDone')}
      </button>
    </footer>
  ) : null;
};

export const renderPage = (m: PlannerModel, page: MobilePage, index: number) => {
  const {
    drivingPreference,
    goBack,
    googleMode,
    liveMode,
    pageTitles,
    pages,
    pickingActive,
    plannerId,
    routePanel,
    searchField,
    setRoutePanel,
    t,
  } = m;
  const covered = index < pages.length - 1 || pickingActive;
  const titleId = `${plannerId}-page-${page}`;
  // Reading pages carry their own heading; the bar title then only names the page.
  const Title = page === 'route' || page === 'costs' ? 'h1' : 'p';
  const searching = page === 'route' && searchField;
  return (
    <section
      key={page}
      className={`sc-page ${covered ? 'is-covered' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      inert={covered}
      data-page={page}
      data-searching={searching || undefined}
    >
      <header className="sc-page-bar">
        <button
          className="sc-icon-button"
          aria-label={t(
            searching ? 'mobileBack' : page === 'route' ? 'mobileDiscardRoute' : 'mobileBack',
          )}
          onClick={goBack}
        >
          <ArrowLeft size={20} />
        </button>
        <Title id={titleId} className="sc-page-bar-title">
          {t(pageTitles[page])}
        </Title>
        {page === 'route' && searching && (
          <button className="sc-text-button sc-page-bar-action" onClick={goBack}>
            {t('mobileSearchDone')}
          </button>
        )}
        {page === 'route' && !searching && (
          <div className="sc-page-bar-actions">
            {googleMode && drivingPreference && liveMode === 'drive' && (
              <button
                className="sc-icon-button"
                aria-label={t('addStopover')}
                aria-expanded={routePanel === 'stops'}
                onClick={() => setRoutePanel(routePanel === 'stops' ? null : 'stops')}
              >
                <Plus size={20} />
              </button>
            )}
            <button
              className="sc-text-button"
              aria-expanded={routePanel === 'more'}
              onClick={() => setRoutePanel(routePanel === 'more' ? null : 'more')}
            >
              {t('mobileMore')}
            </button>
          </div>
        )}
      </header>
      <div className="sc-page-body">{renderPageContent(m, page)}</div>
      {renderPageFooter(m, page)}
    </section>
  );
};

export const renderMobileShell = (m: PlannerModel) => {
  const {
    locale,
    pageStackRef,
    pages,
    pickingActive,
    routeEditing,
    shortPlace,
    state,
    weather,
    weatherOpen,
  } = m;
  const pageShown = pages.length > 0 && !pickingActive;
  return (
    <main className="sc-mobile-shell" data-route-editing={routeEditing || undefined}>
      <div className="sc-mobile-main" inert={pageShown} aria-hidden={pageShown || undefined}>
        <div className="sc-mobile-map">
          {renderSchematic(m, true)}
          {pickingActive ? renderPickBar(m) : renderMapTop(m)}
          {!pickingActive && !routeEditing && renderLocateButton(m)}
          {weatherOpen && !pickingActive && (
            <div className="sc-mobile-weather">
              <WeatherBar
                state={weather}
                locale={locale}
                originLabel={shortPlace(state.origin.label)}
              />
            </div>
          )}
        </div>
        {!routeEditing && renderSheet(m)}
      </div>
      {pages.length > 0 && (
        <div className="sc-page-stack" ref={pageStackRef}>
          {pages.map((page, index) => renderPage(m, page, index))}
        </div>
      )}
    </main>
  );
};
