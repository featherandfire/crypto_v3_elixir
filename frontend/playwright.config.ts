// Playwright config. Two services need to be running before `npm run
// test:e2e`:
//   - Phoenix backend at PHX_URL (default http://localhost:4000)
//   - Vite dev server at BASE_URL (default http://localhost:3000)
// We deliberately don't start them via `webServer` because both have
// stateful side effects (DB writes, real Alpaca sandbox calls) and the
// developer flow is to start them once and leave them running.

import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e/specs',
  // Keep the .test.ts convention from the Selenium era so file moves
  // are 1:1 and CI globs don't need updating.
  testMatch: '**/*.test.ts',
  // 10 minutes per test absorbs the long tail of Alpaca sandbox KYC
  // approval (occasionally up to 2 min) plus the rest of a slow flow.
  // Most tests finish well under a minute.
  timeout: 600_000,
  expect: { timeout: 10_000 },
  // Each describe pays its own onboarding cost (signup + KYC + sandbox
  // approval), so within a file we run serially to share that setup.
  // Across files we still get parallelism via workers below.
  fullyParallel: false,
  // One worker. Tried 4 against ALPACA_MOCK=1 — the mock GenServer
  // serializes fine, but the Swoosh dev mailbox + concurrent KYC
  // submits produce a race where init() sees a stale "no account"
  // state and routes the user away from the KYC form, making most
  // signup-dependent specs fail. Until the dev mailbox is swapped for
  // a test-only direct fetch (or each worker gets its own mailbox),
  // serial is the only reliable mode.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE_URL,
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1400, height: 900 },
    // Trace + screenshot only when something failed — keeps CI artifact
    // size sane while still giving us the full picture for triage.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
