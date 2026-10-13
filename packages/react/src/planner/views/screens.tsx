import { ArrowRight, Info, Moon, RotateCcw, Sun, WifiOff } from 'lucide-react';
import { DEFAULT_SETTINGS, createExampleOptions } from '@smart-commute/core';
import { DATA_SOURCES } from '@smart-commute/providers';
import { type Locale, type MessageKey } from '@smart-commute/i18n';
import { STORAGE_KEY } from '../constants';
import { NumberField } from '../fields';
import { toLocation } from '../helpers';
import { type PlannerModel } from '../usePlannerModel';

export const renderSettings = (m: PlannerModel) => {
  const {
    locale,
    props,
    setLocale,
    setNotice,
    setSelectedId,
    setState,
    setTheme,
    state,
    t,
    theme,
    updateSettings,
  } = m;
  return (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('settings')}</span>
        <h1>{t('settingsHeading')}</h1>
        <p>{t('settingsDescription')}</p>
      </div>
      <div className="sc-settings-grid">
        <div className="sc-surface">
          <h2>{t('carParameters')}</h2>
          <div className="sc-field-grid">
            <NumberField
              label={t('fuelPrice')}
              value={state.settings.fuelPrice}
              onChange={(fuelPrice) => updateSettings({ fuelPrice })}
              t={t}
            />
            <NumberField
              label={t('fuelConsumption')}
              value={state.settings.fuelConsumption}
              onChange={(fuelConsumption) => updateSettings({ fuelConsumption })}
              t={t}
            />
          </div>
          <NumberField
            label={t('maintenancePerKm')}
            value={state.settings.maintenancePerKm}
            onChange={(maintenancePerKm) => updateSettings({ maintenancePerKm })}
            t={t}
            step="0.01"
          />
          <p className="sc-help">{t('upkeepExplanation')}</p>
          <NumberField
            label={t('congestionFuelPerHour')}
            value={state.settings.congestionFuelPerHour ?? 0}
            onChange={(congestionFuelPerHour) => updateSettings({ congestionFuelPerHour })}
            t={t}
          />
          <p className="sc-help">{t('congestionExplanation')}</p>
        </div>
        <div className="sc-surface">
          <h2>{t('commutingPattern')}</h2>
          <div className="sc-field-grid">
            <NumberField
              label={t('daysPerWeek')}
              value={state.settings.daysPerWeek}
              onChange={(daysPerWeek) => updateSettings({ daysPerWeek })}
              t={t}
              step="1"
              max={7}
            />
            <NumberField
              label={t('weeksPerMonth')}
              value={state.settings.weeksPerMonth}
              onChange={(weeksPerMonth) => updateSettings({ weeksPerMonth })}
              t={t}
              step="0.01"
            />
          </div>
          <NumberField
            label={t('valueOfTime')}
            value={state.settings.valueOfTime}
            onChange={(valueOfTime) => updateSettings({ valueOfTime })}
            t={t}
          />
          <p className="sc-help">{t('timeValueExplanation')}</p>
        </div>
        <div className="sc-surface">
          <h2>{t('theme')}</h2>
          <div className="sc-appearance-buttons">
            <button
              aria-pressed={theme === 'light'}
              className={theme === 'light' ? 'is-active' : ''}
              onClick={() => setTheme('light')}
            >
              <Sun size={17} />
              {t('light')}
            </button>
            <button
              aria-pressed={theme === 'dark'}
              className={theme === 'dark' ? 'is-active' : ''}
              onClick={() => setTheme('dark')}
            >
              <Moon size={17} />
              {t('dark')}
            </button>
          </div>
          <label className="sc-field">
            {t('language')}
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
        </div>
        <div className="sc-surface">
          <h2>{t('privacy')}</h2>
          <p>{t('storageNote')}</p>
          <button
            className="sc-small-button"
            onClick={() => {
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {
                /* Storage is optional. */
              }
              setState({
                origin: toLocation(props.origin ?? '4 Fong Road, Auckland'),
                destination: toLocation(props.destination),
                settings: { ...DEFAULT_SETTINGS },
                returnPolicy: 'estimate',
                options: createExampleOptions(),
                places: [],
                savedRoutes: [],
                departure: '',
                returnTime: '',
                leaveNow: true,
              });
              setSelectedId('drive');
              setNotice(t('resetDone'));
            }}
          >
            <RotateCcw size={15} />
            {t('reset')}
          </button>
        </div>
      </div>
    </section>
  );
};

export const renderAbout = (m: PlannerModel) => {
  const { props, t } = m;
  return (
    <section className="sc-page-content">
      <div className="sc-page-title">
        <span className="sc-eyebrow">{t('about')}</span>
        <h1>{t('aboutHeading')}</h1>
        <p>{t('aboutDescription')}</p>
      </div>
      <div className="sc-about-grid">
        <div className="sc-surface sc-about-formula">
          <h2>{t('howItWorks')}</h2>
          <strong>{t('formula')}</strong>
          <p>{t('formulaExplanation')}</p>
          <p>{t('timeValueExplanation')}</p>
        </div>
        <div className="sc-surface">
          <h2>{t('privacy')}</h2>
          <p>{t('privacyDescription')}</p>
        </div>
      </div>
      <div className="sc-surface sc-data-sources">
        <h2>{t('dataSources')}</h2>
        {(['exampleSource', 'atSource', 'parkingSource', 'googleSource'] as const).map((key) => (
          <div className="sc-source-row" key={key}>
            <div>
              <h3>{t(key)}</h3>
              <p>{t(`${key}Description` as MessageKey)}</p>
              {key === 'googleSource' && (
                <span className="sc-tag">
                  {t(props.googleApiKey ? 'googleReady' : 'googleNoKey')}
                </span>
              )}
              {key === 'atSource' && (
                <div className="sc-source-links">
                  <a
                    href="https://at.govt.nz/bus-train-ferry/fares-discounts"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('officialFares')}
                    <ArrowRight size={13} />
                  </a>
                  <a href="https://dev-portal.at.govt.nz/" target="_blank" rel="noreferrer">
                    {t('officialDeveloper')}
                    <ArrowRight size={13} />
                  </a>
                </div>
              )}
              {key === 'parkingSource' && (
                <a
                  href="https://at.govt.nz/driving-and-parking/park-ride"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('officialParking')}
                  <ArrowRight size={13} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/** The status line and its next steps; wide screens already show the inputs and plan button. */
export const renderRouteStatus = (m: PlannerModel, className: string) => {
  const {
    isMobile,
    planDisabled,
    routeLoading,
    routeStatusView,
    runStatusAction,
    statusActionLabel,
  } = m;
  const view = routeStatusView();
  const actions = view.actions.filter(
    (action) => isMobile || !['plan', 'edit', 'changeTime', 'costs'].includes(action),
  );
  return (
    <div className={className} role={view.alert ? 'alert' : 'status'}>
      <h3>
        {routeLoading && <span className="sc-spinner" aria-hidden="true" />}
        {view.title}
      </h3>
      {actions.length > 0 && (
        <div className="sc-status-actions">
          {actions.map((action, index) => (
            <button
              key={action}
              className={index === 0 ? 'sc-primary-button' : 'sc-small-button'}
              onClick={() => runStatusAction(action)}
              disabled={action === 'plan' && planDisabled}
            >
              {statusActionLabel(action)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const renderBanners = (m: PlannerModel) => {
  const { arrivalAt, aucklandClock, comparison, nameOf, online, returnBeforeArrival, t } = m;
  return (
    <>
      {returnBeforeArrival && (
        <p className="sc-connection-banner sc-incomplete-warning" role="alert">
          <Info size={16} />
          {t('returnBeforeArrival', { time: aucklandClock.format(arrivalAt) })}
        </p>
      )}
      {comparison.pendingFareOptions.length > 0 && (
        <section className="sc-connection-banner sc-incomplete-warning" role="status">
          <Info size={16} />
          <div>
            <p>{t('farePendingNotice')}</p>
            <ul>
              {comparison.pendingFareOptions.map((option) => (
                <li key={option.id}>
                  <strong>{nameOf(option)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {!online && (
        <p className="sc-connection-banner" role="status">
          <WifiOff size={16} />
          {t('offlineConnection')}
        </p>
      )}
      {comparison.incompleteOptions.length > 0 && (
        <section className="sc-connection-banner sc-incomplete-warning" role="alert">
          <Info size={16} />
          <div>
            <p>{t('incompleteReturnNotice')}</p>
            <ul>
              {comparison.incompleteOptions.map((option) => (
                <li key={option.id}>
                  <strong>{nameOf(option)}</strong> — {t('returnWarning')}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {comparison.staleFareOptions.length > 0 && (
        <section className="sc-connection-banner sc-incomplete-warning" role="alert">
          <Info size={16} />
          <div>
            <p>{t('staleFareNotice')}</p>
            <ul>
              {comparison.staleFareOptions.map((option) => (
                <li key={option.id}>
                  <strong>{nameOf(option)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
};

export const renderRegistry = (m: PlannerModel) => {
  const { t } = m;
  return (
    <section className="sc-page-content sc-registry">
      <div className="sc-surface">
        <h2>{t('sourceRegistry')}</h2>
        {DATA_SOURCES.map((source) => (
          <div className="sc-source-row" key={source.id}>
            <div>
              <strong>{source.name}</strong>
              <p>{t('sourceReviewed', { date: source.verifiedOn, status: source.status })}</p>
              {source.url && (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {t('openOfficial')}
                </a>
              )}
            </div>
          </div>
        ))}
        <div className="sc-source-links">
          <a href={`${import.meta.env.BASE_URL}privacy.html`}>{t('privacyPolicy')}</a>
          <a href={`${import.meta.env.BASE_URL}terms.html`}>{t('termsOfUse')}</a>
        </div>
      </div>
    </section>
  );
};
