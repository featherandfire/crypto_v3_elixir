// KYC submission edges that the happy-path spec doesn't reach.
//
// kyc_and_wishlist drives the form with valid data and asserts the
// post-active state. This spec hits the backend's POST /api/brokerage/account
// directly with deliberately-bad payloads to lock down the validation
// + conflict response shapes the frontend depends on:
//
//   - missing required fields → 422 with `error: "missing_fields"` and
//     a `fields: [...]` array enumerating what was missing. The frontend
//     uses this to highlight specific inputs; a quiet rename of the
//     error key or fields array would break that UX silently.
//
//   - posting a second time for the same user → 409 with
//     `error: "account_already_exists"`. Stops a double-submit from
//     creating a phantom second Alpaca customer account.
//
// Pure-HTTP — we only need a JWT, no browser past the signup.

import { expect, test, type BrowserContext } from '@playwright/test';
import {
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
} from '../helpers/flows';
import { PHX_URL } from '../helpers/env';

async function postKyc(token: string, body: unknown) {
  return fetch(`${PHX_URL}/api/brokerage/account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

test.describe('KYC validation', () => {
  test('missing required fields → 422 with the list of what was missing', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signupAndLandOnKyc(page, freshCreds('kycmissing'));
      const token = await getAuthToken(page);

      // Send the empty body — every required field is missing.
      const res = await postKyc(token, {});
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error?: string; fields?: string[] };
      expect(body.error).toBe('missing_fields');
      expect(Array.isArray(body.fields), 'fields must be an array').toBe(true);
      // Spot-check a few — the full list is enforced server-side and
      // changing it should be a deliberate decision. We don't pin the
      // exact set here so the spec doesn't break on legitimate add/remove
      // of required fields; we only check the contract shape + that
      // identity + contact essentials are both included.
      expect(body.fields).toEqual(
        expect.arrayContaining(['given_name', 'family_name', 'tax_id', 'street_address']),
      );
    } finally {
      await context.close();
    }
  });

  test('submitting KYC twice → 409 account_already_exists', async ({ browser }) => {
    // First submission goes through the UI helper (drives the full
    // form). Second submission hits the API directly with the same
    // (valid) shape — the controller short-circuits on the existing
    // account row before re-validating fields.
    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();
    try {
      await signupAndLandOnKyc(page, freshCreds('kycdupe'));
      await completeKyc(page);
      const token = await getAuthToken(page);

      const res = await postKyc(token, {
        given_name: 'Test',
        family_name: 'Eee2eee',
        date_of_birth: '1990-05-15',
        tax_id: '432-19-8765',
        phone_number: '+14155551234',
        street_address: '123 Market Street',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94103',
        funding_source: ['employment_income'],
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('account_already_exists');
    } finally {
      await context.close();
    }
  });
});
