// Shared URL constants for the E2E suite. The Playwright config also
// reads BASE_URL but we re-export it here so non-page helpers (api,
// mailbox) can build absolute URLs without importing from playwright.

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
export const PHX_URL = process.env.PHX_URL ?? 'http://localhost:4000';
