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
  await expect(widget.getByTestId('route-card-drive')).toContainText('13.95');
  // On a phone the widget opens on its map; places and costs are on their own pages.
  const phone = (await widget.locator('.sc-mobile').count()) > 0;
  if (phone) await widget.getByRole('button', { name: /^Edit route:/ }).click();
  await expect(widget.getByLabel('Destination', { exact: true })).toHaveValue('Panmure station');
  if (phone) {
    await widget
      .locator('.sc-route-footer')
      .getByRole('button', { name: 'Done', exact: true })
      .click();
    await widget.getByRole('button', { name: 'Adjust fares and costs', exact: true }).click();
  }
  await widget.getByLabel('Fuel price (NZ$/L)', { exact: true }).fill('5');
  await expect(widget.getByTestId('route-card-drive')).toContainText('18.62');
  await expect(widget.getByTestId('route-card-transit')).toContainText('Lowest cost');
});
