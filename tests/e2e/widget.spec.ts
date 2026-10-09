import { expect, test } from '@playwright/test';

test('standalone widget mounts without a host framework and recalculates', async ({ page }) => {
  test.skip(
    process.env.PLAYWRIGHT_PRODUCTION !== '1',
    'Widget bundle is produced by the production build.',
  );
  await page.goto('./');
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'independent-widget';
    document.body.replaceChildren(host);
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./widget/smart-commute-widget.css', location.href).href;
    document.head.appendChild(stylesheet);
    const url = new URL('./widget/smart-commute-widget.js', location.href).href;
    const widget = await import(url);
    widget.mountSmartCommutePlanner(host, { destination: 'Panmure station', fuelPrice: 3.5 });
  });
  const widget = page.locator('#independent-widget');
  await expect(widget.getByTestId('route-card-drive')).toContainText('10.91');
  const toggle = widget.getByRole('button', { name: 'Edit journey inputs', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await expect(widget.getByLabel('Destination', { exact: true })).toHaveValue('Panmure station');
  await widget.getByLabel('Fuel price (NZ$/L)', { exact: true }).fill('5');
  await expect(widget.getByTestId('route-card-drive')).toContainText('15.58');
  await expect(widget.getByTestId('route-card-transit')).toContainText('Lowest cost');
});
