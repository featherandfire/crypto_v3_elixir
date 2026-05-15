// High-level UI flows reused across specs. These wrap Playwright's Page
// API with project-specific knowledge (test-id naming, KYC sandbox
// timing, Alpine-driven modal sequencing) so individual tests stay
// focused on what they're asserting rather than how to get there.
//
// We rely heavily on Playwright's auto-waiting: locator actions retry
// until the element is visible/actionable, so the manual scroll/retry
// helpers from the Selenium era are no longer needed.

import { expect, type Page } from '@playwright/test';
import { waitForVerificationCode } from './mailbox';

/**
 * Neutralize Vite's HMR auto-reload. Under long Playwright runs the
 * HMR WebSocket occasionally drops; on reconnect the client opens a
 * second WebSocket with subprotocol `vite-ping`, and when that ping
 * resolves it calls `location.reload()` to resync. The reload kicks
 * the test browser back to the landing route mid-flow.
 *
 * We can't simply block `@vite/client` — Vite injects it into every
 * served module so the app won't bootstrap without it. We also can't
 * no-op `location.reload`, because the app uses it legitimately
 * after verify-email and login.
 *
 * Targeted fix: intercept the `vite-ping` WebSocket and redirect it
 * to a non-existent endpoint so the ping never succeeds. The HMR
 * client logs "[vite] server connection lost" and keeps retrying,
 * but never reloads. All other WebSockets (and the app's normal
 * `location.reload` calls) pass through unaffected.
 */
async function neutralizeHmrReload(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OrigWS = window.WebSocket;
    // Proxy preserves static fields (CONNECTING/OPEN/CLOSING/CLOSED)
    // and prototype, but lets us intercept construction.
    window.WebSocket = new Proxy(OrigWS, {
      construct(target, args) {
        const [url, protocols] = args as [string | URL, string | string[] | undefined];
        const p = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
        if (p.includes('vite-ping')) {
          // 127.0.0.1:1 is closed by convention; construction succeeds
          // but the open handshake fails → ping rejects → no reload.
          return new target('ws://127.0.0.1:1', protocols);
        }
        return new target(url, protocols);
      },
    });
  });
}

export type SignupCreds = {
  username: string;
  email: string;
  password: string;
};

/**
 * Build a fresh set of signup credentials using the current timestamp,
 * so a test can rerun without colliding with prior runs. The optional
 * prefix lets multi-user tests distinguish users in mailbox lookups.
 */
export function freshCreds(prefix = 'e2e'): SignupCreds {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    username: `${prefix}_${stamp}_${rand}`,
    email: `${prefix}_${stamp}_${rand}@example.com`,
    password: 'TestPass123!',
  };
}

/**
 * From the landing page, sign up a brand-new user, read the verification
 * code from the dev mailbox, submit it, and wait for the post-login
 * redirect to land the user on the KYC form.
 */
export async function signupAndLandOnKyc(page: Page, creds: SignupCreds): Promise<void> {
  await neutralizeHmrReload(page);
  await page.goto('/');
  await page.getByTestId('landing-get-started').click();
  await expect(page.getByTestId('auth-form')).toBeVisible();

  await page.getByTestId('auth-username').fill(creds.username);
  await page.getByTestId('auth-email').fill(creds.email);
  await page.getByTestId('auth-password').fill(creds.password);
  await page.getByTestId('auth-submit').click();

  await expect(page.getByTestId('verify-form')).toBeVisible();
  const code = await waitForVerificationCode(creds.email);
  await page.getByTestId('verify-code').fill(code);
  await page.getByTestId('verify-submit').click();

  // Page reloads on verify success → init() routes the un-onboarded
  // user to the KYC form. The given_name input is the first KYC field.
  await expect(page.getByTestId('kyc-given-name')).toBeVisible({ timeout: 30_000 });
}

/**
 * Fills the KYC form with sandbox-safe fixture data, submits, and waits
 * for the post-approval brokerage page (Wishlist button visible = the
 * user's Alpaca account is ACTIVE and `alpacaAccount` is loaded).
 * Worst-case wait is ~30s for Alpaca's sandbox approval clock + our
 * client-side poller catching the transition.
 */
export async function completeKyc(page: Page): Promise<void> {
  await page.getByTestId('kyc-given-name').fill('Test');
  await page.getByTestId('kyc-family-name').fill('Eee2eee');
  // Playwright's locator.fill() handles type=date with ISO format
  // natively, regardless of session locale.
  await page.getByTestId('kyc-dob').fill('1990-05-15');
  await page.getByTestId('kyc-ssn').fill('432-19-8765');
  await page.getByTestId('kyc-phone').fill('+14155551234');
  await page.getByTestId('kyc-street').fill('123 Market Street');
  await page.getByTestId('kyc-city').fill('San Francisco');
  await page.getByTestId('kyc-state').fill('CA');
  await page.getByTestId('kyc-zip').fill('94103');
  await page.getByTestId('kyc-agree-customer').check();
  await page.getByTestId('kyc-agree-account').check();
  await page.getByTestId('kyc-agree-margin').check();
  await page.getByTestId('kyc-submit').click();

  // KYC submit disappears after POST succeeds; wishlist-open appears
  // once the Alpaca account flips ACTIVE and the trading snapshot
  // loads. Sandbox approval time has variance — usually 5–30s,
  // occasionally up to 60s, so we keep the long ceiling.
  await expect(page.getByTestId('kyc-submit')).toBeHidden({ timeout: 180_000 });
  await expect(page.getByTestId('wishlist-open')).toBeVisible({ timeout: 180_000 });
}

/**
 * Opens the wishlist modal, adds `symbol`, waits for the count badge
 * to reflect the new row, and closes the modal. Closing matters when
 * a spec calls this twice — the second `wishlist-open` click would
 * otherwise be intercepted by the still-open backdrop.
 */
export async function addToWishlistViaUi(page: Page, symbol: string): Promise<void> {
  await page.getByTestId('wishlist-open').click();
  await page.getByTestId('wishlist-add-input').fill(symbol);
  await page.getByTestId('wishlist-add-submit').click();
  // Count badge shows the new total once the API roundtrip resolves.
  // We just wait for it to be a non-zero number — exact value depends
  // on call order in the test.
  await expect(page.getByTestId('wishlist-count')).not.toHaveText(/^\s*0?\s*$/, {
    timeout: 10_000,
  });
  // Close the modal so the next caller can open it cleanly. We assert
  // the backdrop is hidden after — guards against Alpine transitions
  // racing a follow-up action.
  await page.getByTestId('wishlist-close').click();
  await expect(page.getByTestId('wishlist-add-input')).toBeHidden({ timeout: 5_000 });
}

/**
 * Opens the Add Funds modal via the brokerage-header trigger button,
 * types `amount`, and clicks submit. Does NOT wait for the modal to
 * close — that path depends on the optimistic-cash-update flow which
 * is brittle to local state quirks. Callers verify the deposit landed
 * via the deposits API instead.
 */
export async function submitDepositViaUi(page: Page, amount: string): Promise<void> {
  await page.getByTestId('addfunds-open').click();
  await page.getByTestId('addfunds-amount').fill(amount);
  await page.getByTestId('addfunds-submit').click();
}

/**
 * Reads the JWT auth token from the browser's localStorage. Used by
 * specs that need to hit backend APIs directly (e.g. polling the
 * wishlist endpoint for status changes that aren't visible in the UI).
 */
export async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  if (!token) throw new Error('no auth token in localStorage — user not logged in');
  return token;
}
