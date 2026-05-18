// /api/webhooks/alpaca is JWT-unauthenticated (Alpaca can't carry our
// token), gated only by HMAC-SHA256 over the raw body — so the edges
// matter. Asserts missing-sig → 401, forged-sig → 401, valid-sig +
// unknown event_type → 200 no-op, non-JSON body → 400. Event-id
// idempotency is covered separately by wishlist_auto_execute.

import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { PHX_URL } from '../helpers/env';

const WEBHOOK_SECRET = process.env.ALPACA_WEBHOOK_SECRET ?? 'dev-webhook-secret';
const WEBHOOK_URL = `${PHX_URL}/api/webhooks/alpaca`;

function buildPayload(eventType: string) {
  return JSON.stringify({
    event_id: `e2e-hardening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_type: eventType,
    at: new Date().toISOString(),
    data: { id: 'irrelevant', status: 'whatever' },
  });
}

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

test.describe('webhook hardening', () => {
  test('rejects a webhook with no signature header (401)', async () => {
    const body = buildPayload('transfer.status_updated');
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status, 'missing signature must not be accepted').toBe(401);
  });

  test('rejects a webhook with a forged signature (401)', async () => {
    const body = buildPayload('transfer.status_updated');
    // Hex string that's syntactically valid but cryptographically wrong.
    const forged = 'deadbeef'.repeat(8);
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Alpaca-Signature': forged,
      },
      body,
    });
    expect(res.status, 'forged signature must not be accepted').toBe(401);
  });

  test('accepts a valid signature but no-ops on an unknown event_type (200)', async () => {
    // dispatch/2 in AlpacaWebhooks has a catch-all clause for event
    // types it doesn't recognise — it logs and returns :ok rather than
    // crashing. We just want to confirm the receiver returns 2xx so
    // Alpaca doesn't keep retrying things we don't care about.
    const body = buildPayload('some.future.event_type');
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Alpaca-Signature': sign(body),
      },
      body,
    });
    expect(res.status, 'unknown event_type with valid sig should be acked').toBe(200);
  });

  test('rejects a non-JSON body even with a valid signature (400)', async () => {
    // Hardening edge: signature verifies over raw bytes, then we
    // Jason.decode. If the body isn't JSON the controller returns 400
    // (not 500) so a misconfigured upstream doesn't look like a
    // server failure in our logs.
    const body = 'not-json-at-all';
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Alpaca-Signature': sign(body),
      },
      body,
    });
    expect(res.status).toBe(400);
  });
});
