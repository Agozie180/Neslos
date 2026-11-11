import { test, expect, type Page } from '@playwright/test';

async function runToVerification(page: Page) {
  await page.goto('/#challenge');
  await page.getByRole('button', { name: 'Start the challenge', exact: true }).click();
  await expect(page.getByText('Overspend rejected', { exact: true })).toBeVisible();
  await expect(page.locator('.challenge-budget strong')).toHaveText('$500.00');
  await page.getByRole('button', { name: 'Run the $150 mission', exact: true }).click();
  await expect(page.getByText('Allowed reserve completed', { exact: true })).toBeVisible();
  await expect(page.locator('.challenge-budget strong')).toHaveText('$350.00');
}

test('guided challenge runs actual missions, verifies receipts and exposes dated evidence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Give agents ambition. Keep the authority.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/neslos-competition-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Take the 60-second challenge' }).click();
  await expect(page).toHaveURL(/#challenge$/);
  await runToVerification(page);
  await page.getByRole('button', { name: 'Verify & tamper-test receipts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambition met its boundary.' })).toBeVisible();
  await expect(page.locator('.proof-results')).toContainText('Tampered copy rejected');
  await expect(page.locator('.challenge-steps .done')).toHaveCount(3);
  const response = await page.request.get('/api/state');
  const state = await response.json();
  expect(state.runs).toHaveLength(2);
  expect(state.runs.map((run: { status: string }) => run.status).sort()).toEqual(['blocked', 'settled']);
  expect(state.budget.spent).toBe('150000000');
  expect(state.budget.reserved).toBe('0');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download this proof', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs('artifacts/neslos-boundary-challenge.json');
  await page.screenshot({ path: 'artifacts/neslos-challenge-complete.png', fullPage: true });
  await page.getByRole('button', { name: 'Inspect the real-world evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The contract says no.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Daily limit enforced/ })).toHaveAttribute('href', 'https://testnet.nearblocks.io/txns/2MYWSFeJPo5zs3oRGnKx1UM186Tu52gskNG74NwNsgnN');
  await expect(page.locator('.research-proof-rows > div')).toHaveCount(3);
  await expect(page.locator('.caveat-proof')).toContainText('0.0071149895375 NEAR');
  await expect(page.locator('.caveat-proof')).toContainText('0.004 NEAR');
  await page.screenshot({ path: 'artifacts/neslos-evidence-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/neslos-evidence-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Boundary challenge', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Ambition met its boundary.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/neslos-challenge-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('a lost start response recovers the same mission without a duplicate', async ({ page }) => {
  const requestIds: string[] = [];
  let loseFirst = true;
  await page.route('**/api/runs', async route => {
    requestIds.push(route.request().postDataJSON().requestId);
    if (loseFirst) {
      loseFirst = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.goto('/#challenge');
  await page.getByRole('button', { name: 'Start the challenge', exact: true }).click();
  await expect(page.locator('.challenge-error')).toBeVisible();
  await page.getByRole('button', { name: 'Recover the overspend request', exact: true }).click();
  await expect(page.getByText('Overspend rejected', { exact: true })).toBeVisible();
  const state = await (await page.request.get('/api/state')).json();
  expect(state.runs).toHaveLength(1);
  expect(state.budget.remaining).toBe('500000000');
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
});

test('failed browser verification never produces a passing challenge', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(SubtleCrypto.prototype, 'verify', { value: async () => false });
  });
  await runToVerification(page);
  await page.getByRole('button', { name: 'Verify & tamper-test receipts', exact: true }).click();
  await expect(page.locator('.challenge-error')).toContainText('failed its content, chain, or signature check');
  await expect(page.getByRole('heading', { name: 'Ambition met its boundary.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download this proof', exact: true })).toHaveCount(0);
  await expect(page.locator('.challenge-steps .done')).toHaveCount(2);
});

test('an interrupted allowed mission is recovered without spending twice', async ({ page }) => {
  let interrupted = false;
  await page.route('**/api/runs', async route => {
    const input = route.request().postDataJSON();
    if (!input.attack && !interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.goto('/#challenge');
  await page.getByRole('button', { name: 'Start the challenge', exact: true }).click();
  await expect(page.getByText('Overspend rejected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run the $150 mission', exact: true }).click();
  await expect(page.locator('.challenge-error')).toBeVisible();
  await page.getByRole('button', { name: 'Run the $150 mission', exact: true }).click();
  await expect(page.getByText('Allowed reserve completed', { exact: true })).toBeVisible();
  const state = await (await page.request.get('/api/state')).json();
  expect(state.runs).toHaveLength(2);
  expect(state.budget.spent).toBe('150000000');
  await page.getByRole('button', { name: 'Verify & tamper-test receipts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambition met its boundary.' })).toBeVisible();
});
