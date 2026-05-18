// Return-user login coverage — every other spec signs up but never
// logs back in. Tests the happy path (right password → JWT that
// authenticates) plus the deliberate failures (wrong password → 401,
// missing fields → 400, unverified user → 403). All-HTTP except the
// signup prep, which reuses the browser flow helper.

import { expect, test, type BrowserContext } from '@playwright/test';
import { freshCreds, signupAndLandOnKyc, type SignupCreds } from '../helpers/flows';
import { waitForVerificationCode } from '../helpers/mailbox';
import { PHX_URL } from '../helpers/env';

async function login(body: Partial<{ identifier: string; password: string }>) {
  return fetch(`${PHX_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function register(creds: SignupCreds) {
  // Direct POST instead of the UI flow when we don't need verification.
  return fetch(`${PHX_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
}

test.describe('auth flows', () => {
  test.describe('login (verified user)', () => {
    let context: BrowserContext;
    let creds: SignupCreds;

    test.beforeAll(async ({ browser }) => {
      // Sign up + verify via the UI helper so the email-verification
      // path is exercised end-to-end (same cost as every other spec's
      // setup; reuses the dev mailbox plumbing).
      context = await browser.newContext();
      const page = await context.newPage();
      creds = freshCreds('login');
      await signupAndLandOnKyc(page, creds);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('issues a JWT that authenticates against protected endpoints', async () => {
      const res = await login({ identifier: creds.username, password: creds.password });
      expect(res.status, `expected 200, got ${res.status}`).toBe(200);
      const body = (await res.json()) as { token?: string; user?: { username?: string } };
      expect(body.token, 'response must include a token').toBeTruthy();
      expect(body.user?.username).toBe(creds.username);

      // Token must actually work — round-trip it through /auth/me.
      const me = await fetch(`${PHX_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${body.token}` },
      });
      expect(me.status, 'newly-issued token must authenticate /auth/me').toBe(200);
    });

    test('rejects the wrong password with 401 and no token', async () => {
      const res = await login({ identifier: creds.username, password: 'WrongPass!1' });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: string; token?: string };
      expect(body.error).toBe('invalid_credentials');
      expect(body.token, 'must never leak a token on failure').toBeUndefined();
    });

    test('rejects a missing-password payload with 400', async () => {
      const res = await login({ identifier: creds.username });
      expect(res.status).toBe(400);
    });
  });

  test('rejects login for an unverified user (403)', async () => {
    // Register-only: no email verification step. The controller still
    // creates the user and emails them a code, but `Accounts.authenticate`
    // returns the user with is_verified=false, which the login handler
    // turns into a 403 with the specific `email_not_verified` error so
    // the frontend can route the user to the verify form.
    const creds = freshCreds('unverified');
    const reg = await register(creds);
    expect(reg.status, 'register should succeed').toBe(201);

    const res = await login({ identifier: creds.username, password: creds.password });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('email_not_verified');
  });

  // ── Password reset ─────────────────────────────────────────────────
  //
  // Forgot-password is deliberately enumeration-resistant: it always
  // returns 200 whether or not the identifier exists. The real test of
  // correctness is the round-trip: signup → forgot → read code →
  // reset → log in with NEW password works, OLD password rejected.

  test.describe('password reset', () => {
    let context: BrowserContext;
    let creds: SignupCreds;
    const newPassword = 'NewPass123!';

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      const page = await context.newPage();
      creds = freshCreds('reset');
      await signupAndLandOnKyc(page, creds);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('forgot-password is enumeration-resistant (200 even for unknown user)', async () => {
      const res = await fetch(`${PHX_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'no-such-user-' + Date.now() }),
      });
      expect(res.status, 'must not leak whether the user exists').toBe(200);
    });

    test('full reset round-trip: request code → reset → new password works, old rejected', async () => {
      // Trigger the reset email.
      const fp = await fetch(`${PHX_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: creds.username }),
      });
      expect(fp.status).toBe(200);

      // Same dev-mailbox helper as signup verification — both emails
      // contain a 6-digit code and Swoosh's preview is most-recent-first,
      // so the helper picks up the reset email naturally.
      const code = await waitForVerificationCode(creds.email);

      const rp = await fetch(`${PHX_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: creds.username,
          code,
          new_password: newPassword,
        }),
      });
      expect(rp.status, `reset-password should succeed; got ${rp.status}`).toBe(200);
      const rpBody = (await rp.json()) as { token?: string };
      expect(rpBody.token, 'reset should issue a fresh JWT').toBeTruthy();

      // New password works.
      const ok = await login({ identifier: creds.username, password: newPassword });
      expect(ok.status, 'login with new password').toBe(200);

      // Old password rejected.
      const bad = await login({ identifier: creds.username, password: creds.password });
      expect(bad.status, 'old password must no longer authenticate').toBe(401);
    });
  });
});
