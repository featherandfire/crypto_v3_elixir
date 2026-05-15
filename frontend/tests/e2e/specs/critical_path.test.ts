// First-impression smoke test. A new visitor lands on the marketing
// page, signs up, verifies their email via the dev mailbox, and the
// post-verify reload should route the un-onboarded user to the KYC
// form (proved by `kyc-given-name` becoming visible).
//
// This is the cheapest test that touches the most surfaces: routing,
// auth endpoint, Swoosh mailer, JWT issuance, post-verify reload, and
// the un-onboarded init() branch. If it breaks, almost everything
// downstream will too — keep it fast and keep it first.
//
// Prereqs:
//   - Phoenix running at http://localhost:4000 with dev mailer + Broker API creds
//   - Vite running at http://localhost:3000
//   - Run: `npm run test:e2e` (headless) or `npm run test:e2e:headed`

import { expect, test } from '@playwright/test';
import { freshCreds, signupAndLandOnKyc } from '../helpers/flows';

test.describe('critical path: signup → verify → KYC redirect', () => {
  test('signs up, verifies email, and lands on Account Setup', async ({ page }) => {
    await signupAndLandOnKyc(page, freshCreds());
    // signupAndLandOnKyc already asserts visibility internally, but a
    // duplicate assertion at the spec level makes failures easier to
    // read in CI output.
    await expect(page.getByTestId('kyc-given-name')).toBeVisible();
  });
});
