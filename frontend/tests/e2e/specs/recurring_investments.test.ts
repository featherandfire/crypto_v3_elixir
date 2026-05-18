// Recurring buy/sell schedules — the Scheduler GenServer ticks each
// minute and places orders for any row past its next_run_at. We don't
// wait for the tick (too slow); execution overlaps order_placement's
// Client.place_order path. This spec locks down the CRUD contract:
// create / list / pause via PATCH / delete, plus a cross-user write
// block (Bob's token + Alice's id → 404).

import { expect, test } from '@playwright/test';
import {
  completeKyc,
  freshCreds,
  getAuthToken,
  signupAndLandOnKyc,
} from '../helpers/flows';
import { PHX_URL } from '../helpers/env';

async function listRecurring(token: string) {
  const res = await fetch(`${PHX_URL}/api/recurring-investments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<{ items: any[] }>;
}

async function createRecurring(token: string, body: Record<string, unknown>) {
  return fetch(`${PHX_URL}/api/recurring-investments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function patchRecurring(token: string, id: number, body: Record<string, unknown>) {
  return fetch(`${PHX_URL}/api/recurring-investments/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function deleteRecurring(token: string, id: number) {
  return fetch(`${PHX_URL}/api/recurring-investments/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe('recurring investments', () => {
  test('full CRUD round-trip: create, list, pause, delete', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signupAndLandOnKyc(page, freshCreds());
      await completeKyc(page);
      const token = await getAuthToken(page);

      // Create — weekly buy of VOO. starts_at omitted: backend defaults
      // to tomorrow so it won't fire during the test.
      const createRes = await createRecurring(token, {
        symbol: 'voo',
        qty: '1',
        frequency: 'weekly',
        side: 'buy',
        order_type: 'market',
        time_in_force: 'day',
      });
      expect(createRes.status, `create should 201; got ${createRes.status}`).toBe(201);
      const created = (await createRes.json()) as { item: any };
      expect(created.item.symbol, 'symbol should be upcased server-side').toBe('VOO');
      expect(created.item.is_active).toBe(true);
      expect(created.item.next_run_at, 'next_run_at must be set').toBeTruthy();
      const id = created.item.id;

      // List — should include the new row.
      const listed = await listRecurring(token);
      expect(listed.items.find((i: any) => i.id === id)).toBeDefined();

      // Pause via PATCH.
      const pauseRes = await patchRecurring(token, id, { is_active: false });
      expect(pauseRes.status).toBe(200);
      const paused = (await pauseRes.json()) as { item: any };
      expect(paused.item.is_active).toBe(false);

      // Resume to confirm the toggle works both ways.
      const resumeRes = await patchRecurring(token, id, { is_active: true });
      expect(resumeRes.status).toBe(200);
      const resumed = (await resumeRes.json()) as { item: any };
      expect(resumed.item.is_active).toBe(true);

      // Delete — 204 no content.
      const delRes = await deleteRecurring(token, id);
      expect(delRes.status).toBe(204);

      // Row gone from list.
      const after = await listRecurring(token);
      expect(after.items.find((i: any) => i.id === id)).toBeUndefined();
    } finally {
      await context.close();
    }
  });

  test('rejects creates that are missing required fields (422)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signupAndLandOnKyc(page, freshCreds());
      await completeKyc(page);
      const token = await getAuthToken(page);

      // Missing symbol + qty entirely — changeset should reject.
      const res = await createRecurring(token, { frequency: 'weekly' });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error?: string; details?: unknown };
      expect(body.error).toBe('invalid');
      expect(body.details, 'details should enumerate the missing fields').toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("bob cannot patch or delete alice's recurring investment", async ({ browser }) => {
    // Two contexts, two users. Alice creates a schedule; Bob tries to
    // mutate it with his own JWT. Both attempts must 404 because the
    // controller scopes get_for_user to current_user.id.
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();

    try {
      const alicePage = await aliceCtx.newPage();
      await signupAndLandOnKyc(alicePage, freshCreds('alice'));
      await completeKyc(alicePage);
      const aliceToken = await getAuthToken(alicePage);

      const bobPage = await bobCtx.newPage();
      await signupAndLandOnKyc(bobPage, freshCreds('bob'));
      await completeKyc(bobPage);
      const bobToken = await getAuthToken(bobPage);

      const createRes = await createRecurring(aliceToken, {
        symbol: 'AAPL',
        qty: '1',
        frequency: 'weekly',
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { item: any };
      const aliceRecurringId = created.item.id;

      // Bob tries to pause it.
      const patchRes = await patchRecurring(bobToken, aliceRecurringId, { is_active: false });
      expect(patchRes.status, "bob patching alice's recurring must 404").toBe(404);

      // Bob tries to delete it.
      const delRes = await deleteRecurring(bobToken, aliceRecurringId);
      expect(delRes.status, "bob deleting alice's recurring must 404").toBe(404);

      // Alice can still see her own schedule, unchanged.
      const aliceList = await listRecurring(aliceToken);
      const target = aliceList.items.find((i: any) => i.id === aliceRecurringId);
      expect(target).toBeDefined();
      expect(target.is_active).toBe(true);
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
