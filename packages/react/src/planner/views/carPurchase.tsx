import { NumberField } from '../fields';
import { type PlannerModel } from '../usePlannerModel';

/** Whether buying a car pays for itself on this commute, for one to seven days a week. */
export const renderCarPurchase = (m: PlannerModel) => {
  const {
    carPurchase,
    googleMode,
    money,
    nameOf,
    otherLiveMode,
    plannerId,
    setState,
    state,
    switchLiveMode,
    t,
    tripScope,
    updateOwnership,
  } = m;
  const { ownership } = state;
  const { analysis } = carPurchase;
  return (
    <section className="sc-surface sc-car-purchase" aria-labelledby={`${plannerId}-buy-car`}>
      <h2 id={`${plannerId}-buy-car`}>{t('buyCarHeading')}</h2>
      <p>{t('buyCarDescription')}</p>
      <div className="sc-field-grid">
        <NumberField
          label={t('purchasePrice')}
          value={ownership.purchasePrice}
          onChange={(purchasePrice) => updateOwnership({ purchasePrice })}
          t={t}
          step="500"
        />
        <NumberField
          label={t('resaleValue')}
          value={ownership.resaleValue}
          onChange={(resaleValue) => updateOwnership({ resaleValue })}
          t={t}
          step="500"
        />
        <NumberField
          label={t('yearsOwned')}
          value={ownership.yearsOwned}
          onChange={(yearsOwned) => updateOwnership({ yearsOwned })}
          t={t}
          step="1"
        />
        <NumberField
          label={t('insurancePerYear')}
          value={ownership.insurancePerYear}
          onChange={(insurancePerYear) => updateOwnership({ insurancePerYear })}
          t={t}
          step="10"
        />
        <NumberField
          label={t('licencePerYear')}
          value={ownership.licencePerYear}
          onChange={(licencePerYear) => updateOwnership({ licencePerYear })}
          t={t}
          step="0.01"
        />
        <NumberField
          label={t('wofPerYear')}
          value={ownership.wofPerYear}
          onChange={(wofPerYear) => updateOwnership({ wofPerYear })}
          t={t}
          step="5"
        />
        <NumberField
          label={t('commuteSharePercent')}
          value={Math.round(ownership.commuteShare * 100)}
          onChange={(percent) => updateOwnership({ commuteShare: percent / 100 })}
          t={t}
          step="5"
          max={100}
        />
      </div>
      <p className="sc-help">{t('ownershipHelp')}</p>
      <label className="sc-checkbox">
        <input
          type="checkbox"
          checked={state.applyFareCap}
          onChange={(event) =>
            setState((current) => ({ ...current, applyFareCap: event.target.checked }))
          }
        />
        <span>{t('applyFareCap')}</span>
      </label>
      <p className="sc-help">{t('fareCapHelp')}</p>
      {carPurchase.invalid ? (
        <p className="sc-error" role="alert">
          {t('buyCarInvalid')}
        </p>
      ) : !analysis ? (
        <div className="sc-car-purchase-empty" role="status">
          <p>{t('buyCarNeedsBoth')}</p>
          {googleMode && (
            <button className="sc-small-button" onClick={() => switchLiveMode(otherLiveMode)}>
              {t('buyCarPlanMode', { mode: t(otherLiveMode) })}
            </button>
          )}
        </div>
      ) : (
        <>
          <dl className="sc-cost-lines">
            {(['depreciation', 'insurance', 'licence', 'wof'] as const).map((key) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>{money(analysis.fixed[key])}</dd>
              </div>
            ))}
            <div className="sc-cost-total">
              <dt>{t('fixedMonthly')}</dt>
              <dd>{money(analysis.fixed.total)}</dd>
            </div>
          </dl>
          <p className="sc-scope-note">
            {t('buyCarCompared', {
              car: nameOf(analysis.carOption),
              transit: nameOf(analysis.transitOption),
              scope: tripScope,
            })}
          </p>
          <div className="sc-table-wrap sc-table-compact">
            <table>
              <thead>
                <tr>
                  <th>{t('daysPerWeekColumn')}</th>
                  <th>{t('withCar')}</th>
                  <th>{t('withoutCar')}</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.map((row) => {
                  const current = row.daysPerWeek === state.settings.daysPerWeek;
                  const carCheaper = row.withCar <= row.withoutCar;
                  return (
                    <tr key={row.daysPerWeek} className={current ? 'is-selected' : ''}>
                      <td>
                        {row.daysPerWeek}
                        {current && <span className="sc-unit"> · {t('yourDays')}</span>}
                      </td>
                      <td>
                        {carCheaper ? <strong>{money(row.withCar)}</strong> : money(row.withCar)}
                      </td>
                      <td>
                        {carCheaper ? (
                          money(row.withoutCar)
                        ) : (
                          <strong>{money(row.withoutCar)}</strong>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sc-car-purchase-verdict" role="status">
            {analysis.breakEvenDays !== null
              ? t('buyCarBreakEven', { days: analysis.breakEvenDays })
              : analysis.capPreventsPayoff
                ? t('buyCarCapNever')
                : t('buyCarNever')}
          </p>
          <p className="sc-help">{t('buyCarMoneyOnly')}</p>
        </>
      )}
    </section>
  );
};
