import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Local rehearsal only. No wallet, paid inference, deployment or publication.
// Start `npm run dev` first. Playwright's Chromium installation is required.
const baseURL = 'http://127.0.0.1:5173';
const health = await fetch(baseURL + '/api/health', { signal: AbortSignal.timeout(15000) }).then(response => response.json());
if (health.mode !== 'rehearsal' || health.realFunds !== false) throw new Error('Recording requires the local simulated-funds rehearsal.');
await mkdir('artifacts/demo-recording', { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const cover = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await cover.goto(baseURL + '/social-card.svg');
  await cover.screenshot({ path: 'public/social-card.png' });
  await cover.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, reducedMotion: 'reduce',
    recordVideo: { dir: 'artifacts/demo-recording', size: { width: 1440, height: 1040 } } });
  const page = await context.newPage();
  const video = page.video();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pause = milliseconds => page.waitForTimeout(milliseconds); // Deliberate reading time in the recording.
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: 'Give agents ambition. Keep the authority.' })).toBeVisible();
  await pause(6000);
  await page.getByRole('button', { name: 'Take the 60-second challenge' }).click();
  await pause(6000);
  await page.getByRole('button', { name: 'Start the challenge', exact: true }).click();
  await expect(page.getByText('Overspend rejected', { exact: true })).toBeVisible();
  await page.getByText('Inspect the guardian’s failed checks', { exact: true }).click();
  await pause(6500);
  await page.getByRole('button', { name: 'Run the $150 mission', exact: true }).click();
  await expect(page.getByText('Allowed reserve completed', { exact: true })).toBeVisible();
  await pause(4500);
  await page.getByRole('button', { name: 'Verify & tamper-test receipts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambition met its boundary.' })).toBeVisible();
  await pause(6500);
  await page.getByRole('button', { name: 'Inspect the real-world evidence', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('heading', { name: 'The contract says no.' })).toBeVisible();
  await pause(8000);
  await page.locator('.caveat-proof').scrollIntoViewIfNeeded();
  await pause(6500);
  await page.getByRole('link', { name: /Audit trail/ }).click();
  await page.getByRole('button', { name: 'Verify integrity', exact: true }).click();
  await expect(page.locator('.verification-result.valid')).toBeVisible();
  await pause(5500);
  await page.getByRole('link', { name: 'Control room', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(4500);
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
  await video.saveAs(resolve('artifacts/neslos-demo.webm'));
  await video.delete();
  console.log('Recorded artifacts/neslos-demo.webm and rendered public/social-card.png. No external publication.');
} finally { await browser.close(); }
