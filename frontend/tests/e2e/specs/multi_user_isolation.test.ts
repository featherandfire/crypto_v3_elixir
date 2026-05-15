// Multi-user isolation. The kind of bug that doesn't surface in
// single-user manual testing but is catastrophic if it ships: a
// missed `user_id` filter that leaks Alice's data into Bob's view —
// or worse, lets Bob *modify* Alice's data.
//
// Two users go through the full signup + KYC flow in independent
// browser contexts (Playwright's contexts are fully isolated —
// separate cookies, localStorage, IndexedDB — so no shared session).
// Alice seeds activity (wishlist + brokerage_account + portfolio).
// Then we hit every per-user endpoint with Bob's auth token and
// assert he sees only his own data, never Alice's.
//
// Coverage:
//   - Read paths: each user's data is invisible to the other.
//   - Write paths: each user's records can't be mutated by the other
//     (passing Alice's resource id with Bob's token must 404, since
//     the controllers scope `get_for_user` to `current_user.id`).
//
// We deliberately don't exercise position_allocations or orders here
// for read isolation — those need settled cash, covered by
// wishlist_auto_execute. Wishlist + accounts + portfolios are
// deterministic and cover the same query-scoping concern.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  addToWishlistViaUi,
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
} from '../helpers/flows';
import {
  getAlpacaAccount,
  listBrokeragePortfolios,
  listDeposits,
  listWishlist,
} from '../helpers/api';
import { PHX_URL } from '../helpers/env';

async function authedRequest(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) {
  return fetch(`${PHX_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('multi-user isolation', () => {
  let aliceContext: BrowserContext;
  let bobContext: BrowserContext;
  let alicePage: Page;
  let bobPage: Page;
  let aliceToken: string;
  let bobToken: string;

  test.beforeAll(async ({ browser }) => {
    // Alice: seeded with a wishlist + a real Alpaca account so we
    // have something for Bob's view to potentially leak.
    aliceContext = await browser.newContext();
    alicePage = await aliceContext.newPage();
    await signupAndLandOnKyc(alicePage, freshCreds('alice'));
    await completeKyc(alicePage);
    await addToWishlistViaUi(alicePage, 'AAPL');
    await addToWishlistViaUi(alicePage, 'MSFT');
    aliceToken = await getAuthToken(alicePage);

    // Bob: clean slate, fresh context — fully isolated cookies +
    // localStorage from Alice's session.
    bobContext = await browser.newContext();
    bobPage = await bobContext.newPage();
    await signupAndLandOnKyc(bobPage, freshCreds('bob'));
    await completeKyc(bobPage);
    bobToken = await getAuthToken(bobPage);
  });

  test.afterAll(async () => {
    await aliceContext?.close();
    await bobContext?.close();
  });

  test("alice's wishlist items are invisible to bob", async () => {
    const aliceWl = await listWishlist(aliceToken);
    const bobWl = await listWishlist(bobToken);
    // Sanity: Alice has both items she added.
    const aliceSymbols = aliceWl.map((i) => i.symbol).sort();
    expect(aliceSymbols).toEqual(['AAPL', 'MSFT']);
    // The actual isolation check.
    expect(bobWl, "bob's wishlist must be empty").toHaveLength(0);
  });

  test('each user sees only their own brokerage portfolios', async () => {
    const aliceP = await listBrokeragePortfolios(aliceToken);
    const bobP = await listBrokeragePortfolios(bobToken);
    expect(aliceP, 'alice should have her starter portfolio').toHaveLength(1);
    expect(bobP, 'bob should have his starter portfolio').toHaveLength(1);
    // Starter portfolios are named `#<user_id>` so the ids and names
    // diverge per user. If Bob's call ever returned Alice's row, this
    // would catch it.
    expect(aliceP[0].id).not.toBe(bobP[0].id);
    expect(aliceP[0].user_id).not.toBe(bobP[0].user_id);
  });

  test('each user gets their own Alpaca trading account', async () => {
    const aliceAcct = await getAlpacaAccount(aliceToken);
    const bobAcct = await getAlpacaAccount(bobToken);
    expect(typeof aliceAcct?.id, 'alice should resolve to her alpaca account').toBe('string');
    expect(typeof bobAcct?.id, 'bob should resolve to his alpaca account').toBe('string');
    expect(aliceAcct!.id).not.toBe(bobAcct!.id);
    expect(aliceAcct!.account_number).not.toBe(bobAcct!.account_number);
  });

  test("bob's deposit list is empty (alice's hypothetical deposits don't leak)", async () => {
    const bobDeposits = await listDeposits(bobToken);
    expect(bobDeposits, "bob hasn't deposited; list must be empty").toHaveLength(0);
  });

  // ── Cross-user write attempts ──────────────────────────────────────
  //
  // Read isolation (above) catches missed user_id filters in SELECTs.
  // These catch the equivalent in UPDATE/DELETE paths — Bob discovers
  // Alice's ids somehow (URL log, leaked from a previous compromise)
  // and tries to mutate her data. Each controller scopes mutations
  // via `get_for_user(current_user.id, id)`, which returns nil when
  // ownership doesn't match → 404. We assert that here; a 200 on any
  // of these would be a silent IDOR.

  test("bob cannot delete alice's wishlist items", async () => {
    const aliceWl = await listWishlist(aliceToken);
    const target = aliceWl.find((i) => i.symbol === 'AAPL');
    expect(target, 'alice should still have AAPL on her wishlist').toBeDefined();

    const res = await authedRequest(bobToken, 'DELETE', `/api/wishlist/${target!.id}`);
    expect(res.status, "bob deleting alice's wishlist row must 404").toBe(404);

    // And confirm the row is still there from Alice's perspective.
    const after = await listWishlist(aliceToken);
    expect(after.map((i) => i.symbol).sort()).toEqual(['AAPL', 'MSFT']);
  });

  test("bob cannot update alice's brokerage portfolio", async () => {
    const aliceP = await listBrokeragePortfolios(aliceToken);
    const target = aliceP[0];

    const res = await authedRequest(bobToken, 'PATCH', `/api/brokerage/portfolios/${target.id}`, {
      name: 'Bob was here',
    });
    expect(res.status, "bob patching alice's portfolio must 404").toBe(404);

    const after = await listBrokeragePortfolios(aliceToken);
    expect(after[0].name, 'alice portfolio name must be unchanged').toBe(target.name);
  });

  test("bob cannot delete alice's brokerage portfolio", async () => {
    const aliceP = await listBrokeragePortfolios(aliceToken);
    const target = aliceP[0];

    const res = await authedRequest(bobToken, 'DELETE', `/api/brokerage/portfolios/${target.id}`);
    expect(res.status, "bob deleting alice's portfolio must 404").toBe(404);

    const after = await listBrokeragePortfolios(aliceToken);
    expect(after, 'alice portfolio must still exist').toHaveLength(1);
    expect(after[0].id).toBe(target.id);
  });
});
