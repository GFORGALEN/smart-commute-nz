import { expect, test, type Page } from '@playwright/test';

async function openPlanner(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('route-card-drive')).toBeVisible();
}

async function showInputs(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Edit journey inputs', exact: true });
  if (await toggle.isVisible()) await toggle.click();
}

async function showRouteDetails(page: Page, editor: string): Promise<void> {
  await page
    .getByTestId(editor)
    .locator('summary')
    .filter({ hasText: /^Times, tolls and segments$/ })
    .click();
}

async function navigate(page: Page, name: string): Promise<void> {
  await page.getByRole('tablist').getByRole('tab', { name, exact: true }).click();
}

test('no API key: all three editable manual routes compare with disclosed assumptions', async ({
  page,
}) => {
  await openPlanner(page);
  await expect(page.getByTestId('route-card-drive')).toContainText('10.91');
  await expect(page.getByTestId('route-card-hybrid')).toContainText('18.41');
  await expect(page.getByTestId('route-card-transit')).toContainText('13.00');
  await expect(page.getByText('Offline example', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/editable assumptions, not live Google or Auckland Transport data/),
  ).toBeVisible();
  await navigate(page, 'About & sources');
  await expect(
    page.getByText('No Google API key configured. Manual mode is fully available.', {
      exact: true,
    }),
  ).toBeVisible();
});

test('editing fuel price changes costs and recommendation, then persists across reload', async ({
  page,
}) => {
  await openPlanner(page);
  await navigate(page, 'Settings');
  await page.getByLabel('Fuel price (NZ$/L)', { exact: true }).fill('5');
  await navigate(page, 'Planner');
  await expect(page.getByTestId('route-card-drive')).toContainText('15.58');
  await expect(page.getByTestId('route-card-transit')).toContainText('Lowest cost');
  await page.reload();
  await expect(page.getByTestId('route-card-drive')).toContainText('15.58');
  await navigate(page, 'Settings');
  await expect(page.getByLabel('Fuel price (NZ$/L)', { exact: true })).toHaveValue('5');
});

test('independent public transport fares change the daily price and cheapest choice', async ({
  page,
}) => {
  await openPlanner(page);
  await showInputs(page);
  await page.getByRole('button', { name: 'Public transport', exact: true }).click();
  const editor = page.getByTestId('route-editor-transit');
  await editor.getByLabel('Public transport fare — outbound', { exact: true }).fill('1');
  await editor.getByLabel('Public transport fare — return', { exact: true }).fill('2');
  await expect(page.getByTestId('route-card-transit')).toContainText('3.00');
  await expect(page.getByTestId('route-card-transit')).toContainText('Lowest cost');
});

test('verified AT zones apply independent static fares with transparent provenance', async ({
  page,
}) => {
  await openPlanner(page);
  await showInputs(page);
  await page.getByLabel('Leave now', { exact: true }).uncheck();
  await page.getByLabel('Departure time', { exact: true }).fill('2026-10-09T10:00');
  await page.getByLabel('Return time', { exact: true }).fill('2026-10-09T17:00');
  await page.getByRole('button', { name: 'Public transport', exact: true }).click();
  const editor = page.getByTestId('route-editor-transit');
  const helper = page.getByTestId('at-fare-helper-transit');
  await helper
    .locator('summary')
    .filter({ hasText: /^Estimate with AT fare rules$/ })
    .click();
  await helper
    .getByRole('combobox', { name: 'Outbound verified zones', exact: true })
    .selectOption('2');
  await helper
    .getByRole('combobox', { name: 'Return verified zones', exact: true })
    .selectOption('3');
  const apply = helper.getByRole('button', { name: 'Apply AT fare estimate', exact: true });
  await expect(apply).toBeDisabled();
  await helper
    .getByLabel('I have verified these fare zones in the official AT Journey Planner.', {
      exact: true,
    })
    .check();
  await apply.click();
  await expect(page.getByTestId('route-card-transit')).toContainText('11.40');
  await expect(page.getByTestId('route-card-transit')).toContainText(
    'AT fare estimate · manual travel times',
  );
  await expect(editor.getByLabel('Public transport fare — outbound', { exact: true })).toHaveValue(
    '4.9',
  );
  await expect(editor.getByLabel('Public transport fare — return', { exact: true })).toHaveValue(
    '6.5',
  );
});

test('outbound and return use different distances and parking is charged once', async ({
  page,
}) => {
  await openPlanner(page);
  await showInputs(page);
  const editor = page.getByTestId('route-editor-drive');
  await editor.getByLabel('Outbound distance (km)', { exact: true }).fill('10');
  await editor.getByLabel('Return distance (km)', { exact: true }).fill('30');
  await editor.getByLabel('Parking per commute (NZ$)', { exact: true }).fill('12');
  await expect(page.getByTestId('route-card-drive')).toContainText('23.48');
  await page.getByLabel('Include the return journey', { exact: true }).uncheck();
  await expect(page.getByTestId('route-card-drive')).toContainText('14.87');
  await expect(page.getByText('one way', { exact: true })).toBeVisible();
  await page.getByLabel('Include the return journey', { exact: true }).check();
  await expect(page.getByTestId('route-card-drive')).toContainText('23.48');
});

test('a waypoint is saved as a manual preference without fabricating a new distance', async ({
  page,
}) => {
  await openPlanner(page);
  await showInputs(page);
  await showRouteDetails(page, 'route-editor-drive');
  await page
    .getByPlaceholder('Add a stop, station or via point', { exact: true })
    .fill('Panmure station');
  await page.getByRole('button', { name: 'Add waypoint', exact: true }).click();
  await expect(page.getByText('Panmure station', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'In manual mode, a waypoint records your route preference. Update distance and time yourself.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId('route-card-drive')).toContainText('10.91');
  await page.reload();
  await showInputs(page);
  await showRouteDetails(page, 'route-editor-drive');
  await expect(page.getByText('Panmure station', { exact: true })).toBeVisible();
});

test('edited locations and saved-place actions survive reload', async ({ page }) => {
  await openPlanner(page);
  await showInputs(page);
  const origin = 'Manual origin, Auckland';
  const destination = 'Manual destination, Auckland';
  await page.getByLabel('Starting point', { exact: true }).fill(origin);
  await page.getByRole('button', { name: 'Save starting point', exact: true }).click();
  await page.getByLabel('Destination', { exact: true }).fill(destination);
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await expect(page.getByTestId('route-card-drive')).toContainText('10.91');
  await page.reload();
  await showInputs(page);
  await expect(page.getByLabel('Starting point', { exact: true })).toHaveValue(origin);
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue(destination);
  await page
    .locator('summary')
    .filter({ hasText: /^Saved places$/ })
    .click();
  await page
    .getByRole('button', { name: `Use as starting point ${destination}`, exact: true })
    .click();
  await expect(page.getByLabel('Starting point', { exact: true })).toHaveValue(destination);
  await page.getByRole('button', { name: `Use as destination ${origin}`, exact: true }).click();
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue(origin);
});

test('Chinese navigation and planner labels follow the language selection', async ({ page }) => {
  await openPlanner(page);
  await page.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await expect(
    page.getByRole('tablist').getByRole('tab', { name: '方案比较', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.sc-map-toolbar').getByText('一眼看懂你的行程', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('tablist').getByRole('tab', { name: '路线规划', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('语言', { exact: true })).toHaveValue('zh-CN');
});

test('the loaded app still recalculates without a network connection', async ({
  page,
  context,
}) => {
  await openPlanner(page);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await navigate(page, 'Settings');
  await page.getByLabel('Fuel price (NZ$/L)', { exact: true }).fill('4');
  await navigate(page, 'Planner');
  await expect(page.getByTestId('route-card-drive')).toContainText('12.46');
  await context.setOffline(false);
});

test('planner, comparison, breakdown and settings fit the device width', async ({ page }) => {
  await openPlanner(page);
  for (const name of ['Planner', 'Comparison', 'Cost breakdown', 'Settings', 'About & sources']) {
    await navigate(page, name);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, `${name} document width`).toBeLessThanOrEqual(
      dimensions.viewport + 1,
    );
    expect(dimensions.body, `${name} body width`).toBeLessThanOrEqual(dimensions.viewport + 1);
    await expect(page.getByRole('tablist')).toBeVisible();
  }
});

test('production build reloads from its service-worker cache while offline', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.PLAYWRIGHT_PRODUCTION !== '1',
    'Offline reload requires the production service worker.',
  );
  await openPlanner(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('route-card-drive')).toContainText('10.91');
  await navigate(page, 'Settings');
  await page.getByLabel('Fuel price (NZ$/L)', { exact: true }).fill('4');
  await navigate(page, 'Planner');
  await expect(page.getByTestId('route-card-drive')).toContainText('12.46');
  await page.goto('privacy.html');
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await page.goto('./');
  await expect(page.getByTestId('route-card-drive')).toContainText('12.46');
  await context.setOffline(false);
});
