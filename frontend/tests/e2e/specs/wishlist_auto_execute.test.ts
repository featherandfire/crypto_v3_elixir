// Full auto-execute chain. This is the core product mechanic — a user
// stars stocks before they have funds, and the moment a deposit settles
// those parked orders auto-fire. The chain:
//
//   1. User completes KYC; mock returns ACTIVE immediately.
//   2. User adds SCHB to their wishlist (pending row).
//   3. User initiates a $40 deposit → mock creates transfer QUEUED.
//   4. Test signs + POSTs the COMPLETE webhook the way Alpaca would.
//   5. Webhook handler:
//        - flips the deposit to `completed`
//        - tells the mock to credit cash on the trading account
//        - calls `attempt_wishlist_fills` synchronously, which places
//          the pending order on the user's account
//   6. Both DB state (wishlist row → `filled` with executed_order_id)
//      and Alpaca state (order on the books, cash debited) reflect it.
//
// Before the mock landed this test stopped at step 5a — sandbox cash
// crediting was non-deterministic. With AlpacaMock.Server tracking
// cash, the full chain is now deterministic.

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
  pollWishlistStatus,
} from '../helpers/api';

test.describe.configure({ mode: 'serial' });

test.describe('wishlist auto-execute', () => {
  let context: BrowserContext;
  let page: Page;
  let token: string;
  let depositRef: string;
  let depositId: number;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signupAndLandOnKyc(page, freshCreds());
    await completeKyc(page);
    token = await getAuthToken(page);

    // Stage the wishlist + deposit, then fire the webhook. We do all
    // this in beforeAll so each individual `test()` can focus on one
    // assertion — they all read the post-webhook state.
    await addToWishlistViaUi(page, 'SCHB');
    await submitDepositViaUi(page, '40');

    // Wait for the deposit row to land with an Alpaca transfer UUID
    // — our backend writes the reference after Client.create_transfer
    // returns, so there's a brief window between submit and the row
    // having the right shape.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const deposits = await listDeposits(token);
      const candidate = deposits[0];
      if (
        candidate &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          candidate.reference,
        )
      ) {
        depositRef = candidate.reference;
        depositId = candidate.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!depositRef) throw new Error('deposit never got an Alpaca transfer id');

    // Fire the signed COMPLETE webhook. The receiver verifies HMAC,
    // patches the deposit, notifies the mock (cash credit), and runs
    // attempt_wishlist_fills synchronously — all done by the time this
    // POST returns.
    await fireSignedWebhook('transfer.status_updated', depositRef, 'COMPLETE');
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('webhook flips the deposit row to completed', async () => {
    const updated = (await listDeposits(token)).find((d) => d.id === depositId);
    expect(updated, 'deposit row should still be present').toBeDefined();
    expect(updated!.status).toBe('completed');
  });

  test('mock credits cash to the trading account', async () => {
    // The mock's cash bridge fires in the webhook handler — buying_power
    // should reflect the deposited amount. Confirms our webhook → mock
    // wiring works; without this bridge the order step below couldn't
    // succeed because the mock would still report $0.
    const account = await getAlpacaAccount(token);
    expect(parseFloat(account?.buying_power ?? '0')).toBeGreaterThan(0);
  });

  test('pending wishlist item flips to filled with an executed_order_id', async () => {
    // attempt_wishlist_fills runs inside the webhook handler synchronously,
    // so the row should already be `filled` by the time we poll. The
    // 5s timeout is forgiving for DB write propagation, not for waiting
    // on settlement (which is what the old non-mock version had to do).
    const item = await pollWishlistStatus(token, 'SCHB', 'filled', 5_000);
    expect(item.executed_order_id, 'filled row must reference its order').toBeTruthy();
  });

  test('the placed order appears on the alpaca account', async () => {
    // Closes the loop end-to-end: the order our backend submitted to
    // the mock during attempt_wishlist_fills is visible via the same
    // /api/alpaca/orders endpoint the frontend uses. If the wishlist
    // were marked filled but no order existed, this would catch it.
    const orders = (await listAlpacaOrders(token)) as Array<{ symbol?: string; side?: string }>;
    const schb = orders.find((o) => o.symbol === 'SCHB' && o.side === 'buy');
    expect(schb, 'expected a buy order for SCHB on the account').toBeDefined();
  });

  test('redelivering the same transfer COMPLETE webhook is idempotent', async () => {
    // Alpaca will retry a webhook if our 2xx ack doesn't get through.
    // The redelivery has a different event_id but targets the same
    // transfer — the `deposit.status != "completed"` guard in
    // BrokerFunding.handle_webhook is what stops the second call from
    // re-crediting cash or re-firing wishlist fills.
    //
    // Capture pre-state, fire again, assert post-state unchanged.
    const before = await getAlpacaAccount(token);
    const ordersBefore = (await listAlpacaOrders(token)) as unknown[];

    await fireSignedWebhook('transfer.status_updated', depositRef, 'COMPLETE');

    const after = await getAlpacaAccount(token);
    const ordersAfter = (await listAlpacaOrders(token)) as unknown[];

    expect(after?.buying_power, 'buying_power must not change on redelivery').toBe(
      before?.buying_power,
    );
    expect(
      ordersAfter.length,
      'orders list must not grow — no auto-fill second pass',
    ).toBe(ordersBefore.length);
  });
});
