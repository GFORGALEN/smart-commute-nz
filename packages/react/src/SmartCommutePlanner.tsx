import { Check, Moon, Route, Sun, X } from 'lucide-react';
import { type Locale } from '@smart-commute/i18n';
import { shortNumber } from './planner/helpers';
import { type SmartCommutePlannerProps } from './planner/types';
import { usePlannerModel } from './planner/usePlannerModel';
import { renderInputs } from './planner/views/journeyInputs';
import { renderMobileShell } from './planner/views/mobile';
import {
  renderBreakdown,
  renderComparison,
  renderGoogleAttribution,
  renderResults,
  renderSchematic,
} from './planner/views/results';
import {
  renderAbout,
  renderBanners,
  renderRegistry,
  renderSettings,
} from './planner/views/screens';

export type { SmartCommutePlannerProps } from './planner/types';

export function SmartCommutePlanner(props: SmartCommutePlannerProps) {
  const m = usePlannerModel(props);
  const {
    googleMode,
    isMobile,
    locale,
    moneyWithRange,
    nameOf,
    notice,
    plannerId,
    screen,
    selected,
    setLocale,
    setNotice,
    setScreen,
    setTheme,
    showResults,
    summaryInView,
    t,
    tabs,
    theme,
    tripScope,
  } = m;
  return (
    <div className={`smart-commute sc-theme-${theme} ${isMobile ? 'sc-mobile' : ''}`} lang={locale}>
      {!isMobile && (
        <header className="sc-header">
          <a
            className="sc-brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              setScreen('planner');
            }}
          >
            <span className="sc-brand-symbol" aria-hidden="true">
              <Route size={18} />
            </span>
            <span className="sc-brand-text">
              <strong>
                {t('appName')}
                <span className="sc-brand-nz">NZ</span>
              </strong>
              <small>{t('region')}</small>
            </span>
          </a>
          <div className="sc-header-actions">
            <span className="sc-header-status">
              <span className="sc-status-dot" aria-hidden="true" />
              {t(googleMode ? 'googleOnline' : 'manualMode')}
            </span>
            <select
              aria-label={t('language')}
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              <option value="en">EN</option>
              <option value="zh-CN">简体中文</option>
            </select>
            <button
              className="sc-icon-button"
              aria-label={t(theme === 'light' ? 'dark' : 'light')}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </header>
      )}
      {isMobile ? (
        renderMobileShell(m)
      ) : (
        <>
          <nav className="sc-navigation" role="tablist" aria-label={t('appName')}>
            {tabs.map((tab, index) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={screen === tab.key}
                aria-controls={`${plannerId}-screen`}
                id={`${plannerId}-tab-${tab.key}`}
                tabIndex={screen === tab.key ? 0 : -1}
                className={screen === tab.key ? 'is-active' : ''}
                onClick={() => setScreen(tab.key)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? tabs.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setScreen(tabs[next].key);
                  const buttons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    );
                  buttons?.[next]?.focus();
                }}
              >
                {t(tab.label)}
              </button>
            ))}
          </nav>
          <main
            id={`${plannerId}-screen`}
            role="tabpanel"
            aria-labelledby={`${plannerId}-tab-${screen}`}
            tabIndex={0}
          >
            {renderBanners(m)}
            {screen === 'planner' && (
              <div className="sc-workspace">
                <div className="sc-plan-column">
                  <section className="sc-planner-intro">
                    <h1>{t('headline')}</h1>
                    <p>{t('subheadline')}</p>
                    {!googleMode && (
                      <div className="sc-demo-banner">
                        <span className="sc-tag">{t('demoData')}</span>
                        <p>{t('demoNotice')}</p>
                      </div>
                    )}
                  </section>
                  {renderInputs(m)}
                  {renderResults(m)}
                  {renderGoogleAttribution(m)}
                  {selected && !summaryInView && (
                    <div className="sc-selected-bar">
                      <span className="sc-selected-bar-text">
                        <span>{nameOf(selected)}</span>
                        <strong>
                          {moneyWithRange(selected.totalCost, selected.totalCostRange)}
                        </strong>
                        <span>
                          {tripScope} ·{' '}
                          {t('minutes', { count: shortNumber(selected.totalMinutes) })}
                        </span>
                      </span>
                      <button className="sc-small-button" onClick={showResults}>
                        {t('viewOptions')}
                      </button>
                    </div>
                  )}
                </div>
                {renderSchematic(m)}
              </div>
            )}
            {screen === 'comparison' && renderComparison(m)}
            {screen === 'breakdown' && renderBreakdown(m)}
            {screen === 'settings' && renderSettings(m)}
            {screen === 'about' && renderAbout(m)}
            {screen !== 'planner' && renderGoogleAttribution(m)}
            {screen === 'about' && renderRegistry(m)}
          </main>
          <footer className="sc-footer">
            <span>{t('footer')}</span>
            <span>{t(googleMode ? 'googleDetails' : 'offlineStatus')}</span>
          </footer>
        </>
      )}
      {notice && (
        <div className="sc-toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="sc-icon-button"
            aria-label={t('dismissNotice')}
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
