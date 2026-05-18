// Cheapest broad smoke test — signup → verify via dev mailbox →
// post-verify reload routes the un-onboarded user to the KYC form.
// Touches routing, /api/auth/*, Swoosh mailer, JWT, init(): if it
// breaks almost everything downstream will too, so keep it fast and
// first.

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
