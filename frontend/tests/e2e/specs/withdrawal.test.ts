// Mirrors the deposit chain with direction=OUTGOING; mock debits cash
// + marks COMPLETE instantly. Happy path: fund → withdraw → cash
// debited, row visible in /withdrawals (and absent from /deposits,
// since list_deposits filters INCOMING). Insufficient cash:
// withdraw > buying_power → backend surfaces the mock's 422.

import { expect, test } from '@playwright/test';
import {
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
  submitDepositViaUi,
} from '../helpers/flows';
import {
  fireSignedWebhook,
  getAlpacaAccount,
  listDeposits,
} from '../helpers/api';
import { PHX_URL } from '../helpers/env';

async function postWithdrawal(token: string, amount: string) {
  return fetch(`${PHX_URL}/api/broker/funding/withdrawals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ amount, method: 'ach', bank_label: 'Chase ••••1234' }),
  });
}

async function getWithdrawals(token: string) {
  const res = await fetch(`${PHX_URL}/api/broker/funding/withdrawals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<{ withdrawals: any[] }>;
}

test.describe('withdrawals', () => {
  test('debits cash on a successful withdrawal and lists it under /withdrawals', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signupAndLandOnKyc(page, freshCreds());
      await completeKyc(page);
      const token = await getAuthToken(page);

      // Fund first — deposit $40, fire the COMPLETE webhook so the
      // mock credits cash. Same dance as wishlist_auto_execute.
      await submitDepositViaUi(page, '40');
      const deadline = Date.now() + 15_000;
      let transferId: string | undefined;
      while (Date.now() < deadline) {
        const deposits = await listDeposits(token);
        const candidate = deposits[0];
        if (
          candidate &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            candidate.reference,
          )
        ) {
          transferId = candidate.reference;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!transferId) throw new Error('deposit never got a transfer id');
      await fireSignedWebhook('transfer.status_updated', transferId, 'COMPLETE');

      const funded = await getAlpacaAccount(token);
      const cashBefore = parseFloat(funded?.cash ?? '0');
      expect(cashBefore, 'cash should be credited after deposit').toBeGreaterThan(0);

      // Withdraw a portion. Mock auto-completes OUTGOING transfers so
      // the cash decrement is observable on the very next account fetch.
      const res = await postWithdrawal(token, '10');
      expect(res.status, `expected 201, got ${res.status}`).toBe(201);
      const body = (await res.json()) as { direction?: string; status?: string };
      expect(body.direction).toBe('OUTGOING');

      // Cash debited.
      const after = await getAlpacaAccount(token);
      const cashAfter = parseFloat(after?.cash ?? '0');
      expect(cashAfter, 'cash should drop by ~$10').toBeLessThan(cashBefore);

      // Row lives in /withdrawals, not /deposits (list_deposits filters
      // direction=INCOMING now).
      const wd = await getWithdrawals(token);
      expect(wd.withdrawals.length).toBeGreaterThan(0);
      expect(wd.withdrawals[0].direction).toBe('OUTGOING');

      const stillDeposits = await listDeposits(token);
      const sawOutgoing = stillDeposits.some(
        (d: any) => d.direction === 'OUTGOING',
      );
      expect(sawOutgoing, 'deposits endpoint must not return withdrawals').toBe(false);
    } finally {
      await context.close();
    }
  });

  test('rejects a withdrawal larger than available cash', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signupAndLandOnKyc(page, freshCreds());
      await completeKyc(page);
      const token = await getAuthToken(page);

      // Fresh account, no deposits — buying_power is 0. The withdrawal
      // controller still inserts a DB row in the "pending" state and
      // then submits to Alpaca, which (in the mock) returns 422 for
      // insufficient cash. Our patch_failure path marks the row failed.
      const res = await postWithdrawal(token, '500');
      // 201 from the controller — it persisted the local row — but the
      // row itself is marked failed by the Alpaca error path.
      expect(res.status).toBe(201);
      const body = (await res.json()) as { status?: string; note?: string };
      expect(body.status, 'failed withdrawals should land as status=failed').toBe('failed');
      expect(body.note ?? '', 'note should mention the alpaca rejection').toMatch(
        /alpaca|insufficient/i,
      );
    } finally {
      await context.close();
    }
  });
});
