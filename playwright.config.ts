import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 60_000, expect: { timeout: 15_000 }, workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser-results.json' }]],
  use: { baseURL: process.env.NESLOS_E2E_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure', headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1040 } } }],
  webServer: process.env.NESLOS_E2E_URL ? undefined : { command: 'node scripts/dev.mjs', url: 'http://127.0.0.1:5173/api/health', reuseExistingServer: true, timeout: 30_000 },
});
