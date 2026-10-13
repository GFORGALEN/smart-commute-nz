import { type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  House,
  Info,
  MapPin,
  Plus,
  X,
} from 'lucide-react';
import { type CostRange, type RouteResult } from '@smart-commute/core';
import { type MessageKey } from '@smart-commute/i18n';
import { WeatherBar } from '../../WeatherBar';
import {
  directionKeys,
  distanceModes,
  legKeys,
  minorModes,
  providerNoteKeys,
  warningKeys,
} from '../constants';
import { ModeIcon } from '../fields';
import { shortNumber } from '../helpers';
import { type PlannerModel } from '../usePlannerModel';
import { renderCarPurchase } from './carPurchase';
import { renderRouteStatus } from './screens';

export const renderSchematic = (m: PlannerModel, compact = false) => {
  const {
    beginMapDestinationPick,
    beginMapStopoverPick,
    cancelMapDestinationPick,
    cancelMapStopoverPick,
    drivingStops,
    editingMode,
    googleMapRef,
    googleMode,
    googleStatus,
    legIcon,
    locale,
    mapDestinationPicking,
    mapStopoverPicking,
    nameOf,
    placeLabel,
    routeLoading,
    selected,
    state,
    t,
    weather,
  } = m;
  const diagramMode = selected?.mode ?? editingMode;
  const legs = selected?.option.outbound ?? [];
  const mainLegs = legs.filter((leg) => !minorModes.has(leg.mode));
  const minorMinutes = legs
    .filter((leg) => minorModes.has(leg.mode))
    .reduce((total, leg) => total + leg.durationMinutes, 0);
  const hubLabel =
    selected?.option.waypoints[0]?.label ||
    state.options.find((option) => option.mode === 'hybrid')?.waypoints[0]?.label ||
    '';
  const stop = (key: string, label: string, place: string, kind: 'start' | 'hub' | 'end') => (
    <li className={`sc-schematic-stop sc-stop-${kind}`} key={key}>
      <span className="sc-stop-marker" aria-hidden="true">
        {kind === 'start' ? <House size={14} /> : kind === 'end' ? <MapPin size={14} /> : null}
      </span>
      <span className="sc-stop-text">
        <span>{label}</span>
        <strong>{place || '—'}</strong>
      </span>
    </li>
  );
  const steps: ReactNode[] = [stop('start', t('start'), state.origin.label, 'start')];
  mainLegs.forEach((leg, index) => {
    const previous = mainLegs[index - 1];
    if (diagramMode === 'hybrid' && previous?.mode === 'drive' && leg.mode !== 'drive')
      steps.push(stop(`hub-${index}`, t('interchange'), placeLabel(hubLabel) || t('hub'), 'hub'));
    steps.push(
      <li className={`sc-schematic-leg sc-leg-${leg.mode}`} key={`leg-${index}`}>
        <span className="sc-leg-icon" aria-hidden="true">
          {legIcon(leg.mode)}
        </span>
        <span className="sc-leg-text">
          <strong>{t(legKeys[leg.mode])}</strong>
          <span>
            {[
              t('minutes', { count: shortNumber(leg.durationMinutes) }),
              leg.distanceKm !== undefined ? t('km', { count: shortNumber(leg.distanceKm) }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </li>,
    );
  });
  steps.push(stop('end', t('finish'), state.destination.label, 'end'));
  return (
    <section className="sc-map-panel" aria-label={t(googleMode ? 'googleMapTitle' : 'schematic')}>
      {!compact && (
        <div className="sc-map-toolbar">
          <span>{t(googleMode ? 'googleMapTitle' : 'schematic')}</span>
          <div className="sc-map-tools">
            {googleMode && (
              <button
                className="sc-small-button"
                onClick={mapDestinationPicking ? cancelMapDestinationPick : beginMapDestinationPick}
                disabled={!mapDestinationPicking && googleStatus !== 'ready'}
                aria-pressed={mapDestinationPicking}
              >
                {mapDestinationPicking ? <X size={15} /> : <MapPin size={15} />}
                {t(mapDestinationPicking ? 'cancelDestinationPick' : 'pickDestinationOnMap')}
              </button>
            )}
            {googleMode && (editingMode === 'drive' || mapStopoverPicking) && (
              <button
                className="sc-small-button"
                onClick={mapStopoverPicking ? cancelMapStopoverPick : beginMapStopoverPick}
                disabled={
                  !mapStopoverPicking &&
                  (googleStatus !== 'ready' || editingMode !== 'drive' || drivingStops.length >= 10)
                }
                aria-pressed={mapStopoverPicking}
              >
                {mapStopoverPicking ? <X size={15} /> : <Plus size={15} />}
                {t(mapStopoverPicking ? 'cancelStopoverPick' : 'pickStopoverOnMap')}
              </button>
            )}
          </div>
        </div>
      )}
      {!compact && (
        <WeatherBar
          state={weather}
          locale={locale}
          originLabel={state.origin.label.split(',')[0]?.trim() || state.origin.label}
        />
      )}
      {googleMode && (
        <div className="sc-map-stage">
          <div
            className="sc-google-map"
            ref={googleMapRef}
            aria-label={t('googleMapDescription')}
          />
          {!compact && (mapStopoverPicking || mapDestinationPicking) && (
            <p className="sc-map-stopover-prompt" role="status">
              {t(mapDestinationPicking ? 'pickDestinationHint' : 'pickStopoverHint')}
            </p>
          )}
          {(googleStatus === 'idle' || googleStatus === 'loading') && (
            <div className="sc-map-loading" role="status">
              {t('googleLoading')}
            </div>
          )}
          {!compact && routeLoading && (
            <p className="sc-help" role="status">
              {t('googleRoutesLoading')}
            </p>
          )}
        </div>
      )}
      {!googleMode && (
        <div className="sc-schematic" data-mode={diagramMode}>
          <p className="sc-schematic-caption">
            {t('outboundRoute')} · {selected ? nameOf(selected) : t(diagramMode)}
          </p>
          <ol className="sc-schematic-route">{steps}</ol>
          {minorMinutes > 0 && (
            <p className="sc-help">{t('minorLegs', { minutes: shortNumber(minorMinutes) })}</p>
          )}
          <p className="sc-schematic-note">{t('schematicNote')}</p>
          <div className="sc-map-explainer">
            <h3>{t('manualMapTitle')}</h3>
            <p>{t('manualMapBody')}</p>
            <p>{t('mapFooter')}</p>
          </div>
        </div>
      )}
    </section>
  );
};

// The selected option expands in place, so its figures are never stated twice.
export const renderSelectedDetail = (m: PlannerModel, result: RouteResult) => {
  const {
    clockSpan,
    departureAt,
    generalizedRange,
    money,
    moneyWithRange,
    openScreen,
    returnAt,
    state,
    summaryRef,
    t,
  } = m;
  return (
    <div className="sc-result-detail" ref={summaryRef}>
      {departureAt !== undefined && (
        <p className="sc-detail-clock">
          {t('outboundClock', {
            span: clockSpan(departureAt, result.breakdown.outbound.totalMinutes),
          })}
          {returnAt !== undefined &&
            ` · ${t('returnClock', { span: clockSpan(returnAt, result.breakdown.inbound.totalMinutes) })}`}
          {` · ${t('aucklandTime')}`}
        </p>
      )}
      <div className="sc-detail-figure">
        <span>{t('generalizedCostPerCommute')}</span>
        <strong>{moneyWithRange(result.generalizedCost, generalizedRange(result))}</strong>
        <p>{t('timeValueRate', { value: money(state.settings.valueOfTime) })}</p>
      </div>
      <div className="sc-projection sc-detail-figure">
        <span>{t('monthlyProjection')}</span>
        <strong className={result.monthlyCostRange ? 'sc-projection-range' : ''}>
          {moneyWithRange(result.monthlyCost, result.monthlyCostRange)}
        </strong>
        <p>
          {t('costUnit')} · {t('perMonth')} ·{' '}
          {t('basedOn', {
            days: state.settings.daysPerWeek,
            weeks: state.settings.weeksPerMonth,
          })}
        </p>
      </div>
      <button className="sc-text-button" onClick={() => openScreen('breakdown')}>
        {t('viewBreakdown')}
        <ArrowRight size={15} />
      </button>
    </div>
  );
};

export const renderGoogleAttribution = (m: PlannerModel) => {
  const { googleResponse, t } = m;
  return (
    googleResponse && (
      <section className="sc-google-attribution" aria-label={t('googleDetails')}>
        <strong>{googleResponse.attribution}</strong>
        <span>{t('googleDetails')}</span>
        {googleResponse.attributionLinks?.map((link) =>
          link.url ? (
            <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ) : (
            <span key={link.label}>{link.label}</span>
          ),
        )}
        {googleResponse.warnings.map((warning) => {
          const key = providerNoteKeys.find(([prefix]) => warning.startsWith(prefix))?.[1];
          return <p key={warning}>{key ? t(key) : warning}</p>;
        })}
      </section>
    )
  );
};

export const renderResults = (m: PlannerModel) => {
  const {
    cardResults,
    clockSpan,
    comparison,
    departureAt,
    describeCard,
    distanceText,
    fareExplanationKey,
    googleMode,
    hasFareRanges,
    money,
    moneyWithRange,
    nameOf,
    openScreen,
    plannerId,
    resultSource,
    resultsRef,
    selectResult,
    selected,
    setShowAllRoutes,
    setSortBy,
    showAllRoutes,
    sortBy,
    state,
    t,
    tripScope,
    valueUpdates,
    wholeMinutes,
  } = m;
  const shownCards = cardResults.filter(
    (result, index) => !googleMode || showAllRoutes || index < 3 || result.id === selected?.id,
  );
  const sources = new Set(shownCards.map(resultSource));
  const sharedSource = sources.size === 1 ? [...sources][0] : '';
  const drivingParkingUnverified = shownCards.some(
    (result) => result.mode === 'drive' && result.warnings.includes('unverified-parking'),
  );
  return (
    <section
      className="sc-results-panel"
      ref={resultsRef}
      tabIndex={-1}
      aria-labelledby={`${plannerId}-results-title`}
    >
      <div className="sc-results-heading">
        <div>
          <h2 id={`${plannerId}-results-title`}>{t('yourOptions')}</h2>
          <p>
            {t('optionCount', { count: comparison.result?.results.length ?? 0 })} · {t('costUnit')}{' '}
            · <span>{tripScope}</span> · {t('perCommute')}
            {departureAt !== undefined && ` · ${t('aucklandTime')}`}
          </p>
        </div>
        {(comparison.result?.results.length ?? 0) > 1 && (
          <div className="sc-sort-group">
            <span className="sc-sort-label" aria-hidden="true">
              {t('sortBy')}
            </span>
            <div className="sc-sort" role="group" aria-label={t('sortBy')}>
              {(
                [
                  ['cost', 'sortCost'],
                  ['time', 'sortTime'],
                  ['distance', 'sortDistance'],
                  ['value', 'sortValue'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={sortBy === key}
                  className={sortBy === key ? 'is-active' : ''}
                  onClick={() => setSortBy(key)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {comparison.error && (
        <div className="sc-empty-state" role="alert">
          <h3>{t('validationSummary')}</h3>
          <p>{t('noResults')}</p>
        </div>
      )}
      {!comparison.error && !comparison.result && renderRouteStatus(m, 'sc-empty-state')}
      {shownCards.length > 0 && (
        <ol className="sc-option-list">
          {shownCards.map((result) => {
            const { lines, departureStop, arrivalStop, label, tags } = describeCard(result);
            const isSelected = selected?.id === result.id;
            return (
              <li key={result.id} className={`sc-option ${isSelected ? 'is-selected' : ''}`}>
                <button
                  className="sc-result-card"
                  onClick={() => selectResult(result)}
                  aria-label={[
                    t('selectRoute', { name: label }),
                    departureStop && arrivalStop ? `${departureStop} → ${arrivalStop}` : '',
                    moneyWithRange(result.totalCost, result.totalCostRange),
                    t('minutes', { count: shortNumber(result.totalMinutes) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  aria-pressed={isSelected}
                  data-testid={`route-card-${result.id}`}
                >
                  <span className="sc-result-radio" aria-hidden="true" />
                  <span className="sc-result-main">
                    <span className="sc-result-name">{label}</span>
                    {departureAt !== undefined && (
                      <span className="sc-result-clock">
                        {clockSpan(departureAt, result.breakdown.outbound.totalMinutes)}
                      </span>
                    )}
                    <span className="sc-result-meta">
                      {[distanceText(result), t('transferCount', { count: result.transfers })].join(
                        ' · ',
                      )}
                    </span>
                    {result.congestionMinutes >= 1 && (
                      <span className="sc-result-congestion">
                        {t('congestionLine', {
                          minutes: Math.round(result.congestionMinutes),
                          cost: money(result.congestionFuelCost),
                        })}
                      </span>
                    )}
                    {lines.length > 0 && departureStop && arrivalStop && (
                      <span className="sc-result-stops">
                        {departureStop} → {arrivalStop}
                      </span>
                    )}
                    {!sharedSource && (
                      <span className="sc-result-source">{resultSource(result)}</span>
                    )}
                    {tags.length > 0 && <span className="sc-result-tags">{tags}</span>}
                    {result.totalCostRange && isSelected && (
                      <span className="sc-result-warning">
                        {t('fareRangeBadge')} · {t(fareExplanationKey(result.option))}
                      </span>
                    )}
                    {result.mode === 'hybrid' && result.warnings.includes('unverified-parking') && (
                      <span className="sc-result-warning">{t('parkingWarning')}</span>
                    )}
                  </span>
                  <span className="sc-result-figures">
                    <span
                      key={isSelected ? valueUpdates : 0}
                      className={`sc-money ${result.totalCostRange ? 'sc-money-range' : ''} ${isSelected && valueUpdates ? 'sc-value-updated' : ''}`}
                      data-testid={`cost-${result.id}`}
                    >
                      {moneyWithRange(result.totalCost, result.totalCostRange)}
                    </span>
                    <span className="sc-result-duration">{wholeMinutes(result.totalMinutes)}</span>
                  </span>
                </button>
                {isSelected && renderSelectedDetail(m, result)}
              </li>
            );
          })}
        </ol>
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
      {shownCards.length > 0 && (
        <div className="sc-results-notes">
          {sharedSource && <p>{t('sharedSource', { source: sharedSource })}</p>}
          {drivingParkingUnverified && <p>{t('drivingParkingNote')}</p>}
          {hasFareRanges && <p>{t('fareRangeRankHelp')}</p>}
        </div>
      )}
      {comparison.result && comparison.result.results.length > 1 && (
        <div className="sc-recommendation">
          <h3>{t('recommendation')}</h3>
          {!hasFareRanges && (
            <p>
              {t('savingReason', {
                cheapest: nameOf(comparison.result.cheapest),
                other: nameOf(comparison.result.results[comparison.result.results.length - 1]),
                saving: money(
                  comparison.result.results[comparison.result.results.length - 1].totalCost -
                    comparison.result.cheapest.totalCost,
                ),
              })}
            </p>
          )}
          {comparison.result.cheapest.totalMinutes > comparison.result.fastest.totalMinutes && (
            <p>
              {t('slowerReason', {
                minutes: shortNumber(
                  comparison.result.cheapest.totalMinutes - comparison.result.fastest.totalMinutes,
                ),
              })}
            </p>
          )}
          <p>
            {t(hasFareRanges ? 'budgetValueReason' : 'valueReason', {
              value: money(state.settings.valueOfTime),
              name: nameOf(comparison.result.bestValue),
            })}
          </p>
          <button className="sc-text-button" onClick={() => openScreen('comparison')}>
            {t('comparison')}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </section>
  );
};

export const renderComparison = (m: PlannerModel) => {
  const {
    comparison,
    distanceText,
    generalizedRange,
    hasFareRanges,
    moneyWithRange,
    nameOf,
    noComparableRoutesKey,
    openScreen,
    rankingLabel,
    selectResult,
    selected,
    t,
    tripScope,
  } = m;
  return (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('comparison')}</span>
        <h1>{t('compareHeading')}</h1>
        <p>{t('compareDescription')}</p>
      </div>
      {comparison.result ? (
        <>
          <div className="sc-comparison-highlights">
            {(['cheapest', 'fastest', 'shortest', 'fewestTransfers', 'bestValue'] as const).map(
              (kind) => {
                const result = comparison.result![kind];
                if (kind === 'shortest' && !result.distanceComplete) return null;
                return (
                  <button key={kind} onClick={() => selectResult(result)}>
                    <span>{rankingLabel(kind)}</span>
                    <strong>{nameOf(result)}</strong>
                    <small>
                      {kind === 'fastest'
                        ? t('minutes', { count: shortNumber(result.totalMinutes) })
                        : kind === 'shortest'
                          ? t('km', { count: shortNumber(result.distanceKm) })
                          : kind === 'fewestTransfers'
                            ? t('transferCount', { count: result.transfers })
                            : moneyWithRange(
                                kind === 'bestValue' ? result.generalizedCost : result.totalCost,
                                kind === 'bestValue'
                                  ? generalizedRange(result)
                                  : result.totalCostRange,
                              )}
                    </small>
                  </button>
                );
              },
            )}
          </div>
          <p className="sc-scope-note">
            {t('amountsInNzd')} · {tripScope}
          </p>
          <div className="sc-table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      'route',
                      'costPerCommute',
                      'time',
                      'distanceLabel',
                      'transfers',
                      'weekly',
                      'monthly',
                      'costWithTime',
                    ] as const
                  ).map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.result.results.map((result) => (
                  <tr key={result.id} className={selected?.id === result.id ? 'is-selected' : ''}>
                    <td>
                      <button className="sc-table-route" onClick={() => selectResult(result)}>
                        <ModeIcon mode={result.mode} size={17} />
                        {nameOf(result)}
                        {selected?.id === result.id && <Check size={14} />}
                      </button>
                    </td>
                    <td>
                      <strong>{moneyWithRange(result.totalCost, result.totalCostRange)}</strong>
                    </td>
                    <td>{t('minutes', { count: shortNumber(result.totalMinutes) })}</td>
                    <td>{distanceText(result)}</td>
                    <td>{result.transfers}</td>
                    <td>{moneyWithRange(result.weeklyCost, result.weeklyCostRange)}</td>
                    <td>{moneyWithRange(result.monthlyCost, result.monthlyCostRange)}</td>
                    <td>{moneyWithRange(result.generalizedCost, generalizedRange(result))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sc-help">{t('timeValueExplanation')}</p>
          {hasFareRanges && <p className="sc-help">{t('fareRangeRankHelp')}</p>}
          <button className="sc-primary-button" onClick={() => openScreen('breakdown')}>
            {t('breakdown')}
            <ChevronRight size={16} />
          </button>
          {renderCarPurchase(m)}
        </>
      ) : (
        <p role="alert">{t(comparison.error ? 'validationSummary' : noComparableRoutesKey)}</p>
      )}
    </section>
  );
};

export const renderBreakdown = (m: PlannerModel) => {
  const {
    comparison,
    fareExplanationKey,
    generalizedRange,
    money,
    moneyWithRange,
    nameOf,
    noComparableRoutesKey,
    selectResult,
    selected,
    state,
    t,
    tripScope,
  } = m;
  const kind = state.settings.vehicleKind ?? 'petrol';
  const energyKey: MessageKey =
    kind === 'electric' ? 'electricity' : kind === 'plug-in-hybrid' ? 'fuelAndElectricity' : 'fuel';
  const pieces: { key: MessageKey; value: number; range?: CostRange; color: string }[] = selected
    ? [
        { key: energyKey, value: selected.fuelCost, color: '#2b8b5f' },
        ...(selected.rucCost > 0
          ? [{ key: 'ruc' as const, value: selected.rucCost, color: '#4f7a3a' }]
          : []),
        { key: 'congestionFuel', value: selected.congestionFuelCost, color: '#735824' },
        {
          key: 'fares',
          value: selected.fareCost,
          range: selected.fareCostRange,
          color: '#6a9bb4',
        },
        { key: 'parkingLabel', value: selected.parkingCost, color: '#cc942e' },
        { key: 'tolls', value: selected.tollCost, color: '#cc978c' },
        { key: 'maintenance', value: selected.maintenanceCost, color: '#8f7968' },
      ]
    : [];
  return (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('breakdown')}</span>
        <h1>{t('breakdownHeading')}</h1>
        <p>{t('breakdownDescription')}</p>
      </div>
      {selected ? (
        <>
          <div className="sc-breakdown-switch">
            {comparison.result?.results.map((result) => (
              <button
                key={result.id}
                onClick={() => selectResult(result)}
                className={selected.id === result.id ? 'is-active' : ''}
              >
                <ModeIcon mode={result.mode} size={16} />
                {nameOf(result)}
              </button>
            ))}
          </div>
          <div className="sc-breakdown-grid">
            <div className="sc-surface">
              <h2>{t('components')}</h2>
              <div className="sc-breakdown-total">
                <strong>{moneyWithRange(selected.totalCost, selected.totalCostRange)}</strong>
                <span>
                  {t('costUnit')} · {tripScope} · {t('perCommute')}
                </span>
              </div>
              <div
                className="sc-stacked-bar"
                role="img"
                aria-label={pieces
                  .map((piece) => `${t(piece.key)}: ${moneyWithRange(piece.value, piece.range)}`)
                  .join(', ')}
              >
                {pieces
                  .filter((piece) => piece.value > 0)
                  .map((piece) => (
                    <span key={piece.key} style={{ flex: piece.value, background: piece.color }} />
                  ))}
              </div>
              <dl className="sc-cost-lines">
                {pieces.map((piece) => (
                  <div key={piece.key}>
                    <dt>
                      <i style={{ background: piece.color }} />
                      {t(piece.key)}
                    </dt>
                    <dd>{moneyWithRange(piece.value, piece.range)}</dd>
                  </div>
                ))}
                <div className="sc-cost-total">
                  <dt>{t('total')}</dt>
                  <dd>{moneyWithRange(selected.totalCost, selected.totalCostRange)}</dd>
                </div>
              </dl>
              <p className="sc-help">
                {t(
                  kind === 'electric'
                    ? 'formulaElectric'
                    : kind === 'plug-in-hybrid'
                      ? 'formulaPlugIn'
                      : 'formula',
                )}
              </p>
              {selected.rucCost > 0 && <p className="sc-help">{t('formulaRuc')}</p>}
              {selected.totalCostRange && <p className="sc-help">{t('fareRangeBudgetHelp')}</p>}
            </div>
            <div className="sc-surface sc-budget-surface">
              <h2>{t('commutingPattern')}</h2>
              <p className="sc-scope-note">
                {t('amountsInNzd')} · {tripScope}
              </p>
              <div className="sc-budget-number">
                <span>{t('weekly')}</span>
                <strong>{moneyWithRange(selected.weeklyCost, selected.weeklyCostRange)}</strong>
              </div>
              <div className="sc-budget-number">
                <span>{t('monthly')}</span>
                <strong>{moneyWithRange(selected.monthlyCost, selected.monthlyCostRange)}</strong>
              </div>
              <p>
                {t('basedOn', {
                  days: state.settings.daysPerWeek,
                  weeks: state.settings.weeksPerMonth,
                })}
              </p>
              <div className="sc-divider" />
              <dl className="sc-cost-lines">
                <div>
                  <dt>{t('timeValuePerCommute')}</dt>
                  <dd>{money(selected.generalizedCost - selected.totalCost)}</dd>
                </div>
                <div>
                  <dt>{t('generalizedCostPerCommute')}</dt>
                  <dd>{moneyWithRange(selected.generalizedCost, generalizedRange(selected))}</dd>
                </div>
              </dl>
              <p className="sc-help">{t('timeValueExplanation')}</p>
            </div>
          </div>
          <div className="sc-surface sc-segments-surface">
            <h2>{t('journeySegments')}</h2>
            {(['outbound', 'inbound'] as const)
              .filter((direction) => direction === 'outbound' || state.settings.roundTrip)
              .map((direction) => (
                <div className="sc-segment-list" key={direction}>
                  <h3>
                    {t(directionKeys[direction])}
                    <span>
                      {moneyWithRange(
                        selected.breakdown[direction].totalCost,
                        selected.breakdown[direction].totalCostRange,
                      )}{' '}
                      ·{' '}
                      {t('minutes', {
                        count: shortNumber(selected.breakdown[direction].totalMinutes),
                      })}
                    </span>
                  </h3>
                  {selected.option[direction].map((leg, index) => (
                    <div className="sc-segment-item" key={index}>
                      <span className="sc-segment-count">{index + 1}</span>
                      <strong>{t(legKeys[leg.mode])}</strong>
                      <span>{t('minutes', { count: shortNumber(leg.durationMinutes) })}</span>
                      <span>
                        {leg.distanceKm !== undefined
                          ? t('km', { count: shortNumber(leg.distanceKm) })
                          : distanceModes.has(leg.mode)
                            ? t('distanceNotEntered')
                            : '—'}
                      </span>
                      <span className="sc-tag">
                        {leg.source === 'google'
                          ? 'Google'
                          : leg.source === 'at-rule'
                            ? t('atFareSource')
                            : t('manual')}{' '}
                        · {t(leg.estimated ? 'estimated' : 'verified')}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
          <div className="sc-warnings">
            {selected.warnings.map((warning) => (
              <p key={warning}>
                <Info size={15} />
                {t(
                  warning === 'fare-range-estimate'
                    ? fareExplanationKey(selected.option)
                    : warningKeys[warning],
                )}
              </p>
            ))}
          </div>
        </>
      ) : (
        <p role="alert">{t(comparison.error ? 'validationSummary' : noComparableRoutesKey)}</p>
      )}
    </section>
  );
};
