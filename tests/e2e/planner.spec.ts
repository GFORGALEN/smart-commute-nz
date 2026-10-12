import { expect, test, type Page } from '@playwright/test';

async function openPlanner(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('route-card-drive')).toBeVisible();
}

/** Phones show a map first; their route and cost inputs open as separate pages. */
async function isPhone(page: Page): Promise<boolean> {
  return (await page.locator('.smart-commute.sc-mobile').count()) > 0;
}

async function closePages(page: Page): Promise<void> {
  for (let open = await page.getByRole('dialog').count(); open > 0; open -= 1) {
    const dialog = page.getByRole('dialog');
    // The route page keeps edits only when confirmed; every other page closes with Back.
    if ((await dialog.getAttribute('data-page')) === 'route') await confirmRoute(page);
    else await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(open - 1);
  }
}

/** Typing a place opens its search state; Done there returns to the compact route editor. */
async function finishPlaceSearch(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Edit route' });
  if (await dialog.getAttribute('data-searching'))
    await dialog.locator('.sc-page-bar').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toHaveAttribute('data-searching');
}

/** Phones set trip type and times in a panel opened from the route editor's footer. */
async function openTimePanel(page: Page): Promise<void> {
  await finishPlaceSearch(page);
  await page.getByRole('dialog', { name: 'Edit route' }).locator('.sc-trip-button').click();
}

async function closeTimePanel(page: Page): Promise<void> {
  await page
    .locator('.sc-schedule-panel')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
}

async function setRoundTrip(page: Page, roundTrip: boolean): Promise<void> {
  if (!(await isPhone(page))) {
    const box = page.getByLabel('Include the return journey', { exact: true });
    await (roundTrip ? box.check() : box.uncheck());
    return;
  }
  await openTimePanel(page);
  await page
    .getByRole('button', { name: roundTrip ? 'Return trip' : 'One way', exact: true })
    .click();
  await closeTimePanel(page);
}

async function setTimes(page: Page, departure: string, returnTime: string): Promise<void> {
  if (await isPhone(page)) {
    await openTimePanel(page);
    await page
      .getByRole('group', { name: 'Departure' })
      .getByRole('button', { name: 'Choose a time', exact: true })
      .click();
  } else await page.getByLabel('Leave now', { exact: true }).uncheck();
  await page.getByLabel('Departure time', { exact: true }).fill(departure);
  await page.getByLabel('Return time', { exact: true }).fill(returnTime);
  if (await isPhone(page)) await closeTimePanel(page);
}

/** Saving places and the saved list live under More on the phone route editor. */
async function showMore(page: Page): Promise<void> {
  if (!(await isPhone(page))) return;
  await finishPlaceSearch(page);
  const more = page
    .getByRole('dialog', { name: 'Edit route' })
    .getByRole('button', { name: 'More', exact: true });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}

async function editRoute(page: Page): Promise<void> {
  if (!(await isPhone(page))) return;
  await closePages(page);
  await page.getByRole('button', { name: /^Edit route:/ }).click();
}

async function confirmRoute(page: Page): Promise<void> {
  if (!(await isPhone(page))) return;
  await finishPlaceSearch(page);
  await page
    .getByRole('dialog', { name: 'Edit route' })
    .locator('.sc-route-footer')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function editCosts(page: Page): Promise<void> {
  if (!(await isPhone(page))) return;
  await closePages(page);
  await page.getByRole('button', { name: 'Adjust fares and costs', exact: true }).click();
}

async function showRouteDetails(page: Page, editor: string): Promise<void> {
  await page
    .getByTestId(editor)
    .locator('summary')
    .filter({ hasText: /^Times, tolls and segments$/ })
    .click();
}

async function navigate(page: Page, name: string): Promise<void> {
  if (!(await isPhone(page))) {
    await page.getByRole('tablist').getByRole('tab', { name, exact: true }).click();
    return;
  }
  await closePages(page);
  if (name === 'Planner') return;
  if (name === 'Settings' || name === 'About & sources') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    if (name === 'About & sources')
      await page.getByRole('button', { name: 'About & sources', exact: true }).click();
    return;
  }
  const entry = name === 'Comparison' ? 'Compare all' : name;
  await page.getByRole('button', { name: entry, exact: true }).click();
}

test('no API key: all three editable manual routes compare with disclosed assumptions', async ({
  page,
}) => {
  await openPlanner(page);
  await expect(page.getByTestId('route-card-drive')).toContainText('13.95');
  await expect(page.getByTestId('route-card-hybrid')).toContainText('20.81');
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
  await expect(page.getByTestId('route-card-drive')).toContainText('18.62');
  await expect(page.getByTestId('route-card-transit')).toContainText('Lowest cost');
  await page.reload();
  await expect(page.getByTestId('route-card-drive')).toContainText('18.62');
  await navigate(page, 'Settings');
  await expect(page.getByLabel('Fuel price (NZ$/L)', { exact: true })).toHaveValue('5');
});

test('independent public transport fares change the daily price and cheapest choice', async ({
  page,
}) => {
  await openPlanner(page);
  await editCosts(page);
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
  await editRoute(page);
  await setTimes(page, '2026-10-09T10:00', '2026-10-09T17:00');
  await confirmRoute(page);
  await editCosts(page);
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
  await editCosts(page);
  const editor = page.getByTestId('route-editor-drive');
  await editor.getByLabel('Outbound distance (km)', { exact: true }).fill('10');
  await editor.getByLabel('Return distance (km)', { exact: true }).fill('30');
  await editor.getByLabel('Parking per commute (NZ$)', { exact: true }).fill('12');
  await expect(page.getByTestId('route-card-drive')).toContainText('26.68');
  await editRoute(page);
  await setRoundTrip(page, false);
  await confirmRoute(page);
  await expect(page.getByTestId('route-card-drive')).toContainText('15.67');
  await expect(page.getByText('one way', { exact: true })).toBeVisible();
  await editRoute(page);
  await setRoundTrip(page, true);
  await confirmRoute(page);
  await expect(page.getByTestId('route-card-drive')).toContainText('26.68');
});

test('a waypoint is saved as a manual preference without fabricating a new distance', async ({
  page,
}) => {
  await openPlanner(page);
  await editCosts(page);
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
  await expect(page.getByTestId('route-card-drive')).toContainText('13.95');
  await page.reload();
  await editCosts(page);
  await showRouteDetails(page, 'route-editor-drive');
  await expect(page.getByText('Panmure station', { exact: true })).toBeVisible();
});

test('edited locations and saved-place actions survive reload', async ({ page }) => {
  await openPlanner(page);
  await editRoute(page);
  const origin = 'Manual origin, Auckland';
  const destination = 'Manual destination, Auckland';
  await page.getByLabel('Starting point', { exact: true }).fill(origin);
  await showMore(page);
  await page.getByRole('button', { name: 'Save starting point', exact: true }).click();
  await page.getByLabel('Destination', { exact: true }).fill(destination);
  await showMore(page);
  await page.getByRole('button', { name: 'Save destination', exact: true }).click();
  await confirmRoute(page);
  await expect(page.getByTestId('route-card-drive')).toContainText('13.95');
  await page.reload();
  await editRoute(page);
  await expect(page.getByLabel('Starting point', { exact: true })).toHaveValue(origin);
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue(destination);
  await showMore(page);
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
  if (await isPhone(page)) {
    // Phones keep language with the other settings, behind the button beside the route card.
    await navigate(page, 'Settings');
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '语言', exact: true })).toHaveValue('zh-CN');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByRole('button', { name: /^编辑路线:/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '详细比较', exact: true })).toBeVisible();
    return;
  }
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
  await expect(page.getByTestId('route-card-drive')).toContainText('15.50');
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
    if (!(await isPhone(page))) await expect(page.getByRole('tablist')).toBeVisible();
    else if (name !== 'Planner') await expect(page.getByRole('dialog')).toBeVisible();
  }
});

test('phones open on a usable map with the route and cost in view at common widths', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    await openPlanner(page);
    const layout = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        map: box('.sc-mobile-map'),
        card: box('.sc-route-card'),
        cost: box('[data-testid="selected-cost"]'),
        tools: [...document.querySelectorAll('.sc-map-tool')].map((tool) => {
          const rect = tool.getBoundingClientRect();
          return { top: Math.round(rect.top), width: rect.width, height: rect.height };
        }),
      };
    });
    // The summary has its own row; the tools sit side by side beneath it at touch size.
    expect(new Set(layout.tools.map((tool) => tool.top)).size).toBe(1);
    expect(layout.tools[0]!.top).toBeGreaterThan(layout.card.bottom);
    for (const tool of layout.tools) {
      expect(tool.width).toBeGreaterThanOrEqual(44);
      expect(tool.height).toBeGreaterThanOrEqual(44);
    }
    expect(layout.scrollWidth, `${width}px width`).toBeLessThanOrEqual(layout.viewport.width);
    // The shell fills the screen; only the sheet and pages scroll inside it.
    expect(layout.scrollHeight, `${width}px height`).toBeLessThanOrEqual(layout.viewport.height);
    expect(layout.map.height, `${width}px map`).toBeGreaterThan(200);
    expect(layout.card.top).toBeGreaterThanOrEqual(0);
    expect(layout.cost.bottom).toBeLessThanOrEqual(layout.viewport.height);
  }
});

test('phone pages close with the system back button and keep the chosen option', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Phone layout only.');
  await openPlanner(page);
  await page.getByTestId('route-card-transit').click();
  await expect(page.getByTestId('selected-cost')).toContainText('13.00');
  await page.getByRole('button', { name: 'Compare all', exact: true }).click();
  await page.getByRole('button', { name: 'Cost breakdown', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Cost breakdown' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Comparison' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('selected-cost')).toContainText('13.00');

  // Back first leaves the place search, then the route page, restoring the planned trip.
  await editRoute(page);
  await page.getByLabel('Destination', { exact: true }).fill('Albany, Auckland');
  await page.goBack();
  await expect(page.getByLabel('Starting point', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit route:/ })).toContainText('Britomart');

  // The sheet collapses to its summary and opens again from the same button.
  await page.getByRole('button', { name: 'Hide options', exact: true }).click();
  await expect(page.getByTestId('route-card-drive')).toBeHidden();
  await expect(page.getByTestId('selected-cost')).toBeVisible();
  await page.getByRole('button', { name: 'Show options', exact: true }).click();
  await expect(page.getByTestId('route-card-drive')).toBeVisible();
});

test('entered times mean the same Auckland instant in Shanghai and Auckland browsers', async ({
  browser,
}, testInfo) => {
  const device = testInfo.project.use;
  for (const timezoneId of ['Asia/Shanghai', 'Pacific/Auckland']) {
    const context = await browser.newContext({ ...device, timezoneId });
    const page = await context.newPage();
    await openPlanner(page);
    await editRoute(page);
    await setTimes(page, '2026-10-13T08:00', '2026-10-13T18:00');
    await confirmRoute(page);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('smart-commute-nz:v1') ?? '{}'),
    );
    // 08:00 and 18:00 in Auckland daylight time are 19:00 and 05:00 UTC.
    expect(saved, timezoneId).toMatchObject({
      timesVersion: 2,
      timeZone: 'Pacific/Auckland',
      departure: '2026-10-13T08:00',
      departureInstant: Date.UTC(2026, 9, 12, 19, 0),
      returnInstant: Date.UTC(2026, 9, 13, 5, 0),
    });
    await expect(
      page
        .getByTestId('route-card-drive')
        .locator('.sc-result-clock')
        .or(page.locator('.sc-sheet-meta')),
    ).toContainText('08:00');
    await context.close();
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
  await expect(page.getByTestId('route-card-drive')).toContainText('13.95');
  await navigate(page, 'Settings');
  await page.getByLabel('Fuel price (NZ$/L)', { exact: true }).fill('4');
  await navigate(page, 'Planner');
  await expect(page.getByTestId('route-card-drive')).toContainText('15.50');
  await page.goto('privacy.html');
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await page.goto('./');
  await expect(page.getByTestId('route-card-drive')).toContainText('15.50');
  await context.setOffline(false);
});
