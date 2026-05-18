// Locks down the auth plug — the single gate in front of every
// per-user endpoint. If it ever silently falls through, the
// multi_user_isolation guarantees go with it. Pure-HTTP (no browser):
// hits each protected surface with no token and a bogus token and
// asserts 401 + the same error envelope. Add new authenticated
// endpoints to PROTECTED_ENDPOINTS below.

import { expect, test } from '@playwright/test';
import { PHX_URL } from '../helpers/env';

const PROTECTED_ENDPOINTS: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'GET', path: '/api/wishlist' },
  { method: 'GET', path: '/api/brokerage/portfolios' },
  { method: 'GET', path: '/api/alpaca/account' },
  { method: 'GET', path: '/api/alpaca/orders' },
  { method: 'GET', path: '/api/alpaca/positions' },
  { method: 'GET', path: '/api/broker/funding/deposits' },
  { method: 'POST', path: '/api/alpaca/orders' },
];

async function hit(path: string, method: 'GET' | 'POST', authHeader?: string) {
  return fetch(`${PHX_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
}

test.describe('unauthenticated API access', () => {
  test('every per-user endpoint returns 401 with no Authorization header', async () => {
    for (const ep of PROTECTED_ENDPOINTS) {
      const res = await hit(ep.path, ep.method);
      expect(res.status, `${ep.method} ${ep.path} should reject anonymous calls`).toBe(401);
      const body = (await res.json()) as { error?: string };
      expect(body.error, `${ep.method} ${ep.path} error envelope`).toBe('unauthorized');
    }
  });

  test('every per-user endpoint returns 401 with a malformed bearer token', async () => {
    // Tokens this short can't be valid JWTs — we want to make sure the
    // plug rejects them rather than crashing or 500-ing.
    for (const ep of PROTECTED_ENDPOINTS) {
      const res = await hit(ep.path, ep.method, 'Bearer not-a-real-jwt');
      expect(res.status, `${ep.method} ${ep.path} should reject malformed tokens`).toBe(401);
    }
  });

  test('public endpoints stay reachable without auth (sanity check)', async () => {
    // If the auth plug ever creeps onto these by accident — say, a
    // misplaced `pipe_through :authenticated` — this test will catch it.
    const health = await fetch(`${PHX_URL}/api/health`);
    expect(health.ok, '/api/health must be public').toBe(true);
  });
});
