// Reusable end-to-end flows composed of the lower-level helpers. Specs
// stitch these together rather than rebuilding the same setup steps.

import { until, type WebDriver } from 'selenium-webdriver';
import {
  BASE_URL,
  clickByTestId,
  fillByTestId,
  setCheckboxByTestId,
  setDateByTestId,
  testid,
  waitForTestId,
} from './driver';
import { waitForVerificationCode } from './mailbox';

export type SignupCreds = {
  username: string;
  email: string;
  password: string;
};

/**
 * Build a fresh set of signup credentials using the current timestamp,
 * so a test can rerun without colliding with prior runs.
 */
export function freshCreds(prefix = 'e2e'): SignupCreds {
  const stamp = Date.now();
  return {
    username: `${prefix}_${stamp}`,
    email: `${prefix}_${stamp}@example.com`,
    password: 'TestPass123!',
  };
}

/**
 * From the landing page, sign up a brand-new user, read the verification
 * code from the dev mailbox, submit it, and wait for the post-login
 * redirect to land the user on the KYC form. The driver is positioned
 * with the KYC `given_name` input ready to receive typing.
 */
export async function signupAndLandOnKyc(driver: WebDriver, creds: SignupCreds): Promise<void> {
  await driver.get(BASE_URL);
  await clickByTestId(driver, 'landing-get-started');
  await waitForTestId(driver, 'auth-form');

  await fillByTestId(driver, 'auth-username', creds.username);
  await fillByTestId(driver, 'auth-email', creds.email);
  await fillByTestId(driver, 'auth-password', creds.password);
  await clickByTestId(driver, 'auth-submit');

  await waitForTestId(driver, 'verify-form');
  const code = await waitForVerificationCode(creds.email);
  await fillByTestId(driver, 'verify-code', code);
  await clickByTestId(driver, 'verify-submit');

  // Page reloads on verify success → init() routes the un-onboarded
  // user to the KYC form. Waiting on `kyc-given-name` confirms both.
  await waitForTestId(driver, 'kyc-given-name', 30_000);
}

/**
 * Fills the KYC form with sandbox-safe fixture data, submits, and waits
 * for the post-approval brokerage page (Wishlist button visible = the
 * user's Alpaca account is ACTIVE and `alpacaAccount` is loaded).
 * Worst-case wait is ~30s for Alpaca's sandbox approval clock + our
 * client-side poller catching the transition.
 */
export async function completeKyc(driver: WebDriver): Promise<void> {
  await fillByTestId(driver, 'kyc-given-name', 'Test');
  await fillByTestId(driver, 'kyc-family-name', 'Eee2eee');
  await setDateByTestId(driver, 'kyc-dob', '1990-05-15');
  await fillByTestId(driver, 'kyc-ssn', '432-19-8765');
  await fillByTestId(driver, 'kyc-phone', '+14155551234');
  await fillByTestId(driver, 'kyc-street', '123 Market Street');
  await fillByTestId(driver, 'kyc-city', 'San Francisco');
  await fillByTestId(driver, 'kyc-state', 'CA');
  await fillByTestId(driver, 'kyc-zip', '94103');
  await setCheckboxByTestId(driver, 'kyc-agree-customer', true);
  await setCheckboxByTestId(driver, 'kyc-agree-account', true);
  await setCheckboxByTestId(driver, 'kyc-agree-margin', true);
  await clickByTestId(driver, 'kyc-submit');

  // KYC form disappears after submit; wishlist-open appears once the
  // Alpaca account flips ACTIVE and the trading snapshot loads. Sandbox
  // approval time has variance — usually 5–30s, occasionally up to 60s.
  // 90s here is overkill for the happy path but absorbs the long tail.
  await driver.wait(
    until.stalenessOf(await driver.findElement(testid('kyc-submit'))),
    180_000,
    'KYC submit button should disappear after successful submit',
  );
  await waitForTestId(driver, 'wishlist-open', 180_000);
}

/**
 * Opens the wishlist modal, adds `symbol`, waits for the count badge
 * to reflect the new row, and closes the modal.
 */
export async function addToWishlistViaUi(driver: WebDriver, symbol: string): Promise<void> {
  await clickByTestId(driver, 'wishlist-open');
  await fillByTestId(driver, 'wishlist-add-input', symbol);
  await clickByTestId(driver, 'wishlist-add-submit');
  // Wait for the count badge to populate; the modal close click below
  // would race the optimistic-then-server-confirmed render otherwise.
  await driver.wait(
    async () => {
      const els = await driver.findElements(testid('wishlist-count'));
      if (els.length === 0) return false;
      const t = (await els[0].getText()).trim();
      return t !== '' && t !== '0';
    },
    10_000,
    `wishlist count never updated after adding ${symbol}`,
  );
}

/**
 * Opens the Add Funds modal via the brokerage-header trigger button,
 * types `amount`, and clicks submit. Does NOT wait for the modal to
 * close — that path depends on the optimistic-cash-update flow which
 * is brittle to local state quirks. Callers verify the deposit landed
 * via the deposits API instead.
 */
export async function submitDepositViaUi(driver: WebDriver, amount: string): Promise<void> {
  await clickByTestId(driver, 'addfunds-open');
  await waitForTestId(driver, 'addfunds-amount');
  await fillByTestId(driver, 'addfunds-amount', amount);
  await clickByTestId(driver, 'addfunds-submit');
}

/**
 * Reads the JWT auth token from the browser's localStorage. Used by
 * specs that need to hit backend APIs directly (e.g. polling the
 * wishlist endpoint for status changes that aren't visible in the UI).
 */
export async function getAuthToken(driver: WebDriver): Promise<string> {
  const token = await driver.executeScript<string | null>(
    `return localStorage.getItem('token');`,
  );
  if (!token) throw new Error('no auth token in localStorage — user not logged in');
  return token;
}
