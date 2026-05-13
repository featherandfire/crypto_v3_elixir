// Backend API helpers used after a UI-driven login. The auth token is
// pulled from the browser's localStorage (see `flows.getAuthToken`)
// and passed to these helpers as a Bearer credential.
//
// Webhook signing uses the dev secret from `.env`:
// `ALPACA_WEBHOOK_SECRET=dev-webhook-secret`. The real backend verifies
// HMAC-SHA256 over the raw body the same way Alpaca would in prod.

import { createHmac } from 'node:crypto';
import { PHX_URL } from './driver';

const API = `${PHX_URL}/api`;
const WEBHOOK_SECRET =
  process.env.ALPACA_WEBHOOK_SECRET ?? 'dev-webhook-secret';

export type WishlistItem = {
  id: number;
  symbol: string;
  qty: string;
  status: 'pending' | 'filled' | 'canceled' | 'failed';
  executed_order_id: string | null;
};

export type Deposit = {
  id: number;
  amount: string;
  status: string;
  reference: string;
};

export type AlpacaAccount = {
  cash: string | null;
  buying_power: string | null;
  status: string | null;
} | null;

async function authedFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${body}`);
  }
  return res;
}

export async function listWishlist(token: string): Promise<WishlistItem[]> {
  const res = await authedFetch(token, '/wishlist');
  const json = (await res.json()) as { items: WishlistItem[] };
  return json.items ?? [];
}

export async function listDeposits(token: string): Promise<Deposit[]> {
  const res = await authedFetch(token, '/broker/funding/deposits');
  const json = (await res.json()) as { deposits: Deposit[] };
  return json.deposits ?? [];
}

/**
 * Polls /api/wishlist until the named symbol reaches `expectedStatus`.
 * Throws after `timeoutMs`. Used by the auto-execute spec to wait for
 * a wishlist row to flip pending → filled after the simulated webhook.
 */
export async function pollWishlistStatus(
  token: string,
  symbol: string,
  expectedStatus: WishlistItem['status'],
  timeoutMs = 15_000,
): Promise<WishlistItem> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const items = await listWishlist(token);
    const match = items.find((i) => i.symbol === symbol);
    if (match && match.status === expectedStatus) return match;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `wishlist ${symbol} never reached status=${expectedStatus} within ${timeoutMs}ms`,
  );
}

export async function getAlpacaAccount(token: string): Promise<AlpacaAccount> {
  const res = await authedFetch(token, '/alpaca/account');
  return (await res.json()) as AlpacaAccount;
}

/**
 * Waits for the user's Alpaca trading account to show at least
 * `minBuyingPower` dollars of buying_power. Sandbox QUEUES transfers
 * before crediting cash; in production an Alpaca-sent webhook only
 * lands after settlement, but our test fires the webhook manually, so
 * we need this gate to avoid the auto-execute racing the cash credit.
 */
export async function waitForBuyingPower(
  token: string,
  minBuyingPower: number,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const account = await getAlpacaAccount(token);
    const bp = parseFloat(account?.buying_power ?? '0');
    if (Number.isFinite(bp) && bp >= minBuyingPower) return;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(
    `Alpaca buying_power never reached ${minBuyingPower} within ${timeoutMs}ms`,
  );
}

/**
 * Constructs a signed Alpaca-style webhook payload and POSTs it at the
 * local Phoenix receiver. Matches the production HMAC scheme so the
 * receiver verifies and ingests just like a real delivery.
 */
export async function fireSignedWebhook(
  eventType: string,
  resourceId: string,
  status: string,
): Promise<void> {
  const payload = {
    event_id: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_type: eventType,
    at: new Date().toISOString(),
    data: { id: resourceId, status },
  };
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const res = await fetch(`${API}/webhooks/alpaca`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Alpaca-Signature': signature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`webhook receiver returned ${res.status} for ${eventType}`);
  }
}
