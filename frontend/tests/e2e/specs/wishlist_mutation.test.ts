// Wishlist *remove* + *reorder* — the mutation paths kyc_and_wishlist
// (create) and wishlist_auto_execute (fill) don't touch. Remove drives
// the UI (the × button is where bugs land); reorder hits POST
// /wishlist/reorder directly since drag-and-drop is brittle to
// automate and the API is what the drag handler ultimately calls.

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  addToWishlistViaUi,
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
} from '../helpers/flows';
import { listWishlist } from '../helpers/api';
import { PHX_URL } from '../helpers/env';

test.describe.configure({ mode: 'serial' });

test.describe('wishlist mutation', () => {
  let context: BrowserContext;
  let page: Page;
  let token: string;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signupAndLandOnKyc(page, freshCreds());
    await completeKyc(page);
    token = await getAuthToken(page);

    // Seed three items so we have something meaningful to delete and
    // reorder. addToWishlistViaUi closes the modal between calls.
    await addToWishlistViaUi(page, 'AAPL');
    await addToWishlistViaUi(page, 'MSFT');
    await addToWishlistViaUi(page, 'GOOGL');
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('removing an item via the UI persists to the server', async () => {
    // Open the modal so the per-row × buttons render.
    await page.getByTestId('wishlist-open').click();

    // Sanity: all three rows are rendered.
    await expect(page.getByTestId('wishlist-row-AAPL')).toBeVisible();
    await expect(page.getByTestId('wishlist-row-MSFT')).toBeVisible();
    await expect(page.getByTestId('wishlist-row-GOOGL')).toBeVisible();

    // Remove MSFT.
    await page.getByTestId('wishlist-remove-MSFT').click();

    // UI should reflect the deletion immediately (Alpine is optimistic).
    await expect(page.getByTestId('wishlist-row-MSFT')).toBeHidden();

    // Server should agree — confirms the optimistic UI also issued the
    // DELETE call and the row is gone from the DB.
    const remaining = await listWishlist(token);
    const symbols = remaining.map((i) => i.symbol).sort();
    expect(symbols, 'server-side wishlist must reflect the deletion').toEqual([
      'AAPL',
      'GOOGL',
    ]);

    // Close the modal so subsequent tests can re-open cleanly.
    await page.getByTestId('wishlist-close').click();
    await expect(page.getByTestId('wishlist-add-input')).toBeHidden();
  });

  test('POST /wishlist/reorder rewrites positions in the order supplied', async () => {
    // The drag handler in app.ts POSTs the full id list in the new
    // order; the controller writes `position` per row. We exercise
    // that contract directly — the UI is just the producer.
    const before = await listWishlist(token);
    expect(before, 'should have AAPL + GOOGL after the delete test').toHaveLength(2);
    expect(before.map((i) => i.symbol)).toEqual(['AAPL', 'GOOGL']);

    // Reverse the order.
    const reversedIds = [...before].reverse().map((i) => i.id);
    const res = await fetch(`${PHX_URL}/api/wishlist/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids: reversedIds }),
    });
    expect(res.status, `reorder should succeed; got ${res.status}`).toBe(200);

    // list_for_user orders by `position`, so the API returning GOOGL
    // first means the reorder actually persisted to the position
    // column rather than just being a write to /dev/null.
    const after = await listWishlist(token);
    expect(after.map((i) => i.symbol), 'list order must reflect the reorder').toEqual([
      'GOOGL',
      'AAPL',
    ]);
  });

  test('POST /wishlist/reorder rejects a mismatched id set (422)', async () => {
    // The endpoint requires the supplied ids to be the user's full
    // current set — partial reorders or stale ids should 422 rather
    // than silently corrupt position ordering.
    const items = await listWishlist(token);
    const res = await fetch(`${PHX_URL}/api/wishlist/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids: [items[0].id] }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('id_set_mismatch');
  });
});
