import { test, expect, type Page } from '@playwright/test';

// Owner UI uses explicit synthetic transport. These tests spend no credit or chain funds.
async function ownerFixture(page: Page, configured = true) {
  const calls: { path: string; body: any }[] = [], jobs: any[] = [];
  const hash = 'cd'.repeat(32);
  const state = { configured, network: 'mainnet', vault: 'vault.fixture.near', endpoint: 'https://enclave.fixture.invalid', executorPublicKey: 'ab'.repeat(32), signerConfigured: true,
    csrf: 'ef'.repeat(32), counterparties: [{ name: 'Research partner', recipient: 'partner.near' }], jobs, plans: [], schedules: [],
    allowlists: { venues: [{ name: 'near-intents', allowed: true }, { name: 'rhea-lending', allowed: true }], counterparties: [{ name: 'Treasury', allowed: true }, { name: 'Research partner', allowed: false }], venuesComplete: true, counterpartiesComplete: true },
    chain: { config: { policy_version: '1', policy: { daily_limit: '500000000', per_action_limit: '200000000', max_slippage_bps: 50, output_assets: ['nep141:usdt.tether-token.near'], require_confidential: true, paused: false } }, budget: { remaining: '500000000', next_nonce: '0' }, balance: '1000000000', blockHeight: 12345 } };
  const plan = { hash, plan: { operation: { kind: 'pause', paused: true }, config: { network: 'mainnet', vault: state.vault }, owner: 'owner.near', policyVersion: '1' }, call: { receiverId: state.vault, actions: [{ type: 'FunctionCall', params: { methodName: 'set_paused', args: { paused: true }, gas: '30000000000000', deposit: '0' } }] } };
  await page.route('**/api/owner/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/owner', ''), body = request.postDataJSON();
    calls.push({ path, body });
    if (request.method() === 'POST' && path !== '/session') expect(request.headers()['x-neslos-csrf']).toBe(state.csrf);
    let result: unknown;
    if (path === '/session') result = { csrf: state.csrf };
    else if (path === '/state') result = state;
    else if (path === '/attest') result = { executorPublicKey: state.executorPublicKey };
    else if (path === '/runtime-status') result = { ready: true, inference: { totalNanoUsd: '1000000', dayNanoUsd: '1000000', calls: 3, limits: { totalLimitNanoUsd: '250000000', maxCalls: 30 } } };
    else if (path === '/jobs') {
      jobs.push({ id: body.id, type: body.type, state: 'complete' });
      result = { state: 'complete', command: { type: body.type, id: body.id }, result: { strategy: { selectedMarketId: 'rhea:usdt.tether-token.near', changedByResearch: true }, reports: [{ agent: 'risk', title: 'Independent risk review', summary: 'A lower-ranked market has stronger exit liquidity.', findings: ['Fixture liquidity review.'] }] } };
    } else if (path === '/plans') result = plan;
    else if (path === '/policy-plan') result = { ...plan, plan: { ...plan.plan, operation: { kind: 'policy' } }, call: { receiverId: state.vault, actions: [{ type: 'FunctionCall', params: { methodName: 'set_policy', args: { expected_version: '1', policy: { fixture: 'Synthetic commitments for UI review only' } }, gas: '30000000000000', deposit: '0' } }] } };
    else if (path.endsWith('/submit')) result = { hash: 'fixture-tx', final: true, success: true };
    else if (path === '/schedules') result = { state: 'active' };
    else throw new Error('Unexpected fixture request: ' + path);
    await route.fulfill({ json: result });
  });
  await page.goto('/owner#token=' + 'aa'.repeat(32));
  await expect(page.getByRole('heading', { name: /Your treasury, connected/ })).toBeVisible();
  await expect(page.getByText('vault.fixture.near', { exact: true })).toBeVisible();
  return { calls, hash };
}

test('owner research, credit inspection, bounded scheduling and exact mainnet approval', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { calls, hash } = await ownerFixture(page);
  expect(new URL(page.url()).hash).toBe('');
  expect(calls.some(c => c.path === '/jobs')).toBe(false);
  await page.getByRole('button', { name: 'Verify executor', exact: true }).click();
  await expect(page.getByText('Identity verified this session')).toBeVisible();
  await page.getByRole('button', { name: 'Check credit limits' }).click();
  await expect(page.getByText(/of \$0.2500/)).toBeVisible();
  await page.getByRole('button', { name: 'Run private research', exact: true }).click();
  await expect(page.getByText('A lower-ranked market has stronger exit liquidity.')).toBeVisible();
  expect(calls.filter(c => c.path === '/jobs')).toHaveLength(1);
  await page.getByRole('button', { name: 'Schedule research', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('finite attempt limit');
  expect(calls.find(c => c.path === '/schedules')!.body).toMatchObject({ intervalSeconds: 3600, maxRuns: 3, mission: { type: 'research' } });
  await page.screenshot({ path: 'artifacts/neslos-owner-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Vault controls', exact: true }).click();
  await page.getByRole('button', { name: 'Review pause', exact: true }).click();
  const review = page.getByRole('region', { name: 'Exact transaction review' });
  await expect(review).toContainText('set_paused');
  await expect(review.getByRole('button', { name: 'Sign & submit this exact plan' })).toBeDisabled();
  expect(calls.some(c => c.path.endsWith('/submit'))).toBe(false);
  await review.getByLabel('I reviewed this real mainnet transaction and its costs.').check();
  await review.getByRole('button', { name: 'Sign & submit this exact plan' }).click();
  await expect(page.getByRole('status')).toContainText('Finalized transaction fixture-tx');
  expect(calls.find(c => c.path.endsWith('/submit'))!.body).toEqual({ approvedHash: hash, allowMainnet: true });
  expect(errors).toEqual([]);
});
test('owner workspace is usable on mobile and unconfigured actions stay disabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls } = await ownerFixture(page, false);
  await expect(page.getByRole('button', { name: 'Run private research', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Schedule research', exact: true })).toBeDisabled();
  expect(calls.some(c => c.path === '/jobs')).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/neslos-owner-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Vault controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review funding transfer' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('owner selects venue and counterparty limits without submitting the policy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls } = await ownerFixture(page);
  await page.getByRole('button', { name: 'Vault controls', exact: true }).click();
  const venues = page.getByRole('group', { name: 'Allowed venues' });
  const counterparties = page.getByRole('group', { name: 'Allowed counterparties' });
  await expect(venues.getByLabel('near-intents', { exact: true })).toBeChecked();
  await venues.getByLabel('rhea-lending', { exact: true }).uncheck();
  await counterparties.getByLabel('Research partner', { exact: true }).check();
  await page.getByRole('button', { name: 'Review policy change', exact: true }).click();
  expect(calls.find(c => c.path === '/policy-plan')?.body).toMatchObject({ allowedVenues: ['near-intents'], allowedCounterparties: ['Treasury', 'Research partner'], dailyLimit: '500000000', maxSlippageBps: 50 });
  const review = page.getByRole('region', { name: 'Exact transaction review' });
  await expect(review).toContainText('set_policy');
  await expect(review.getByRole('button', { name: 'Sign & submit this exact plan' })).toBeDisabled();
  expect(calls.some(c => c.path.endsWith('/submit'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/neslos-owner-policy-mobile.png', fullPage: true });
});
