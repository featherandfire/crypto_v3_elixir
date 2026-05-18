// POST /api/alpaca/orders — rejection (no buying power) then happy
// path (funded). Both tests share one onboarded user: rejection runs
// first at $0, then the deposit webhook funds the account and the
// happy-path test fires. Confirm-modal UI and price-value asserts are
// deliberately skipped (manual smoke).

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  addToWishlistViaUi,
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
  submitDepositViaUi,
} from '../helpers/flows';
import {
  fireSignedWebhook,
  getAlpacaAccount,
  listAlpacaOrders,
  listDeposits,
} from '../helpers/api';
import { PHX_URL } from '../helpers/env';

test.describe.configure({ mode: 'serial' });

const ORDER_BODY = {
  symbol: 'SCHB',
  qty: '1',
  side: 'buy',
  type: 'market',
  time_in_force: 'day',
};

async function postOrder(token: string, override: Record<string, unknown> = {}) {
  return fetch(`${PHX_URL}/api/alpaca/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...ORDER_BODY, ...override }),
  });
}

test.describe('order placement', () => {
  let context: BrowserContext;
  let page: Page;
  let token: string;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signupAndLandOnKyc(page, freshCreds());
    await completeKyc(page);
    token = await getAuthToken(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('rejects a buy order when the user has zero buying power', async () => {
    const account = await getAlpacaAccount(token);
    expect(parseFloat(account?.buying_power ?? '0')).toBe(0);

    const res = await postOrder(token);
    expect(res.ok, `expected non-2xx, got ${res.status}`).toBe(false);
    const body = (await res.json()) as { error?: string; body?: unknown };
    expect(body.error ?? '', 'error key should mention alpaca + status').toMatch(
      /alpaca_http_/,
    );
    // Inner body should mention buying power — exact phrasing has
    // shifted historically so we match a substring.
    expect(JSON.stringify(body.body ?? body)).toMatch(/buying.power/i);

    const orders = await listAlpacaOrders(token);
    expect(orders, 'no orders should be on the account').toHaveLength(0);
  });

  test('places a buy order successfully once the account is funded', async () => {
    // We add a wishlist item before depositing so the deposit webhook's
    // attempt_wishlist_fills doesn't no-op (and we can confirm later
    // that auto-fill + direct order paths can coexist on one account).
    // Pick a different symbol from the order below so the manual order
    // is unambiguous when we read the orders list.
    await addToWishlistViaUi(page, 'VTI');
    await submitDepositViaUi(page, '40');

    // Pull Alpaca's transfer UUID off the deposit row, then fire the
    // signed COMPLETE webhook — same dance as wishlist_auto_execute.
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
    if (!transferId) throw new Error('deposit never got an Alpaca transfer id');
    await fireSignedWebhook('transfer.status_updated', transferId, 'COMPLETE');

    // Sanity: cash credit landed on the trading account.
    const funded = await getAlpacaAccount(token);
    expect(parseFloat(funded?.buying_power ?? '0')).toBeGreaterThan(0);

    // The actual happy path — POST the order, expect 200, expect it on
    // the books. SCHB here is the symbol the order_body uses; VTI was
    // the wishlist's auto-fill above, so the orders list should now
    // have at least one of each.
    const res = await postOrder(token);
    expect(res.ok, `expected 2xx, got ${res.status}`).toBe(true);
    // Controller returns the Alpaca order body as-is (no wrapper).
    const order = (await res.json()) as { symbol?: string; side?: string };
    expect(order.symbol, 'response should echo the order').toBe('SCHB');
    expect(order.side).toBe('buy');

    const orders = (await listAlpacaOrders(token)) as Array<{ symbol?: string; side?: string }>;
    expect(orders.find((o) => o.symbol === 'SCHB' && o.side === 'buy')).toBeDefined();
  });

  // ── New order types (stop / stop-limit / trailing-stop) ────────────
  //
  // These exercise the controller's @order_keys allowlist (which now
  // passes stop_price / trail_price / trail_percent through to Alpaca)
  // and confirm the body is well-formed end-to-end. The mock doesn't
  // model conditional trigger logic — it just accepts and "fills"
  // any order whose payload is valid — so we assert on 2xx + the
  // type echoing back. Real Alpaca validates more deeply, but our
  // contract test is whether OUR controller refuses to forward bad
  // bodies. The order_keys allowlist is the only gate.

  test('accepts a stop order (sell-stop) with stop_price', async () => {
    const res = await postOrder(token, {
      symbol: 'SCHB',
      side: 'sell',
      type: 'stop',
      stop_price: '1000',
      time_in_force: 'gtc',
    });
    expect(res.ok, `stop order should 2xx; got ${res.status}`).toBe(true);
    const order = (await res.json()) as { type?: string };
    expect(order.type, 'response should echo stop type').toBe('stop');
  });

  test('accepts a stop-limit order with both stop_price and limit_price', async () => {
    const res = await postOrder(token, {
      symbol: 'SCHB',
      side: 'sell',
      type: 'stop_limit',
      stop_price: '1000',
      limit_price: '999',
      time_in_force: 'gtc',
    });
    expect(res.ok, `stop_limit should 2xx; got ${res.status}`).toBe(true);
    const order = (await res.json()) as { type?: string };
    expect(order.type).toBe('stop_limit');
  });

  test('accepts a trailing-stop order with trail_percent', async () => {
    // trail_percent and trail_price are mutually exclusive — the
    // frontend prefers trail_percent (more common UX). Here we exercise
    // that path explicitly.
    const res = await postOrder(token, {
      symbol: 'SCHB',
      side: 'sell',
      type: 'trailing_stop',
      trail_percent: '5',
      time_in_force: 'gtc',
    });
    expect(res.ok, `trailing_stop should 2xx; got ${res.status}`).toBe(true);
    const order = (await res.json()) as { type?: string };
    expect(order.type).toBe('trailing_stop');
  });
});
