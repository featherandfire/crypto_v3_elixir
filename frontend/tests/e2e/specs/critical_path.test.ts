// First-pass critical-path E2E. Validates the auth + post-signup gate
// that's hardest to spot-check manually:
//   1. Sign up a brand-new user
//   2. Read the 6-digit verification code from /dev/mailbox
//   3. Verify email
//   4. After login, confirm the un-onboarded user is routed to KYC
//
// Follow-ups (deferred to keep the first run-green simple):
//   - Complete KYC + verify Alpaca account creation lands in DB
//   - Add a stock to the wishlist + reload to verify DB persistence
//
// Prereqs:
//   - Phoenix running at http://localhost:4000 with dev mailer + Broker API creds
//   - Vite running at http://localhost:3000
//   - Run: `npm run test:e2e` (headless) or `npm run test:e2e:headed`

import { type WebDriver } from 'selenium-webdriver';
import { newDriver } from '../helpers/driver';
import { freshCreds, signupAndLandOnKyc } from '../helpers/flows';

describe('critical path: signup → verify → KYC redirect', function () {
  this.timeout(120_000);
  let driver: WebDriver;

  before(async () => {
    driver = await newDriver();
  });

  after(async () => {
    await driver.quit();
  });

  it('signs up, verifies email, and lands on Account Setup', async () => {
    // signupAndLandOnKyc walks the whole flow and asserts the KYC form
    // is in view at the end. If any sub-step (signup POST, mailbox poll,
    // verify POST, post-login redirect) fails it surfaces here.
    await signupAndLandOnKyc(driver, freshCreds());
  });
});
