import '../css/style.css';
import Alpine from 'alpinejs';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import {
  COIN_DESCRIPTIONS,
  COIN_FEATURES,
  COIN_YIELD_TYPES,
  HARD_CAPS,
  STABLECOIN_SYMBOLS,
  _collateralMap,
  _hardCapLabel,
  coinYieldApr,
  fmtCoinFees,
  fmtYieldIncome,
} from './coin-data.ts';

// ── Types ───────────────────────────────────────────────────────────────────

interface User {
  id: number;
  username: string;
  email: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

interface Portfolio {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ApiError extends Error {
  status?: number;
  retryAfter?: number;
  // Parsed JSON body from the failed response, when available. Lets
  // callers branch on structured error fields (e.g. validation lists)
  // instead of regexing the message string.
  body?: Record<string, unknown>;
}

// ── API client ──────────────────────────────────────────────────────────────

const API = '/api';

const DECIMAL_FIELDS = new Set([
  'amount', 'avg_buy_price',
  'current_price_usd', 'price_change_24h', 'market_cap',
  'circulating_supply', 'max_supply',
  'current_value_usd', 'total_cost_usd', 'pnl_usd', 'pnl_pct',
  'total_value_usd', 'total_pnl_usd', 'total_pnl_pct',
  'balance', 'fee_pct', 'price_change_200d', 'price_change_1y',
  'gas_usd', 'gas_native',
]);

function parseDecimalsDeep<T>(obj: T): T {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(parseDecimalsDeep) as unknown as T;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (DECIMAL_FIELDS.has(k) && typeof v === 'string') {
      const n = Number(v);
      o[k] = Number.isFinite(n) ? n : v;
    } else if (v && typeof v === 'object') {
      o[k] = parseDecimalsDeep(v);
    }
  }
  return obj;
}

// Translate Alpaca's terse error strings to plain language. Pattern-matches
// the most common rejections; falls back to the raw text for anything we
// haven't seen, so unknown failures aren't silently swallowed.
function humanizeAlpacaError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('not active') || m.includes('not tradable')) {
    const sym = raw.match(/asset\s+(\S+)/i)?.[1];
    return sym
      ? `${sym} is no longer tradable. The asset may have been delisted, acquired, or moved off Alpaca's exchanges. Try a different symbol.`
      : "This asset is no longer tradable. It may have been delisted, acquired, or moved off Alpaca's exchanges.";
  }
  if (m.includes('insufficient buying power') || m.includes('insufficient funds')) {
    return 'Not enough buying power to place this order. Add funds or reduce the order size.';
  }
  if (m.includes('wash trade')) {
    return "Can't place this order — you already have an opposing buy/sell working on the same symbol. Cancel that one first.";
  }
  if (m.includes('position not found') || m.includes('not enough shares') || m.includes('insufficient qty')) {
    return "You don't hold enough of this position, so there's nothing to sell.";
  }
  if (m.includes('fractional') || (m.includes('qty') && m.includes('integer'))) {
    return "This stock doesn't support fractional shares. Use a whole-number quantity.";
  }
  if (m.includes('market is closed') || (m.includes('outside') && m.includes('hours'))) {
    return 'Market is closed. Stock orders queue for the next session; crypto trades 24/7.';
  }
  if (m.includes('extended') && m.includes('limit')) {
    return 'Extended-hours orders must be Limit, not Market.';
  }
  if (m.includes('must be greater than') || m.includes('must be > 0') || m.includes('notional')) {
    return 'Quantity or amount must be greater than zero.';
  }
  return raw;
}

async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API + path, { ...opts, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    const e: ApiError = new Error('unauthorized');
    e.status = 401;
    throw e;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    let msg = res.statusText || 'Request failed';
    if (typeof body.error === 'string') {
      msg = body.error;
      // alpaca_http_NNN wraps Alpaca's response in body.body — surface the
      // human-readable reason and run it through humanizeAlpacaError so
      // common rejections become plain English.
      if (msg.startsWith('alpaca_http_')) {
        const inner = (body as any).body;
        let raw = '';
        if (typeof inner === 'string' && inner.length) raw = inner;
        else if (inner && typeof inner === 'object' && typeof inner.message === 'string') raw = inner.message;
        if (raw) msg = humanizeAlpacaError(raw);
      }
    } else if (body.errors && typeof body.errors === 'object') {
      msg = Object.entries(body.errors as Record<string, string[]>)
        .map(([field, errs]) => `${field} ${errs.join(', ')}`)
        .join('; ');
    }
    const e: ApiError = new Error(msg);
    e.status = res.status;
    e.body = body;
    if (typeof body.retry_after === 'number') e.retryAfter = body.retry_after;
    throw e;
  }

  if (res.status === 204) return null as T;
  const data = await res.json();
  return parseDecimalsDeep(data) as T;
}

// ── Formatting ──────────────────────────────────────────────────────────────

function fmtUSD(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(v);
}

function fmtPct(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtAmount(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

function fmtMktCap(n: number | string | null | undefined): string {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ── Misc helpers ────────────────────────────────────────────────────────────

function debounce<T extends (...args: any[]) => any>(fn: T, ms = 350): T {
  let t: ReturnType<typeof setTimeout>;
  return function (this: unknown, ...a: Parameters<T>) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms);
  } as T;
}

// Flat allocation rows from /api/brokerage/positions → nested map keyed
// by symbol then stringified portfolio_id, matching the shape the rest
// of the UI expects.
function allocationsToMap(
  rows: Array<{ symbol: string; portfolio_id: number; qty: string }>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const sym = (out[r.symbol] ||= {});
    sym[String(r.portfolio_id)] = parseFloat(r.qty) || 0;
  }
  return out;
}

function lsSet(key: string, value: unknown, ttlSeconds: number | null = null) {
  try {
    localStorage.setItem(key, JSON.stringify({
      v: value,
      exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    }));
  } catch { /* quota */ }
}

function lsGet<T = unknown>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const item = JSON.parse(raw) as { v: T; exp: number | null };
    if (item.exp && Date.now() > item.exp) {
      localStorage.removeItem(key);
      return null;
    }
    return item.v;
  } catch {
    return null;
  }
}

function _dataScore(c: Record<string, unknown>): number {
  let s = 0;
  const keys = ['last','mktCap','vol90d','vol180d','vol365d','high','low','circulating','change1_5y'];
  for (const k of keys) if (c[k] != null) s++;
  return s;
}

// ── Globals for Alpine templates ────────────────────────────────────────────

declare global {
  interface Window {
    Alpine: typeof Alpine;
    dashApp?: () => Record<string, unknown>;
    loginApp?: () => Record<string, unknown>;
    fmtUSD: typeof fmtUSD;
    fmtPct: typeof fmtPct;
    fmtAmount: typeof fmtAmount;
    fmtMktCap: typeof fmtMktCap;
    fmtCoinFees: typeof fmtCoinFees;
    fmtYieldIncome: typeof fmtYieldIncome;
    _hardCapLabel: typeof _hardCapLabel;
    initPlatformsAnimNav?: () => void;
  }
}

// Animated category nav for Platforms page. Idempotent per-mount (Alpine
// re-fires via x-init). Clip-path slides to the active button.
function initPlatformsAnimNav() {
  const menu = document.querySelector<HTMLElement>('.platforms-anim-nav .menu');
  if (!menu || menu.dataset.animNavInit === '1') return;
  menu.dataset.animNavInit = '1';

  const items = Array.from(menu.querySelectorAll<HTMLElement>('.menu__item'));
  const border = menu.querySelector<HTMLElement>('.menu__border');
  if (!border || items.length === 0) return;

  let active = menu.querySelector<HTMLElement>('.menu__item.active') ?? items[0];

  const offsetBorder = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const left = Math.floor(rect.left - menu.getBoundingClientRect().left - (border.offsetWidth - rect.width) / 2);
    border.style.transform = `translate3d(${left}px, 0, 0)`;
  };

  const click = (item: HTMLElement) => {
    menu.style.removeProperty('--timeOut');
    if (active === item) return;
    active.classList.remove('active');
    item.classList.add('active');
    active = item;
    offsetBorder(active);
  };

  items.forEach((item) => item.addEventListener('click', () => click(item)));

  // Initial position. Run on next frame so getBoundingClientRect picks up the
  // final layout (Alpine x-show flips display between renders).
  requestAnimationFrame(() => offsetBorder(active));

  window.addEventListener('resize', () => {
    offsetBorder(active);
    menu.style.setProperty('--timeOut', 'none');
  });
}

window.initPlatformsAnimNav = initPlatformsAnimNav;

window.Alpine = Alpine;
window.fmtUSD = fmtUSD;
window.fmtPct = fmtPct;
window.fmtAmount = fmtAmount;
window.fmtMktCap = fmtMktCap;
window.fmtCoinFees = fmtCoinFees;
window.fmtYieldIncome = fmtYieldIncome;
window._hardCapLabel = _hardCapLabel;

// ── Stores ──────────────────────────────────────────────────────────────────

interface AuthStore {
  token: string | null;
  user: User | null;
  readonly isLoggedIn: boolean;
  init(): Promise<void>;
  login(identifier: string, password: string): Promise<void>;
  register(username: string, email: string, password: string): Promise<void>;
  verifyEmail(identifier: string, code: string): Promise<void>;
  resetPassword(identifier: string, code: string, newPassword: string): Promise<void>;
  logout(): void;
}

interface ToastItem { id: number; msg: string; type: string; }
interface ToastStore {
  items: ToastItem[];
  show(msg: string, type?: string): void;
}

document.addEventListener('alpine:init', () => {
  const toastStore: ToastStore = {
    items: [],
    show(msg, type = 'success') {
      const id = Date.now();
      this.items.push({ id, msg, type });
      setTimeout(() => {
        this.items = this.items.filter((i) => i.id !== id);
      }, 3500);
    },
  };

  const authStore: AuthStore = {
    token: localStorage.getItem('token'),
    user: null,
    get isLoggedIn() { return !!this.token; },

    async init() {
      if (!this.token) return;
      try {
        const res = await apiFetch<{ user: User }>('/auth/me');
        this.user = res.user;
      } catch {
        this.token = null;
        localStorage.removeItem('token');
      }
    },

    async login(identifier, password) {
      const res = await apiFetch<{ user: User; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      localStorage.setItem('token', res.token);
      this.token = res.token;
      this.user = res.user;
    },

    async register(username, email, password) {
      // No token returned — account is created unverified. User must submit
      // the emailed 6-digit code via verifyEmail() to actually sign in.
      await apiFetch<{ user: User; message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });
    },

    async verifyEmail(identifier, code) {
      const res = await apiFetch<{ user: User; token: string }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ identifier, code }),
      });
      localStorage.setItem('token', res.token);
      this.token = res.token;
      this.user = res.user;
    },

    async resetPassword(identifier, code, newPassword) {
      const res = await apiFetch<{ user: User; token: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ identifier, code, new_password: newPassword }),
      });
      localStorage.setItem('token', res.token);
      this.token = res.token;
      this.user = res.user;
    },

    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
    },
  };

  Alpine.store('toast', toastStore);
  Alpine.store('auth', authStore);
  void authStore.init();
});

// ── Login component ─────────────────────────────────────────────────────────

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect username or password.',
  invalid_code: 'Invalid code.',
  code_expired: 'This code has expired — please request a new one.',
  email_not_verified: 'Email not verified. Please enter the 6-digit code we sent you.',
  already_verified: 'This account is already verified. Please sign in.',
  too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
  reset_failed: 'Could not send reset code. Please try again in a moment.',
};

function humanizeAuthError(err: unknown): string {
  const msg = (err as Error).message || 'Something went wrong.';
  return AUTH_ERROR_MESSAGES[msg] ?? msg;
}

window.loginApp = () => ({
  // 'landing' shows the public marketing page; 'auth' shows the
  // sign-in / register form. CTAs on the landing page flip this.
  view: 'landing' as 'landing' | 'auth',
  tab: 'login' as 'login' | 'register',
  username: '', email: '', password: '',
  loading: false, error: '',
  verifyStep: false, pendingEmail: '', pendingIdentifier: '', verifyCode: '', resendCooldown: 0,
  _resendTimer: 0 as number,
  pwVisible: false,
  // Forgot-password flow: 'request' → 'reset' → null (closed).
  forgotStep: null as null | 'request' | 'reset',
  forgotIdentifier: '', forgotCode: '', forgotNewPassword: '',
  forgotInfo: '',
  forgotPwVisible: false,

  async submit(this: any) {
    this.error = '';
    this.loading = true;
    try {
      const auth = Alpine.store('auth') as AuthStore;
      if (this.tab === 'login') {
        await auth.login(this.username, this.password);
        window.location.reload();
      } else {
        await auth.register(this.username, this.email, this.password);
        this.pendingEmail = this.email;
        this.pendingIdentifier = this.username;
        this.verifyCode = '';
        this.verifyStep = true;
      }
    } catch (e) {
      this.error = humanizeAuthError(e);
    } finally {
      this.loading = false;
    }
  },

  async submitVerify(this: any) {
    this.error = '';
    this.loading = true;
    try {
      const auth = Alpine.store('auth') as AuthStore;
      await auth.verifyEmail(this.pendingIdentifier, this.verifyCode);
      window.location.reload();
    } catch (e) {
      this.error = humanizeAuthError(e);
    } finally {
      this.loading = false;
    }
  },

  async resendCode(this: any) {
    if (this.resendCooldown > 0) return;
    this.error = '';
    this.loading = true;
    try {
      await apiFetch('/auth/resend-code', {
        method: 'POST',
        body: JSON.stringify({ identifier: this.pendingIdentifier }),
      });
      this._startResendCooldown(60);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429 && err.retryAfter) {
        this._startResendCooldown(err.retryAfter);
        this.error = `Please wait ${err.retryAfter}s before requesting another code.`;
      } else {
        this.error = humanizeAuthError(e);
      }
    } finally {
      this.loading = false;
    }
  },

  openForgot(this: any) {
    this.error = '';
    this.forgotInfo = '';
    this.forgotIdentifier = this.username || this.email || '';
    this.forgotCode = '';
    this.forgotNewPassword = '';
    this.forgotStep = 'request';
  },

  closeForgot(this: any) {
    this.forgotStep = null;
    this.error = '';
    this.forgotInfo = '';
  },

  async submitForgotRequest(this: any) {
    this.error = '';
    this.loading = true;
    try {
      await apiFetch<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: this.forgotIdentifier }),
      });
      this.forgotInfo = 'If that account exists, a 6-digit code is on its way.';
      this.forgotCode = '';
      this.forgotStep = 'reset';
      this._startResendCooldown(60);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429 && err.retryAfter) {
        this._startResendCooldown(err.retryAfter);
        this.error = `Please wait ${err.retryAfter}s before requesting another code.`;
        // Still advance to the reset step — they have a code from the prior request.
        this.forgotStep = 'reset';
      } else {
        this.error = humanizeAuthError(e);
      }
    } finally {
      this.loading = false;
    }
  },

  async submitForgotReset(this: any) {
    this.error = '';
    this.loading = true;
    try {
      const auth = Alpine.store('auth') as AuthStore;
      await auth.resetPassword(this.forgotIdentifier, this.forgotCode, this.forgotNewPassword);
      window.location.reload();
    } catch (e) {
      this.error = humanizeAuthError(e);
    } finally {
      this.loading = false;
    }
  },

  async resendForgotCode(this: any) {
    if (this.resendCooldown > 0) return;
    this.error = '';
    this.loading = true;
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: this.forgotIdentifier }),
      });
      this._startResendCooldown(60);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429 && err.retryAfter) {
        this._startResendCooldown(err.retryAfter);
        this.error = `Please wait ${err.retryAfter}s before requesting another code.`;
      } else {
        this.error = humanizeAuthError(e);
      }
    } finally {
      this.loading = false;
    }
  },

  _startResendCooldown(this: any, seconds: number) {
    this.resendCooldown = seconds;
    clearInterval(this._resendTimer);
    this._resendTimer = window.setInterval(() => {
      this.resendCooldown -= 1;
      if (this.resendCooldown <= 0) {
        clearInterval(this._resendTimer);
        this._resendTimer = 0;
        this.resendCooldown = 0;
      }
    }, 1000);
  },
});

// ── Dashboard component ─────────────────────────────────────────────────────

const VALID_PAGES = ['portfolios', 'resources', 'marketplace', 'platforms', 'wallet', 'wallet-address', 'fund-account', 'pick-a-coin', 'buy-a-coin', 'transaction-hash', 'exchange-funds', 'wallet-tutorial', 'market-extra', 'brokerage', 'holdings', 'contact-us', 'investor-memo', 'personas', 'starter-portfolio', 'account-setup'];

// Editorial — use real, well-known addresses (e.g. Satoshi's) so readers can verify externally.
type ChainAddressFormat = {
  chain: string;
  prefix: string;
  encoding: string;
  length: string;
  example: string;
  note?: string;
};

const CHAIN_ADDRESS_FORMATS: ChainAddressFormat[] = [
  {
    chain: 'Ethereum / EVM (BSC, Polygon, Arbitrum, Optimism, Base, Avalanche)',
    prefix: '0x',
    encoding: 'hex (EIP-55 mixed-case checksum optional)',
    length: '42 chars',
    example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    note: 'Same address works across every EVM chain — but the asset is chain-specific. Sending USDC on Ethereum to a Polygon address with the same string strands the funds.',
  },
  {
    chain: 'Bitcoin — legacy (P2PKH)',
    prefix: '1',
    encoding: 'base58',
    length: '26–35 chars',
    example: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    note: 'Satoshi\'s genesis address. Older format; higher fees than segwit.',
  },
  {
    chain: 'Bitcoin — script (P2SH, multisig)',
    prefix: '3',
    encoding: 'base58',
    length: '34 chars',
    example: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  },
  {
    chain: 'Bitcoin — segwit (P2WPKH / Taproot)',
    prefix: 'bc1',
    encoding: 'bech32 / bech32m (lowercase only)',
    length: '42–62 chars',
    example: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    note: 'Lower fees, better error detection. Most modern wallets default to this.',
  },
  {
    chain: 'Solana',
    prefix: '(none)',
    encoding: 'base58 (Ed25519 public key)',
    length: '32–44 chars',
    example: 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy',
    note: 'No prefix — addresses look like random alphanumeric strings.',
  },
  {
    chain: 'Tron',
    prefix: 'T',
    encoding: 'base58 (similar to Bitcoin)',
    length: '34 chars',
    example: 'TJYeasLud3oRZ1c1HnkZcKn5VxXwmBCBT2',
  },
  {
    chain: 'Litecoin',
    prefix: 'L / M / ltc1',
    encoding: 'base58 (legacy) or bech32 (segwit)',
    length: '26–62 chars',
    example: 'ltc1qg9stkxrszkdqsuj92lm4c7akvk36zvhqw7p6ck',
  },
  {
    chain: 'XRP / Ripple',
    prefix: 'r',
    encoding: 'base58 (custom alphabet)',
    length: '25–35 chars',
    example: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh',
    note: 'Often paired with a "destination tag" — exchanges require it for deposits.',
  },
  {
    chain: 'Cardano',
    prefix: 'addr1',
    encoding: 'bech32',
    length: '58–103 chars',
    example: 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
    note: 'Among the longest addresses in common use.',
  },
];

// Stock screener — hardcoded curated list (v1). Notes are factual, not advice.
type ScreenerStock = { symbol: string; name: string; note: string };
type ScreenerCategory = { id: string; label: string; stocks: ScreenerStock[]; benchmark?: string; view?: 'stocks' | 'etfs'; description?: string };

// ── Filter chips: single source of truth ────────────────────────────────
// Order = donut-bucket priority (first matching chip wins). UI order lives
// in FILTER_CHIP_ORDER. To add a chip: one entry here + (optional) entry
// in FILTER_CHIP_ORDER if it should be clickable in the Filters tab.
type Chip = { id: string; color: string; info?: string; subs?: string[] };

const CHIPS: Chip[] = [
  { id: 'ETF',           color: '#9333ea', info: "Exchange-traded funds hold a basket of underlying assets. Dividend ETFs distribute the income their holdings pay. Index ETFs (SPY, QQQ) pass through small dividends from the underlying companies." },
  { id: 'crypto',        color: '#f7931a' /* Bitcoin orange */ },
  { id: 'AI',            color: '#0ea5e9', info: "AI covers chip designers (NVDA, AMD, AVGO), AI server hardware (SMCI), networking (ANET), AI-native software (PLTR, C3.ai, SOUN), and incumbents pivoting hard (ORCL, MSFT). Most pay little or no dividend — growth and capex dominate. Valuations are sentiment-driven, so volatility is high." },
  { id: 'EV',            color: '#10b981' /* Tesla emerald */, info: "EV (electric vehicles) spans automakers (TSLA, GM, Rivian, Lucid, Chinese EVs), charging networks (BLNK, CHPT, EVGO), and battery tech (QS). Most pure-plays burn cash and don't pay dividends; legacy automakers (GM, F) do pay. Highly sensitive to EV adoption rates and lithium / battery supply." },
  { id: 'semis',         color: '#76b900' /* NVIDIA green */, info: "Semiconductors — chip designers (NVDA, AMD, AVGO, QCOM, MRVL), foundries (TSM, INTC), memory (MU), and equipment makers (ASML, AMAT, LRCX, KLAC). Highly cyclical with strong AI tailwinds. Most pay small dividends; capex and R&D dominate cash use.", subs: ['foundry', 'memory', 'equipment', 'mobile', 'networking'] },
  { id: 'pharma',        color: '#22c55e', info: "Big pharma names are steady dividend payers. Patents drive earnings and dividend safety; patent cliffs are the main risk.", subs: ['oncology', 'mRNA', 'vaccine', 'generic', 'animal', 'diabetes'] },
  { id: 'energy',        color: '#f59e0b', info: "Energy covers oil & gas integrateds (XOM, CVX, COP), independent E&Ps (EOG, OXY, DVN), refiners (PSX, MPC, VLO), and oilfield services (SLB, HAL, BKR). Cash flow tracks oil and gas prices, so dividends are real but cyclical. Most majors pay 3–5%+ yields.", subs: ['oil major', 'refiner', 'oilfield', 'shale'] },
  { id: 'utility',       color: '#06b6d4', info: "Utilities are regulated monopolies — predictable cash flow, steady dividends (3–5% typical), and slow growth. Highly sensitive to interest rates: when bond yields rise, utility prices fall as their dividends become relatively less attractive. Bond-proxy behavior." },
  { id: 'fintech',       color: '#c026d3', info: "Fintech covers card networks (V, MA, AXP), digital payments (PYPL, SQ), brokers (HOOD), neobanks (SOFI, NU), buy-now-pay-later (AFRM), and crypto (COIN). Networks are the most defensive; the rest are sensitive to consumer credit, rates, and regulation. Mostly growth-focused, modest dividends.", subs: ['payment', 'card', 'lending', 'crypto', 'broker', 'neobank'] },
  { id: 'china',         color: '#ec4899', info: "China-listed ADRs — e-commerce (BABA, JD, PDD), search (BIDU), gaming (NTES, TCEHY, BILI), and EVs (NIO, XPEV, LI). Carry geopolitical risk (delisting threats, US export controls) and accounting transparency concerns. Rarely pay meaningful dividends." },
  { id: 'entertainment', color: '#e11d48' /* Netflix red */, info: "Entertainment spans streaming (NFLX, DIS, WBD, PARA), live events (LYV, AMC), video games (EA, TTWO, RBLX), and music/audio (SPOT). Cyclical with consumer spending; streaming is the dominant secular trend. Many cut or paused dividends to fund content; modest yields where they exist.", subs: ['streaming', 'gaming', 'music', 'live', 'theater'] },
  { id: 'farming',       color: '#84cc16', info: "Farming spans equipment (DE, AGCO, CNHI), grain trading (BG, ADM), seeds and ag chemicals (CTVA, FMC), fertilizers (MOS, CF, NTR), and meat processing (TSN). Cyclical with crop prices, weather, and trade policy. Most pay reliable dividends but earnings swing widely.", subs: ['equipment', 'grain', 'fertilizer', 'crop', 'meat'] },
  { id: 'mining',        color: '#ea580c', info: "Most mining stocks reinvest heavily and pay token dividends. They're the opposite of REITs/BDCs (which are forced by tax law to distribute most income)." },
  { id: 'defense',       color: '#ef4444', info: "Defense contractors. Revenue is dominated by long-term US government contracts, which makes earnings less cyclical than most sectors. Most pay modest dividends (1–3%) and reinvest in R&D. Share prices typically run high ($100+), so most won't appear on the Under $20 + dividend tab.", subs: ['missile', 'naval', 'drone', 'IT services'] },
  { id: 'aerospace',     color: '#4f46e5', info: "Aerospace covers commercial airliners (Boeing) and the engine + components ecosystem that supplies them (GE Aerospace, HEICO, Howmet, etc.). Highly cyclical with airline orders; defense aerospace overlap (Boeing, RTX) provides ballast. Like defense, share prices typically run well above $20." },
  { id: 'bank',          color: '#eab308', info: "Bank stocks pay dividends from net interest income — yields move with Fed rates and loan-loss provisions. The 2023 SVB/Signature failures are a recent credit-risk reminder.", subs: ['regional', 'consumer', 'investment'] },
  { id: 'telecom',       color: '#0891b2', info: "Telecom stocks pay above-average dividends but face declining wireline revenue and high 5G capex. Yields are real; growth is rare." },
  { id: 'hotel',         color: '#db2777', info: "Hotel REITs are cyclical — strong during travel booms, vulnerable in recessions. Many cut dividends during the 2020 pandemic; current yields reflect the post-recovery rates." },
  { id: 'tech',          color: '#3b82f6', info: "Big-tech platforms — AAPL, MSFT, GOOGL, AMZN, META, plus IBM. Different from AI/semis: these are the platforms / megacap incumbents whose business is software, services, and ad / cloud distribution rather than chips. Most pay modest dividends; growth and buybacks dominate." },
  { id: 'retail',        color: '#be123c', info: "Retailers — apparel (VFC, GES) and department stores (KSS, M). Highly cyclical with consumer spending; dividends often vary or get cut during downturns. Yield-trap risk is real here when prices fall faster than dividends." },
  { id: 'shipping',      color: '#0369a1', info: "Maritime shipping — tankers (NAT), LNG carriers (DLNG), container ships (CMRE). Spot-rate dependent and brutally cyclical. Dividends can be enormous in boom years and zero in bust years. Treat as cyclicals, not income staples." },
  { id: 'tobacco',       color: '#65a30d', info: "Tobacco — defensive, addictive demand, very high dividend yields. MO (Altria) is the canonical name. ESG-screened funds exclude these, which has historically created persistent valuation discounts and elevated yields." },
  { id: 'auto',          color: '#2563eb', info: "Traditional automakers — F (Ford), GM (in EV chip), HMC (Honda), TM (Toyota), STLA (Stellantis), HOG (Harley-Davidson). Cyclical with consumer credit and rates. EV-pure plays (RIVN, LCID, etc.) live under EV; this chip is the legacy ICE / hybrid majors." },
  { id: 'food',          color: '#f97316', info: "Packaged-food makers — KHC, CAG, K, SJM, MKC, CPB, BGS. Defensive, slow growth, reliable dividends. Generally a bond-proxy bucket: prices move inversely to interest rates." },
  { id: 'chemicals',     color: '#64748b', info: "Industrial / specialty chemicals — DOW, LYB, EMN, ALB (lithium), CE, OLN, HUN. Cyclical, energy-input sensitive. Dividends are real but earnings whipsaw with input costs and end-market demand. Distinct from agricultural chemicals (under farming)." },
  { id: 'fund',          color: '#38bdf8', info: "Closed-end funds — actively managed pools that trade like stocks but at premiums or discounts to NAV. ECC (CLO income), PDI (PIMCO income), BST (BlackRock tech), ADX (diversified equity). High distribution yields are common but can include return-of-capital — read the holdings." },
  { id: 'REIT-Like',     color: '#8b5cf6', info: "Real-estate operating companies that aren't structured as REITs — KW (Kennedy-Wilson), TPL (Texas Pacific Land royalty), FRPH (FRP Holdings), FOR (Forestar). Real-estate exposure without the 90% distribution rule, so they typically pay smaller dividends but reinvest more." },
  { id: 'REIT',          color: '#7c3aed', info: "Real Estate Investment Trusts. Tax law requires them to distribute ≥90% of taxable income, so dividend yields are usually high. Highly sensitive to interest rates — REIT prices typically fall when rates rise.", subs: ['mortgage', 'hotel', 'healthcare', 'apartment', 'commercial', 'industrial'] },
  { id: 'BDC',           color: '#059669', info: "Business Development Companies. Publicly-traded private credit — they lend to small and mid-sized private companies. Same 90% distribution rule as REITs, so yields are typically 8–14%. Watch for yield-trap risk when prices fall faster than dividends.", subs: ['monthly', 'venture', 'floating'] },
  { id: 'monthly',       color: '#a855f7', info: "Stocks that pay dividends every month rather than quarterly. Mostly REITs (O, AGNC, EFC, DX, ORC, LAND, APLE, GOOD) and BDCs (GAIN, HRZN, TRIN, OXSQ, PFLT, SCM, GLAD, PSEC). Useful for income smoothing, but the underlying yield-trap risks of REITs/BDCs still apply." },
  { id: 'aristocrat',    color: '#5b21b6', info: "S&P 500 Dividend Aristocrats — companies that have raised their dividend for 25+ consecutive years. Names like KO, PEP, PG, JNJ, MCD, CAT, KMB, LOW, WMT, CVX. The track record signals discipline and durability, but past raises don't guarantee future ones (T cut in 2022, ABBV's parent Abbott split)." },
  { id: 'Local',         color: '#14b8a6', info: "Companies headquartered in your region — currently IA, MN, KS, and IL. Useful for the \"buy what you know\" filter — businesses you can drive past, shop at, or recognize from local news. Use the state sub-chip to narrow.", subs: ['IA', 'MN', 'KS', 'IL'] },
  { id: 'cybersecurity', color: '#dc2626', info: "Cybersecurity — firewalls and SASE (PANW, ZS, FTNT), edge / DDoS (NET), endpoint (CRWD, S), identity (OKTA, CYBR), data security (VRNS), exposure management (RPD, TENB). Mostly growth stocks with little / no dividend; valuations track ARR growth and net retention. Highly defensive demand — security budgets rarely shrink." },
  { id: 'software',      color: '#6366f1', info: "Software / SaaS — front-office (CRM, ADBE), back-office (NOW, WDAY, INTU), data platforms (SNOW, MDB, ESTC), dev tools (TEAM, GTLB, FROG), e-commerce (SHOP), comms (ZM, TWLO, DOCU). Subscription revenue, high gross margins, operating leverage. Modest dividends if any; growth and buybacks dominate." },
  { id: 'insurance',     color: '#d97706', info: "Insurance — auto/home (PGR), commercial P&C (TRV, CB, HIG, AIG, CINF), life and retirement (MET, PRU), brokers (MMC, AJG, WTW), holding companies (L). P&C is cyclical with catastrophes and underwriting cycles; life insurers are sensitive to interest rates. Mostly steady dividend payers; brokers grow earnings without taking insurance risk." },
  { id: 'healthcare',    color: '#16a34a', info: "Healthcare services — managed-care insurers (UNH, CVS, CI, HUM, ELV, CNC, MOH), hospitals (HCA), specialty services (DVA, ISRG, IDXX, DXCM). Mostly large, defensive, and steady — but exposed to regulatory changes (Medicare rates, ACA reform). Distinct from pharma drug makers." },
  { id: 'staples',       color: '#c2410c', info: "Consumer staples — household (PG, CL, KMB, CHD, CLX), beverages (PEP, KO, STZ, TAP), packaged food (GIS, K, KHC, CPB). Defensive, low-growth, very reliable dividends. Bond-proxy behavior: prices fall when rates rise. Many are dividend aristocrats." },
  { id: 'travel',        color: '#0d9488', info: "Travel & leisure — online travel (ABNB, BKNG, EXPE), airlines (DAL, UAL, AAL, LUV, ALK, JBLU), cruises (CCL, RCL, NCLH), casinos (MGM, WYNN, LVS, CZR, PENN), sportsbooks (DKNG). Highly cyclical with consumer spending; airlines and cruises got destroyed in 2020 and have recovered unevenly. Dividends scarce." },
  { id: 'industrial',    color: '#475569', info: "Diversified industrials — Honeywell (HON), 3M (MMM), Eaton (ETN), Emerson (EMR), Parker Hannifin (PH), Cummins (CMI), United Rentals (URI), PACCAR (PCAR). Cyclical with manufacturing PMI and capex cycles. Steady mid-yield dividends; some are aristocrats. Distinct from defense, aerospace, and materials." },
  { id: 'logistics',     color: '#9a3412', info: "Logistics & freight rail — parcel and ground (UPS, FDX), trucking (KNX, JBHT, ODFL, XPO), brokers (CHRW), Class I rail (UNP, CSX, NSC, CNI, CP). Cyclical with industrial production and consumer e-commerce volumes. Rails pay reliable dividends; truckers are more volatile." },
  { id: 'materials',     color: '#78350f', info: "Materials & metals — gold (NEM), copper (FCX), industrial gases (LIN, APD), paints (SHW, PPG), aggregates (VMC, MLM), steel (NUE, STLD, CLF, X), aluminum (AA). Cyclical with global construction, autos, infrastructure spending, and commodity cycles. Mixed dividends." },
  { id: 'quantum',       color: '#86198f', info: "Quantum computing — IonQ (trapped ion), Rigetti (superconducting), D-Wave (annealing), Quantum Computing Inc (photonic). All speculative pre-revenue or early-revenue plays; valuations driven by milestone announcements rather than financials. No dividends. Treat as venture-style equity exposure." },
  { id: 'space',         color: '#4338ca', info: "Space — small launch (RKLB), direct-to-cell satellite (ASTS), lunar landers (LUNR), Earth observation (PL, BKSY), space tourism (SPCE), in-space transport (MNTS). Mostly pre-revenue or early-revenue; SPAC-era valuations have compressed sharply. Highly speculative." },
  { id: 'biotech',       color: '#047857', info: "Genomic biotech — gene editing (CRSP, NTLA, BEAM, EDIT), synthetic biology (DNA), DNA sequencing (ILMN, PACB). Different from big pharma: most are pre-profit, high-binary outcomes (FDA decisions, clinical readouts). No dividends. Casgevy (CRSP) approval validated the platform but commercial uptake is slow." },
  { id: 'Other',         color: '#5c5280' },
];

// Display order in the Filters tab. Excludes 'crypto' (own tab) and 'Other'.
// `ETF` is intentionally omitted — the Filters tab lives under the
// Stocks view, and ETFs have their own top-level toggle + per-theme
// tabs already. Keeping ETF in the chip list duplicated that
// surface and confused the "drill into individual companies" intent
// of the Filters tab. The `ETF` chip definition itself stays in CHIPS
// because chipForPosition / Holdings still use it to color-bucket ETF
// positions in the user's portfolio.
const FILTER_CHIP_ORDER = [
  'aerospace', 'AI', 'auto', 'bank', 'BDC', 'biotech',
  'chemicals', 'china', 'cybersecurity', 'defense', 'energy', 'entertainment',
  'EV', 'farming', 'fintech', 'food', 'fund', 'healthcare', 'hotel',
  'industrial', 'insurance', 'Local', 'logistics', 'materials', 'mining',
  'monthly', 'pharma', 'quantum', 'REIT', 'REIT-Like', 'retail', 'semis',
  'shipping', 'software', 'space', 'staples', 'tech', 'telecom', 'tobacco',
  'travel', 'utility',
];

// Derived from CHIPS — for legacy call sites.
const CHIP_COLORS: Record<string, string> = Object.fromEntries(
  CHIPS.map((c) => [c.id, c.color])
);
const CHIP_PRIORITY: string[] = CHIPS.filter((c) => c.id !== 'Other').map((c) => c.id);
const FILTER_SUBCHIPS: Record<string, string[]> = Object.fromEntries(
  CHIPS.filter((c) => c.subs?.length).map((c) => [c.id.toLowerCase(), c.subs!])
);
const CHIP_INFO: Record<string, string> = Object.fromEntries(
  CHIPS.filter((c) => c.info).map((c) => [c.id.toLowerCase(), c.info!])
);

const STOCK_SCREENER: ScreenerCategory[] = [
  {
    id: 'index-etfs',
    label: 'Index',
    benchmark: 'SPY',
    view: 'etfs',
    description: 'Track a broad market index — like the S&P 500, Nasdaq-100, or total US market. One purchase gives you exposure to hundreds of companies at once. Cheapest fees in the entire ETF universe (often 0.03–0.10%) and the typical "core holding" most long-term portfolios are built around.',
    stocks: [
      // S&P 500
      { symbol: 'SPY',  name: 'SPDR S&P 500 ETF',           note: 'ETF tracking the S&P 500 index.' },
      { symbol: 'IVV',  name: 'iShares Core S&P 500 ETF',   note: 'ETF — S&P 500, BlackRock low-cost mirror of SPY.' },
      { symbol: 'VOO',  name: 'Vanguard S&P 500 ETF',       note: 'ETF — S&P 500, lower expense ratio than SPY.' },
      { symbol: 'SPLG', name: 'SPDR Portfolio S&P 500',     note: 'ETF — low-cost S&P 500 from SSGA.' },
      { symbol: 'RSP',  name: 'Invesco S&P 500 Equal Weight', note: 'ETF — S&P 500, every stock weighted equally.' },
      // Nasdaq
      { symbol: 'QQQ',  name: 'Invesco QQQ',                note: 'ETF tracking the Nasdaq-100 index.' },
      { symbol: 'QQQM', name: 'Invesco Nasdaq-100 ETF',     note: 'ETF — Nasdaq-100, lower-cost long-term version of QQQ.' },
      { symbol: 'ONEQ', name: 'Fidelity Nasdaq Composite',  note: 'ETF tracking the full Nasdaq Composite (~3,000 names).' },
      // Russell — total US market by size
      { symbol: 'IWM',  name: 'iShares Russell 2000',       note: 'ETF tracking small-cap US stocks.' },
      { symbol: 'IWB',  name: 'iShares Russell 1000',       note: 'ETF — large-cap US stocks (Russell 1000).' },
      { symbol: 'IWV',  name: 'iShares Russell 3000',       note: 'ETF — broad US equity (Russell 3000).' },
      { symbol: 'IWR',  name: 'iShares Russell Mid-Cap',    note: 'ETF — Russell Midcap, 800 mid-size US companies.' },
      // Total US market
      { symbol: 'VTI',  name: 'Vanguard Total Stock Market', note: 'ETF — entire US stock market.' },
      { symbol: 'ITOT', name: 'iShares Core S&P Total US',  note: 'ETF — total US equity market.' },
      { symbol: 'SCHB', name: 'Schwab US Broad Market',     note: 'ETF — total US market, Schwab low-cost flavor.' },
      // Dow + mid/small caps
      { symbol: 'DIA',  name: 'SPDR Dow Jones Industrial',  note: 'ETF tracking the Dow 30.' },
      { symbol: 'MDY',  name: 'SPDR S&P MidCap 400',        note: 'ETF — mid-cap US stocks.' },
      { symbol: 'IJH',  name: 'iShares Core S&P Mid-Cap',   note: 'ETF — S&P MidCap 400, BlackRock low-cost flavor.' },
      { symbol: 'IJR',  name: 'iShares Core S&P Small-Cap', note: 'ETF — S&P SmallCap 600, profitable small caps.' },
      { symbol: 'VB',   name: 'Vanguard Small-Cap',         note: 'ETF — broad US small-cap exposure.' },
      // Style tilts — value vs growth flavors of the same index
      { symbol: 'VTV',  name: 'Vanguard Value',             note: 'ETF — large-cap US value, slower-growing but cheaper-priced names.' },
      { symbol: 'VUG',  name: 'Vanguard Growth',            note: 'ETF — large-cap US growth, faster-growing tech-heavy names.' },
      { symbol: 'IWD',  name: 'iShares Russell 1000 Value', note: 'ETF — Russell 1000 value tilt, BlackRock flavor.' },
      { symbol: 'IWF',  name: 'iShares Russell 1000 Growth', note: 'ETF — Russell 1000 growth tilt, BlackRock flavor.' },
      { symbol: 'MGK',  name: 'Vanguard Mega-Cap Growth',   note: 'ETF — top ~75 largest US growth companies.' },
      { symbol: 'MGV',  name: 'Vanguard Mega-Cap Value',    note: 'ETF — top ~75 largest US value companies.' },
      // Schwab low-cost size buckets
      { symbol: 'SCHX', name: 'Schwab US Large-Cap',        note: 'ETF — Dow Jones US Large-Cap Total Market.' },
      { symbol: 'SCHA', name: 'Schwab US Small-Cap',        note: 'ETF — Dow Jones US Small-Cap, Schwab low-cost.' },
      { symbol: 'SCHM', name: 'Schwab US Mid-Cap',          note: 'ETF — Dow Jones US Mid-Cap, Schwab low-cost.' },
      { symbol: 'SCHF', name: 'Schwab International Equity', note: 'ETF — developed-market intl, Schwab low-cost.' },
      // Total-world / international diversifiers
      { symbol: 'VT',   name: 'Vanguard Total World Stock', note: 'ETF — every investable stock globally (US + intl).' },
      { symbol: 'VXUS', name: 'Vanguard Total Intl Stock',  note: 'ETF — total ex-US equity (developed + emerging).' },
      { symbol: 'IXUS', name: 'iShares Core MSCI Total Intl', note: 'ETF — total ex-US equity, BlackRock flavor.' },
      { symbol: 'ACWI', name: 'iShares MSCI All Country World', note: 'ETF — global equity, US + developed + emerging.' },
      { symbol: 'VEA',  name: 'Vanguard FTSE Developed Mkts', note: 'ETF — developed-market equity outside the US.' },
      { symbol: 'EFA',  name: 'iShares MSCI EAFE',          note: 'ETF — large/mid developed markets ex-US/Canada.' },
      { symbol: 'IEFA', name: 'iShares Core MSCI EAFE',     note: 'ETF — MSCI EAFE, low-cost iShares Core flavor.' },
      { symbol: 'VWO',  name: 'Vanguard FTSE Emerging Mkts', note: 'ETF — emerging-market equity (China, India, Brazil, etc.).' },
      { symbol: 'IEMG', name: 'iShares Core MSCI Emerging Mkts', note: 'ETF — emerging markets, iShares Core low-cost.' },
      { symbol: 'EEM',  name: 'iShares MSCI Emerging Mkts', note: 'ETF — original emerging-markets ETF, higher fee.' },
    ],
  },
  {
    id: 'dividend-etfs',
    label: 'Dividend',
    benchmark: 'SCHD',
    view: 'etfs',
    description: 'Built to pay you cash income on a schedule — quarterly for most, monthly for the covered-call funds. Two flavors here: "buy quality dividend payers" baskets (SCHD, VYM, VIG, NOBL) with 2–4% yields and steady price growth, and covered-call income ETFs (JEPI, JEPQ, QYLD) that sell options to generate 7–12% yields but cap your upside in bull markets.',
    stocks: [
      { symbol: 'SCHD', name: 'Schwab US Dividend Equity',     note: 'ETF — high-quality US dividend payers (low fee).' },
      { symbol: 'VYM',  name: 'Vanguard High Dividend Yield',  note: 'ETF — broad basket of high-yielding US dividend stocks.' },
      { symbol: 'VIG',  name: 'Vanguard Dividend Appreciation',note: 'ETF — companies with rising dividend histories.' },
      { symbol: 'DGRO', name: 'iShares Core Dividend Growth',  note: 'ETF — dividend-growth stocks (5+ year history).' },
      { symbol: 'NOBL', name: 'ProShares S&P 500 Dividend Aristocrats', note: 'ETF — S&P 500 stocks with 25+ years of dividend hikes.' },
      { symbol: 'HDV',  name: 'iShares Core High Dividend',    note: 'ETF — quality screen on high-yield US stocks.' },
      { symbol: 'SPHD', name: 'Invesco S&P 500 High Div Low Vol', note: 'ETF — high-yield, low-volatility S&P 500 names.' },
      { symbol: 'DVY',  name: 'iShares Select Dividend',       note: 'ETF — high-yield US dividend payers.' },
      { symbol: 'JEPI', name: 'JPMorgan Equity Premium Income',note: 'ETF — covered-call income, monthly distributions.' },
      { symbol: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium',note: 'ETF — covered-call income on Nasdaq-100, monthly.' },
      { symbol: 'DIVO', name: 'Amplify CWP Enhanced Dividend Income', note: 'ETF — dividend stocks + covered-call overlay.' },
      { symbol: 'QYLD', name: 'Global X Nasdaq 100 Covered Call', note: 'ETF — covered calls on Nasdaq-100, monthly distributions.' },
      { symbol: 'XYLD', name: 'Global X S&P 500 Covered Call', note: 'ETF — covered calls on S&P 500, monthly distributions.' },
      { symbol: 'RYLD', name: 'Global X Russell 2000 Covered Call', note: 'ETF — covered calls on small caps, monthly.' },
      // Single-stock covered-call income ETFs (YieldMax family). Very high
      // headline yields (often 30–80%+ on a trailing basis) sourced from
      // selling options on the underlying; principal can drift with the
      // underlying's price. Monthly distributions.
      { symbol: 'NVDY', name: 'YieldMax NVDA Option Income',     note: 'ETF — covered-call income on NVDA, monthly distributions.' },
      { symbol: 'TSLY', name: 'YieldMax TSLA Option Income',     note: 'ETF — covered-call income on TSLA, monthly distributions.' },
      { symbol: 'MSTY', name: 'YieldMax MSTR Option Income',     note: 'ETF — covered-call income on MSTR, monthly distributions.' },
      { symbol: 'CONY', name: 'YieldMax COIN Option Income',     note: 'ETF — covered-call income on COIN, monthly distributions.' },
      { symbol: 'AMZY', name: 'YieldMax AMZN Option Income',     note: 'ETF — covered-call income on AMZN, monthly distributions.' },
      { symbol: 'APLY', name: 'YieldMax AAPL Option Income',     note: 'ETF — covered-call income on AAPL, monthly distributions.' },
      { symbol: 'GOOY', name: 'YieldMax GOOGL Option Income',    note: 'ETF — covered-call income on GOOGL, monthly distributions.' },
      { symbol: 'NFLY', name: 'YieldMax NFLX Option Income',     note: 'ETF — covered-call income on NFLX, monthly distributions.' },
      { symbol: 'YMAX', name: 'YieldMax Universe Fund of Option Income', note: 'ETF — fund-of-funds across the YieldMax single-stock income lineup.' },
      { symbol: 'SPYD', name: 'SPDR S&P 500 High Dividend',    note: 'ETF — top-yielding S&P 500 stocks.' },
      // Sub-$20 dividend / income funds — preferred shares and CEF wrappers.
      { symbol: 'YYY',  name: 'Amplify High Income',           note: 'ETF — basket of closed-end funds, monthly distributions.' },
      { symbol: 'PGX',  name: 'Invesco Preferred',             note: 'ETF — investment-grade US preferred stocks.' },
      { symbol: 'PFXF', name: 'VanEck Preferred ex Financials',note: 'ETF — preferred shares outside the financial sector.' },
    ],
  },
  {
    id: 'sector-etfs',
    label: 'Sector',
    benchmark: 'SPY',
    view: 'etfs',
    description: 'Slices the S&P 500 into individual industries — tech (XLK), healthcare (XLV), financials (XLF), energy (XLE), and so on. Use these to overweight a sector you\'re bullish on, or to gain industry exposure without picking individual stocks. Sector funds move more violently than the broad market because they\'re less diversified.',
    stocks: [
      { symbol: 'XLK', name: 'Tech Select Sector SPDR',       note: 'ETF — S&P 500 tech sector.' },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR',note: 'ETF — S&P 500 healthcare.' },
      { symbol: 'XLF', name: 'Financial Select Sector SPDR',  note: 'ETF — S&P 500 financials.' },
      { symbol: 'XLE', name: 'Energy Select Sector SPDR',     note: 'ETF — S&P 500 energy.' },
      { symbol: 'XLI', name: 'Industrial Select Sector SPDR', note: 'ETF — S&P 500 industrials.' },
      { symbol: 'XLY', name: 'Consumer Discretionary SPDR',   note: 'ETF — S&P 500 consumer discretionary.' },
      { symbol: 'XLP', name: 'Consumer Staples SPDR',         note: 'ETF — S&P 500 consumer staples.' },
      { symbol: 'XLU', name: 'Utilities Select Sector SPDR',  note: 'ETF — S&P 500 utilities.' },
      { symbol: 'XLB', name: 'Materials Select Sector SPDR',  note: 'ETF — S&P 500 materials.' },
      { symbol: 'XLRE',name: 'Real Estate Select Sector SPDR',note: 'ETF — S&P 500 real estate.' },
      { symbol: 'XLC', name: 'Communication Services SPDR',   note: 'ETF — S&P 500 communications.' },
      { symbol: 'SOXX',name: 'iShares Semiconductor ETF',     note: 'ETF — US semiconductor stocks.' },
      { symbol: 'SMH', name: 'VanEck Semiconductor',          note: 'ETF — top semiconductor stocks.' },
      { symbol: 'IGV', name: 'iShares Expanded Tech-Software',note: 'ETF — software companies.' },
      { symbol: 'IBB', name: 'iShares Biotechnology',         note: 'ETF — US biotech.' },
      { symbol: 'KRE', name: 'SPDR S&P Regional Banking',     note: 'ETF — US regional banks.' },
      { symbol: 'KBE', name: 'SPDR S&P Bank',                 note: 'ETF — broader US banks.' },
      { symbol: 'ITA', name: 'iShares US Aerospace & Defense',note: 'ETF — defense and aerospace.' },
      { symbol: 'XAR', name: 'SPDR S&P Aerospace & Defense',  note: 'ETF — equal-weighted aerospace & defense.' },
    ],
  },
  {
    id: 'bond-etfs',
    label: 'Bonds',
    benchmark: 'AGG',
    view: 'etfs',
    description: 'Loans to governments and corporations that pay regular interest. Bonds typically move opposite to stocks, so they\'re used as ballast in a portfolio. Short-duration funds (BIL, SGOV, SHY) are nearly cash-like and pay current Treasury yields. Long-duration (TLT) is more volatile but pays more. High-yield (HYG, JNK) takes credit risk for higher income — these act more like stocks during a recession.',
    stocks: [
      { symbol: 'AGG', name: 'iShares Core US Aggregate Bond',note: 'ETF — broad US investment-grade bonds.' },
      { symbol: 'BND', name: 'Vanguard Total Bond Market',    note: 'ETF — broad US investment-grade bonds, low fee.' },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury',     note: 'ETF — long-duration US Treasuries.' },
      { symbol: 'IEF', name: 'iShares 7-10 Year Treasury',    note: 'ETF — intermediate US Treasuries.' },
      { symbol: 'SHY', name: 'iShares 1-3 Year Treasury',     note: 'ETF — short-duration US Treasuries.' },
      { symbol: 'BIL', name: 'SPDR Bloomberg 1-3 Month T-Bill', note: 'ETF — T-bills, very short duration.' },
      { symbol: 'SGOV',name: 'iShares 0-3 Month Treasury',    note: 'ETF — ultra-short T-bills, cash-like.' },
      { symbol: 'TIP', name: 'iShares TIPS Bond',             note: 'ETF — inflation-protected Treasuries.' },
      { symbol: 'LQD', name: 'iShares iBoxx Inv Grade Corp',  note: 'ETF — investment-grade corporate bonds.' },
      { symbol: 'HYG', name: 'iShares iBoxx High Yield Corp', note: 'ETF — high-yield (junk) corporate bonds.' },
      { symbol: 'JNK', name: 'SPDR Bloomberg High Yield Bond',note: 'ETF — high-yield corporate bonds.' },
      { symbol: 'MUB', name: 'iShares National Muni Bond',    note: 'ETF — US municipal bonds (tax-advantaged).' },
      { symbol: 'EMB', name: 'iShares JPMorgan EM Bond',      note: 'ETF — emerging-market sovereign bonds.' },
      { symbol: 'BNDX',name: 'Vanguard Total Intl Bond',      note: 'ETF — international bonds, USD-hedged.' },
    ],
  },
  {
    id: 'international-etfs',
    label: 'International',
    benchmark: 'VEA',
    view: 'etfs',
    description: 'Exposure to stocks outside the United States. Developed-markets funds (VEA, EFA, IEFA) cover Europe, Japan, UK, Canada — slower growth but lower valuations than US stocks. Emerging-markets funds (VWO, EEM) hit China, India, Brazil, Korea — higher growth potential, higher volatility. Single-country ETFs (FXI for China, INDA for India) let you make targeted bets but carry concentrated political and currency risk.',
    stocks: [
      { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets',note: 'ETF — developed markets ex-US.' },
      { symbol: 'EFA', name: 'iShares MSCI EAFE',             note: 'ETF — Europe, Australasia, Far East.' },
      { symbol: 'IEFA',name: 'iShares Core MSCI EAFE',        note: 'ETF — broad developed markets ex-US, low fee.' },
      { symbol: 'VWO', name: 'Vanguard FTSE Emerging Markets',note: 'ETF — emerging markets equities.' },
      { symbol: 'EEM', name: 'iShares MSCI Emerging Markets', note: 'ETF — broad emerging markets.' },
      { symbol: 'IEMG',name: 'iShares Core MSCI Emerging',    note: 'ETF — broad emerging markets, low fee.' },
      { symbol: 'VXUS',name: 'Vanguard Total Intl Stock',     note: 'ETF — total international equity.' },
      { symbol: 'ACWI',name: 'iShares MSCI ACWI',             note: 'ETF — global equity (US + international).' },
      { symbol: 'FXI', name: 'iShares China Large-Cap',       note: 'ETF — large-cap Chinese stocks.' },
      { symbol: 'MCHI',name: 'iShares MSCI China',            note: 'ETF — broader China equity exposure.' },
      { symbol: 'KWEB',name: 'KraneShares CSI China Internet',note: 'ETF — Chinese internet companies.' },
      { symbol: 'EWJ', name: 'iShares MSCI Japan',            note: 'ETF — Japanese equities.' },
      { symbol: 'INDA',name: 'iShares MSCI India',            note: 'ETF — Indian equities.' },
      { symbol: 'EWZ', name: 'iShares MSCI Brazil',           note: 'ETF — Brazilian equities.' },
      { symbol: 'EWY', name: 'iShares MSCI South Korea',      note: 'ETF — Korean equities.' },
      { symbol: 'EWT', name: 'iShares MSCI Taiwan',           note: 'ETF — Taiwanese equities (TSMC-heavy).' },
      { symbol: 'EWG', name: 'iShares MSCI Germany',          note: 'ETF — German equities.' },
      { symbol: 'EWU', name: 'iShares MSCI United Kingdom',   note: 'ETF — UK equities.' },
      { symbol: 'EWC', name: 'iShares MSCI Canada',           note: 'ETF — Canadian equities.' },
      // Sub-$20 single-country and small-cap regional ETFs.
      { symbol: 'EWH', name: 'iShares MSCI Hong Kong',        note: 'ETF — Hong Kong equities.' },
      { symbol: 'EWZS',name: 'iShares MSCI Brazil Small-Cap', note: 'ETF — Brazilian small-cap equities.' },
      { symbol: 'VNM', name: 'VanEck Vietnam',                note: 'ETF — Vietnamese equities.' },
      { symbol: 'PAK', name: 'Global X MSCI Pakistan',        note: 'ETF — Pakistani equities (frontier market).' },
      { symbol: 'NORW',name: 'Global X MSCI Norway',          note: 'ETF — Norwegian equities (energy-heavy).' },
      { symbol: 'PGAL',name: 'Global X MSCI Portugal',        note: 'ETF — Portuguese equities.' },
      { symbol: 'EWO', name: 'iShares MSCI Austria',          note: 'ETF — Austrian equities.' },
      { symbol: 'EWK', name: 'iShares MSCI Belgium',          note: 'ETF — Belgian equities.' },
      { symbol: 'EIDO',name: 'iShares MSCI Indonesia',        note: 'ETF — Indonesian equities.' },
    ],
  },
  {
    id: 'commodity-etfs',
    label: 'Commodities',
    benchmark: 'GLD',
    view: 'etfs',
    description: 'Physical assets — gold, silver, oil, natural gas, copper, uranium. Used as inflation hedges and to diversify away from stocks. "Physical" funds (GLD, SLV, IAU) actually hold the metal in vaults; "futures-based" funds (USO, UNG, DBC) hold contracts and can drift from the spot price over time due to roll costs. Mining-stock ETFs (GDX, SIL) hold company shares instead and behave more like equities with leverage to the underlying metal.',
    stocks: [
      { symbol: 'GLD', name: 'SPDR Gold Shares',              note: 'ETF — physical gold.' },
      { symbol: 'IAU', name: 'iShares Gold Trust',            note: 'ETF — physical gold, lower fee than GLD.' },
      { symbol: 'GLDM',name: 'SPDR Gold MiniShares',          note: 'ETF — physical gold, lowest fee in family.' },
      { symbol: 'SLV', name: 'iShares Silver Trust',          note: 'ETF — physical silver.' },
      { symbol: 'SIVR',name: 'abrdn Physical Silver Shares',  note: 'ETF — physical silver, lower fee than SLV.' },
      { symbol: 'PPLT',name: 'abrdn Physical Platinum',       note: 'ETF — physical platinum.' },
      { symbol: 'PALL',name: 'abrdn Physical Palladium',      note: 'ETF — physical palladium.' },
      { symbol: 'GDX', name: 'VanEck Gold Miners',            note: 'ETF — gold mining stocks.' },
      { symbol: 'GDXJ',name: 'VanEck Junior Gold Miners',     note: 'ETF — small/mid-cap gold miners.' },
      { symbol: 'SIL', name: 'Global X Silver Miners',        note: 'ETF — silver mining stocks.' },
      { symbol: 'USO', name: 'United States Oil Fund',        note: 'ETF — WTI crude oil futures.' },
      { symbol: 'UNG', name: 'United States Natural Gas',     note: 'ETF — natural gas futures.' },
      { symbol: 'DBC', name: 'Invesco DB Commodity Index',    note: 'ETF — broad commodity basket.' },
      { symbol: 'PDBC',name: 'Invesco Optimum Yield Commodity', note: 'ETF — broad commodity basket, no K-1.' },
      { symbol: 'CPER',name: 'United States Copper Index',    note: 'ETF — copper futures.' },
      { symbol: 'URA', name: 'Global X Uranium',              note: 'ETF — uranium miners.' },
      // Sub-$20 physical-metal and ag-futures funds.
      { symbol: 'PSLV',name: 'Sprott Physical Silver Trust',  note: 'ETF — physical silver (Sprott-vaulted, redeemable).' },
      { symbol: 'SILJ',name: 'Amplify Junior Silver Miners',  note: 'ETF — junior silver-mining companies.' },
      { symbol: 'WEAT',name: 'Teucrium Wheat Fund',           note: 'ETF — wheat futures (no K-1).' },
      { symbol: 'CANE',name: 'Teucrium Sugar Fund',           note: 'ETF — sugar futures.' },
      { symbol: 'SOYB',name: 'Teucrium Soybean Fund',         note: 'ETF — soybean futures.' },
    ],
  },
  {
    id: 'crypto-etfs',
    label: 'Crypto',
    benchmark: 'IBIT',
    view: 'etfs',
    description: 'Spot Bitcoin and Ether ETFs that hold actual coins in custody — approved by the SEC in 2024. The price tracks BTC or ETH directly, but you buy/sell through a regular brokerage with no wallet, no private keys, no exchange account. Fees range from 0.20% (IBIT, FBTC) to 1.50% (GBTC). This is the simplest way to get crypto exposure inside a tax-advantaged account like an IRA.',
    stocks: [
      { symbol: 'IBIT',name: 'iShares Bitcoin Trust',         note: 'ETF — spot Bitcoin (BlackRock, lowest fees).' },
      { symbol: 'FBTC',name: 'Fidelity Wise Origin Bitcoin',  note: 'ETF — spot Bitcoin (Fidelity).' },
      { symbol: 'BITB',name: 'Bitwise Bitcoin ETF',           note: 'ETF — spot Bitcoin (Bitwise).' },
      { symbol: 'ARKB',name: 'ARK 21Shares Bitcoin',          note: 'ETF — spot Bitcoin (ARK + 21Shares).' },
      { symbol: 'GBTC',name: 'Grayscale Bitcoin Trust',       note: 'ETF — spot Bitcoin (Grayscale, higher fee, larger AUM).' },
      { symbol: 'BTCO',name: 'Invesco Galaxy Bitcoin ETF',    note: 'ETF — spot Bitcoin (Invesco/Galaxy).' },
      { symbol: 'HODL',name: 'VanEck Bitcoin Trust',          note: 'ETF — spot Bitcoin (VanEck).' },
      { symbol: 'EZBC',name: 'Franklin Bitcoin ETF',          note: 'ETF — spot Bitcoin (Franklin Templeton).' },
      { symbol: 'BRRR',name: 'Valkyrie Bitcoin Fund',         note: 'ETF — spot Bitcoin (Valkyrie).' },
      { symbol: 'ETHA',name: 'iShares Ethereum Trust',        note: 'ETF — spot Ether (BlackRock).' },
      { symbol: 'FETH',name: 'Fidelity Ethereum Fund',        note: 'ETF — spot Ether (Fidelity).' },
      { symbol: 'ETHE',name: 'Grayscale Ethereum Trust',      note: 'ETF — spot Ether (Grayscale).' },
      { symbol: 'ETHW',name: 'Bitwise Ethereum ETF',          note: 'ETF — spot Ether (Bitwise).' },
      // Sub-$20 crypto-industry equity ETFs (not spot coin — these
      // hold miners, exchanges, and infra companies).
      { symbol: 'DAPP',name: 'VanEck Digital Transformation', note: 'ETF — crypto and blockchain companies (miners, exchanges).' },
      { symbol: 'BITQ',name: 'Bitwise Crypto Industry',       note: 'ETF — top crypto-economy companies (miners, exchanges, infra).' },
    ],
  },
  {
    id: 'thematic-etfs',
    label: 'Thematic',
    benchmark: 'QQQ',
    view: 'etfs',
    description: 'Bets on a specific trend or strategy — AI (AIQ, BOTZ), cybersecurity (HACK, CIBR), clean energy (ICLN, TAN), cloud (CLOU), genomics (ARKG), infrastructure (PAVE). Higher fees (0.40–0.95%), more concentrated, and they live or die on whether the theme plays out. Factor funds at the bottom (MOAT, QUAL, MTUM, USMV) tilt toward statistical signals — quality, momentum, low volatility — rather than a story.',
    stocks: [
      { symbol: 'ARKK',name: 'ARK Innovation ETF',            note: 'ETF — Cathie Wood disruptive innovation.' },
      { symbol: 'ARKG',name: 'ARK Genomic Revolution',        note: 'ETF — genomics and biotech innovation.' },
      { symbol: 'ARKQ',name: 'ARK Autonomous Tech & Robotics',note: 'ETF — automation and robotics.' },
      { symbol: 'ARKW',name: 'ARK Next Generation Internet',  note: 'ETF — cloud, blockchain, social platforms.' },
      { symbol: 'ARKF',name: 'ARK Fintech Innovation',        note: 'ETF — payments, blockchain, neobanks.' },
      { symbol: 'ICLN',name: 'iShares Global Clean Energy',   note: 'ETF — global clean-energy stocks.' },
      { symbol: 'TAN', name: 'Invesco Solar',                 note: 'ETF — solar industry stocks.' },
      { symbol: 'LIT', name: 'Global X Lithium & Battery',    note: 'ETF — lithium miners and battery makers.' },
      { symbol: 'DRIV',name: 'Global X Autonomous & EV',      note: 'ETF — EV and autonomous-vehicle exposure.' },
      { symbol: 'BOTZ',name: 'Global X Robotics & AI',        note: 'ETF — robotics and AI companies.' },
      { symbol: 'AIQ', name: 'Global X Artificial Intelligence',note: 'ETF — AI and big-data names.' },
      { symbol: 'CLOU',name: 'Global X Cloud Computing',      note: 'ETF — cloud-computing stocks.' },
      { symbol: 'HACK',name: 'Amplify Cybersecurity',         note: 'ETF — cybersecurity companies.' },
      { symbol: 'CIBR',name: 'First Trust Nasdaq Cybersecurity',note: 'ETF — cybersecurity companies.' },
      { symbol: 'BLOK',name: 'Amplify Transformational Data Sharing', note: 'ETF — blockchain-related companies.' },
      { symbol: 'PAVE',name: 'Global X US Infrastructure',    note: 'ETF — US infrastructure beneficiaries.' },
      { symbol: 'IBUY',name: 'Amplify Online Retail',         note: 'ETF — online retail companies.' },
      { symbol: 'JETS',name: 'US Global Jets',                note: 'ETF — global airlines.' },
      { symbol: 'MOO', name: 'VanEck Agribusiness',           note: 'ETF — agribusiness companies.' },
      { symbol: 'COWZ',name: 'Pacer US Cash Cows 100',        note: 'ETF — high free-cash-flow yield US stocks.' },
      { symbol: 'MOAT',name: 'VanEck Morningstar Wide Moat',  note: 'ETF — Morningstar wide-moat stocks.' },
      { symbol: 'QUAL',name: 'iShares MSCI USA Quality',      note: 'ETF — high-quality US stocks (ROE, leverage, earnings stability).' },
      { symbol: 'MTUM',name: 'iShares MSCI USA Momentum',     note: 'ETF — high-momentum US stocks.' },
      { symbol: 'USMV',name: 'iShares MSCI USA Min Vol',      note: 'ETF — low-volatility US stocks.' },
      // Sub-$20 thematics — clean energy, space, cannabis, infrastructure.
      { symbol: 'FAN', name: 'First Trust Global Wind Energy',note: 'ETF — global wind-energy companies.' },
      { symbol: 'ARKX',name: 'ARK Space Exploration & Innovation', note: 'ETF — orbital aerospace, satellites, suborbital.' },
      { symbol: 'MJ',  name: 'ETFMG Alternative Harvest',     note: 'ETF — global cannabis companies (Canadian + US MSOs).' },
      { symbol: 'MSOS',name: 'AdvisorShares Pure US Cannabis',note: 'ETF — pure-play US multi-state cannabis operators.' },
      { symbol: 'YOLO',name: 'AdvisorShares Pure Cannabis',   note: 'ETF — actively-managed pure-play cannabis.' },
    ],
  },
  {
    id: 'mag-7',
    label: 'Magnificent 7',
    benchmark: 'XLK',
    stocks: [
      { symbol: 'AAPL', name: 'Apple', note: 'Tech — consumer electronics and services.' },
      { symbol: 'MSFT', name: 'Microsoft', note: 'Tech — cloud, operating systems, productivity software.' },
      { symbol: 'NVDA', name: 'NVIDIA', note: 'Semis — GPUs and AI accelerators.' },
      { symbol: 'GOOGL', name: 'Alphabet', note: 'Tech — Google search, YouTube, cloud.' },
      { symbol: 'AMZN', name: 'Amazon', note: 'Tech — e-commerce and AWS cloud.' },
      { symbol: 'META', name: 'Meta', note: 'Tech — Facebook, Instagram, WhatsApp.' },
      { symbol: 'TSLA', name: 'Tesla', note: 'EV (electric vehicle) maker, energy storage, autonomy.' },
    ],
  },
  {
    id: 'dividend',
    label: 'Dividend payers',
    benchmark: 'VYM',
    stocks: [
      { symbol: 'KO',   name: 'Coca-Cola',           note: 'Beverages — dividend aristocrat, 60+ years of consecutive increases.' },
      { symbol: 'PEP',  name: 'PepsiCo',             note: 'Beverages and snacks (Pepsi, Frito-Lay), dividend aristocrat.' },
      { symbol: 'PG',   name: 'Procter & Gamble',    note: 'Consumer staples, dividend aristocrat.' },
      { symbol: 'KMB',  name: 'Kimberly-Clark',      note: 'Consumer staples (Kleenex, Huggies), aristocrat.' },
      { symbol: 'WMT',  name: 'Walmart',             note: "World's largest retailer, dividend aristocrat." },
      { symbol: 'MCD',  name: "McDonald's",          note: 'Global fast food, dividend aristocrat.' },
      { symbol: 'HD',   name: 'Home Depot',          note: 'Home-improvement retail, growing dividend.' },
      { symbol: 'LOW',  name: "Lowe's",              note: "Home-improvement retail, dividend aristocrat (50+ years)." },
      { symbol: 'JNJ',  name: 'Johnson & Johnson',   note: 'Healthcare conglomerate, dividend aristocrat (60+ years).' },
      { symbol: 'PFE',  name: 'Pfizer',              note: 'Pharma, high dividend yield.' },
      { symbol: 'ABBV', name: 'AbbVie',              note: 'Pharma (Humira), high yield.' },
      { symbol: 'XOM',  name: 'ExxonMobil',          note: 'Energy — US oil major, long dividend history.' },
      { symbol: 'CVX',  name: 'Chevron',             note: 'Energy — US oil major, dividend aristocrat.' },
      { symbol: 'CAT',  name: 'Caterpillar',         note: 'Construction and mining equipment, aristocrat.' },
      { symbol: 'MO',   name: 'Altria',              note: 'Tobacco — very high dividend yield.' },
      { symbol: 'VZ',   name: 'Verizon',             note: 'Telecom, high dividend yield.' },
      { symbol: 'T',    name: 'AT&T',                note: 'Telecom, dividend payer.' },
      { symbol: 'IBM',  name: 'IBM',                 note: 'Tech — consulting and cloud, high yield.' },
      { symbol: 'SO',   name: 'Southern Company',    note: 'Utility — US electric utility, reliable dividend payer.' },
      { symbol: 'O',    name: 'Realty Income',       note: 'REIT — pays monthly dividends ("The Monthly Dividend Company").' },
      // Additional Dividend Kings (50+ consecutive years of increases):
      { symbol: 'DOV',  name: 'Dover Corporation',     note: 'Industrial — diversified manufacturer, dividend king (68+ years).' },
      { symbol: 'EMR',  name: 'Emerson Electric',      note: 'Industrial — automation and climate, dividend king (67+ years).' },
      { symbol: 'PH',   name: 'Parker Hannifin',       note: 'Industrial — motion and control technologies, dividend king (68+ years).' },
      { symbol: 'ITW',  name: 'Illinois Tool Works',   note: 'Industrial — Glenview-based diversified manufacturer, dividend king (60+ years).' },
      { symbol: 'HRL',  name: 'Hormel Foods',          note: 'Consumer staples — Spam, Skippy, Jennie-O, dividend king (58+ years).' },
      { symbol: 'GPC',  name: 'Genuine Parts',         note: 'Auto / industrial — NAPA Auto Parts, Motion Industries, dividend king (68+ years).' },
      { symbol: 'NDSN', name: 'Nordson',               note: 'Industrial — precision dispensing equipment, dividend king (60+ years).' },
      { symbol: 'ED',   name: 'Consolidated Edison',   note: 'Utility — New York City electric and gas, dividend king (51+ years).' },
      { symbol: 'TGT',  name: 'Target',                note: 'Retail — mass-merchandise discount chain, dividend king (53+ years).' },
      { symbol: 'AWR',  name: 'American States Water', note: 'Utility — California water utility, longest streak in market (70+ years).' },
      { symbol: 'CWT',  name: 'California Water Service', note: 'Utility — California water utility, dividend king (57+ years).' },
      { symbol: 'FRT',  name: 'Federal Realty',        note: 'REIT — premium retail centers, only REIT dividend king (57+ years).' },
      { symbol: 'BKH',  name: 'Black Hills Corporation', note: 'Utility — multi-state electric and gas, dividend king (54+ years).' },
      { symbol: 'LANC', name: 'Lancaster Colony',      note: 'Consumer staples — frozen dough and dressings (Marzetti), dividend king (62+ years).' },
      { symbol: 'NFG',  name: 'National Fuel Gas',     note: 'Utility — natural gas utility and exploration, dividend king (54+ years).' },
      { symbol: 'ABM',  name: 'ABM Industries',        note: 'Industrial — facility services, dividend king (56+ years).' },
      { symbol: 'SJW',  name: 'SJW Group',             note: 'Utility — California and Connecticut water utility, dividend king (56+ years).' },
      { symbol: 'GRC',  name: 'Gorman-Rupp',           note: 'Industrial — pumps and pumping systems, dividend king (52+ years).' },
      // Additional Dividend Kings (50+ years) not yet in the tab
      { symbol: 'ABT',  name: 'Abbott Laboratories',   note: 'Healthcare — diversified medical products, dividend king (53+ years).' },
      { symbol: 'CL',   name: 'Colgate-Palmolive',     note: 'Consumer staples — toothpaste and personal care, dividend king (62+ years).' },
      { symbol: 'CINF', name: 'Cincinnati Financial',  note: 'Insurance — regional P&C insurer, dividend king (64+ years).' },
      { symbol: 'GWW',  name: 'W.W. Grainger',         note: 'Industrial — Lake Forest IL-based industrial supply distributor, dividend king (53+ years).' },
      { symbol: 'NUE',  name: 'Nucor',                 note: 'Materials — largest US steel producer, dividend king (51+ years).' },
      { symbol: 'PPG',  name: 'PPG Industries',        note: 'Materials — paints and specialty coatings, dividend king (53+ years).' },
      { symbol: 'SPGI', name: 'S&P Global',            note: 'Financial — credit ratings, indices, market intelligence, dividend king (52+ years).' },
      { symbol: 'SWK',  name: 'Stanley Black & Decker', note: 'Industrial — power tools and hardware (DeWalt, Craftsman), dividend king (56+ years).' },
      { symbol: 'SYY',  name: 'Sysco',                 note: 'Consumer staples — largest US food-service distributor, dividend king (55+ years).' },
      // Dividend Aristocrats (25-49 years) not yet in the tab
      { symbol: 'ADP',  name: 'Automatic Data Processing', note: 'Software — payroll and HR services, dividend aristocrat (49+ years).' },
      { symbol: 'AFL',  name: 'Aflac',                 note: 'Insurance — supplemental insurance (Japan + US), dividend aristocrat (42+ years).' },
      { symbol: 'AOS',  name: 'A.O. Smith',            note: 'Industrial — water heaters and treatment, dividend aristocrat (31+ years).' },
      { symbol: 'ATO',  name: 'Atmos Energy',          note: 'Utility — natural gas distribution, dividend aristocrat (41+ years).' },
      { symbol: 'BDX',  name: 'Becton Dickinson',      note: 'Healthcare — medical devices and diagnostics, dividend aristocrat (53+ years).' },
      { symbol: 'BEN',  name: 'Franklin Resources',    note: 'Financial — Franklin Templeton asset manager, dividend aristocrat (44+ years).' },
      { symbol: 'BRO',  name: 'Brown & Brown',         note: 'Insurance — insurance broker, dividend aristocrat (30+ years).' },
      { symbol: 'CAH',  name: 'Cardinal Health',       note: 'Healthcare — pharmaceutical and medical distributor, dividend aristocrat (38+ years).' },
      { symbol: 'CHRW', name: 'C.H. Robinson',         note: 'Logistics — third-party logistics broker, dividend aristocrat (26+ years).' },
      { symbol: 'CLX',  name: 'Clorox',                note: 'Consumer staples — bleach, Brita, Glad, Hidden Valley, dividend aristocrat (47+ years).' },
      { symbol: 'CTAS', name: 'Cintas',                note: 'Industrial — uniforms and facility services, dividend aristocrat (41+ years).' },
      { symbol: 'ECL',  name: 'Ecolab',                note: 'Materials — water and hygiene technologies, dividend aristocrat (33+ years).' },
      { symbol: 'ESS',  name: 'Essex Property Trust',  note: 'REIT — West Coast apartment REIT, dividend aristocrat (30+ years).' },
      { symbol: 'EXPD', name: 'Expeditors International', note: 'Logistics — global freight forwarder, dividend aristocrat (30+ years).' },
      { symbol: 'FAST', name: 'Fastenal',              note: 'Industrial — fasteners and industrial supplies, dividend aristocrat (26+ years).' },
      { symbol: 'GD',   name: 'General Dynamics',      note: 'Defense — combat vehicles and submarines, dividend aristocrat (32+ years).' },
      { symbol: 'LIN',  name: 'Linde',                 note: 'Materials — industrial gases, dividend aristocrat (31+ years).' },
      { symbol: 'MDT',  name: 'Medtronic',             note: 'Healthcare — medical devices, dividend aristocrat (47+ years).' },
      { symbol: 'MKC',  name: 'McCormick',             note: 'Consumer staples — spices and seasonings, dividend aristocrat (39+ years).' },
      { symbol: 'NEE',  name: 'NextEra Energy',        note: 'Utility — Florida Power & Light + renewables, dividend aristocrat (30+ years).' },
      { symbol: 'PNR',  name: 'Pentair',               note: 'Industrial — water-treatment products, dividend aristocrat (48+ years).' },
      { symbol: 'ROP',  name: 'Roper Technologies',    note: 'Industrial — diversified software and engineered products, dividend aristocrat (31+ years).' },
      { symbol: 'RTX',  name: 'RTX Corporation',       note: 'Defense — Raytheon, Pratt & Whitney, Collins, dividend aristocrat (31+ years).' },
      { symbol: 'SHW',  name: 'Sherwin-Williams',      note: 'Materials — paints and coatings, dividend aristocrat (47+ years).' },
      { symbol: 'SJM',  name: 'J.M. Smucker',          note: 'Consumer staples — jams, peanut butter, coffee (Folgers), dividend aristocrat (27+ years).' },
      { symbol: 'TROW', name: 'T. Rowe Price',         note: 'Financial — asset manager, dividend aristocrat (38+ years).' },
      { symbol: 'WST',  name: 'West Pharmaceutical Services', note: 'Healthcare — drug delivery components, dividend aristocrat (30+ years).' },
    ],
  },
  {
    id: 'low-price-dividend',
    label: 'Under $20 + dividend',
    benchmark: 'VYM',
    stocks: [
      // Confirmed working with Alpaca's corporate-actions data:
      { symbol: 'F',    name: 'Ford Motor',           note: 'Auto — Ford Motor (US automaker, F-150 Lightning EV).' },
      { symbol: 'AGNC', name: 'AGNC Investment',      note: 'Mortgage REIT — monthly dividends.' },
      { symbol: 'HBAN', name: 'Huntington Bancshares',note: 'Regional bank.' },
      { symbol: 'ARCC', name: 'Ares Capital',         note: 'BDC — business development company.' },
      { symbol: 'EFC',  name: 'Ellington Financial',  note: 'Mortgage REIT.' },
      { symbol: 'CIM',  name: 'Chimera Investment',   note: 'Mortgage REIT.' },
      { symbol: 'GAIN', name: 'Gladstone Investment', note: 'BDC — monthly dividends.' },
      { symbol: 'HRZN', name: 'Horizon Technology Finance', note: 'BDC — monthly dividends.' },
      { symbol: 'DX',   name: 'Dynex Capital',        note: 'Mortgage REIT — monthly dividends.' },
      { symbol: 'BGS',  name: 'B&G Foods',            note: 'Food — packaged food (Green Giant, Cream of Wheat, Ortega).' },
      { symbol: 'ABR',  name: 'Arbor Realty Trust',   note: 'Mortgage REIT.' },
      { symbol: 'LADR', name: 'Ladder Capital',       note: 'Mortgage REIT.' },
      { symbol: 'BXMT', name: 'Blackstone Mortgage Trust', note: 'Commercial mortgage REIT.' },
      { symbol: 'KREF', name: 'KKR Real Estate Finance', note: 'Commercial mortgage REIT.' },
      { symbol: 'MFA',  name: 'MFA Financial',        note: 'Mortgage REIT.' },
      { symbol: 'GBDC', name: 'Golub Capital BDC',    note: 'BDC — business development company.' },
      { symbol: 'TRIN', name: 'Trinity Capital',      note: 'BDC — monthly dividends.' },
      { symbol: 'TPVG', name: 'TriplePoint Venture Growth', note: 'Venture-debt BDC.' },
      { symbol: 'OXSQ', name: 'Oxford Square Capital',note: 'BDC — monthly dividends.' },
      { symbol: 'BCSF', name: 'Bain Capital Specialty Finance', note: 'BDC — business development company.' },
      { symbol: 'KSS',  name: "Kohl's",               note: 'Retail — department store.' },
      { symbol: 'M',    name: "Macy's",               note: 'Retail — department store.' },
      { symbol: 'DOC',  name: 'Healthpeak Properties',note: 'Healthcare REIT.' },
      { symbol: 'IRT',  name: 'Independence Realty Trust', note: 'Apartment REIT.' },
      { symbol: 'BRT',  name: 'BRT Apartments',       note: 'Apartment REIT.' },
      { symbol: 'IVR',  name: 'Invesco Mortgage Capital', note: 'Mortgage REIT.' },
      { symbol: 'EARN', name: 'Ellington Credit',     note: 'Mortgage REIT.' },
      { symbol: 'PMT',  name: 'PennyMac Mortgage Investment', note: 'Mortgage REIT.' },
      { symbol: 'ACRE', name: 'Ares Commercial Real Estate', note: 'Commercial mortgage REIT.' },
      { symbol: 'AOMR', name: 'Angel Oak Mortgage REIT', note: 'Mortgage REIT.' },
      { symbol: 'NYMT', name: 'New York Mortgage Trust', note: 'Mortgage REIT.' },
      { symbol: 'PFLT', name: 'PennantPark Floating Rate', note: 'BDC — monthly dividends.' },
      { symbol: 'PNNT', name: 'PennantPark Investment', note: 'BDC — business development company.' },
      { symbol: 'BBDC', name: 'Barings BDC',          note: 'BDC — business development company.' },
      { symbol: 'WHF',  name: 'WhiteHorse Finance',   note: 'BDC — business development company.' },
      { symbol: 'RWAY', name: 'Runway Growth Finance',note: 'Venture-debt BDC.' },
      { symbol: 'OBDC', name: 'Blue Owl Capital',     note: 'BDC — business development company.' },
      { symbol: 'CGBD', name: 'Carlyle Secured Lending', note: 'BDC — business development company.' },
      { symbol: 'BSM',  name: 'Black Stone Minerals', note: 'Energy — oil & gas royalty MLP.' },
      { symbol: 'WSR',  name: 'Whitestone REIT',      note: 'Strip-center REIT.' },
      { symbol: 'ECC',  name: 'Eagle Point Credit',   note: 'Fund — Eagle Point Credit (closed-end fund, CLO income).' },
      { symbol: 'ORC',  name: 'Orchid Island Capital',note: 'Mortgage REIT — monthly dividends.' },
      { symbol: 'PSEC', name: 'Prospect Capital',     note: 'BDC — monthly dividends.' },
      { symbol: 'LAND', name: 'Gladstone Land',       note: 'Farmland REIT — monthly dividends.' },
      { symbol: 'SACH', name: 'Sachem Capital',       note: 'Mortgage REIT.' },
      { symbol: 'TWO',  name: 'Two Harbors Investment', note: 'Mortgage REIT.' },
      { symbol: 'RC',   name: 'Ready Capital',        note: 'Commercial mortgage REIT.' },
      { symbol: 'CHMI', name: 'Cherry Hill Mortgage', note: 'Mortgage REIT — monthly dividends.' },
      { symbol: 'ARI',  name: 'Apollo Commercial Real Estate', note: 'Commercial mortgage REIT.' },
      { symbol: 'RITM', name: 'Rithm Capital',        note: 'Mortgage REIT (formerly New Residential).' },
      { symbol: 'SCM',  name: 'Stellus Capital Investment', note: 'BDC — monthly dividends.' },
      { symbol: 'CCAP', name: 'Crescent Capital BDC', note: 'BDC — business development company.' },
      { symbol: 'GLAD', name: 'Gladstone Capital',    note: 'BDC — monthly dividends.' },
      { symbol: 'CION', name: 'CION Investment Corp', note: 'BDC — business development company.' },
      { symbol: 'GOOD', name: 'Gladstone Commercial', note: 'Commercial REIT — monthly dividends.' },
      { symbol: 'UMH',  name: 'UMH Properties',       note: 'Manufactured-housing REIT.' },
      { symbol: 'APLE', name: 'Apple Hospitality REIT',note: 'Hotel REIT — monthly dividends.' },
      { symbol: 'AHH',  name: 'Armada Hoffler Properties', note: 'Mixed-use REIT.' },
      { symbol: 'DLNG', name: 'Dynagas LNG Partners', note: 'Shipping — LNG carrier MLP.' },
      { symbol: 'NAT',  name: 'Nordic American Tankers', note: 'Shipping — crude oil tanker fleet.' },
      { symbol: 'CMRE', name: 'Costamare',            note: 'Shipping — container vessels.' },
      { symbol: 'KW',   name: 'Kennedy-Wilson Holdings', note: 'REIT-Like — Kennedy-Wilson, global real estate operator (C-corp, not a REIT).' },
      // Hotel & lodging REITs:
      { symbol: 'PEB',  name: 'Pebblebrook Hotel Trust', note: 'Upscale hotel REIT.' },
      { symbol: 'DRH',  name: 'DiamondRock Hospitality',note: 'Hotel REIT.' },
      { symbol: 'SHO',  name: 'Sunstone Hotel Investors', note: 'Hotel REIT.' },
      { symbol: 'RLJ',  name: 'RLJ Lodging Trust',     note: 'Hotel REIT.' },
      { symbol: 'INN',  name: 'Summit Hotel Properties', note: 'Hotel REIT.' },
      // Healthcare REITs:
      { symbol: 'SBRA', name: 'Sabra Health Care REIT',note: 'Senior-housing & skilled-nursing REIT.' },
      { symbol: 'GMRE', name: 'Global Medical REIT',   note: 'Medical office REIT.' },
      { symbol: 'MPW',  name: 'Medical Properties Trust', note: 'Hospital-real-estate REIT.' },
      // Net-lease & diversified REITs:
      { symbol: 'BNL',  name: 'Broadstone Net Lease',  note: 'Net-lease REIT.' },
      { symbol: 'ELME', name: 'Elme Communities',      note: 'Apartment REIT.' },
      { symbol: 'PLYM', name: 'Plymouth Industrial REIT', note: 'Industrial / logistics REIT.' },
      { symbol: 'BDN',  name: 'Brandywine Realty Trust', note: 'Office REIT.' },
      { symbol: 'TCPC', name: 'BlackRock TCP Capital', note: 'BDC — business development company.' },
      { symbol: 'PSBD', name: 'Palmer Square Capital BDC', note: 'BDC — business development company.' },
      { symbol: 'PTMN', name: 'Portman Ridge Finance', note: 'BDC — business development company.' },
      { symbol: 'LRFC', name: 'Logan Ridge Finance',   note: 'BDC — business development company.' },
      { symbol: 'VFC',  name: 'V.F. Corporation',      note: 'Retail — apparel (Vans, North Face, Timberland).' },
      { symbol: 'GES',  name: 'Guess?',                note: 'Retail — apparel.' },
      { symbol: 'HUN',  name: 'Huntsman',              note: 'Chemicals — Huntsman, specialty chemicals.' },
      { symbol: 'CWH',  name: 'Camping World Holdings',note: 'RV retail.' },
      // Mining:
      { symbol: 'KGC',  name: 'Kinross Gold',          note: 'Gold mining.' },
      { symbol: 'HL',   name: 'Hecla Mining',          note: 'Silver and gold mining.' },
      { symbol: 'CDE',  name: 'Coeur Mining',          note: 'Precious-metals mining.' },
      { symbol: 'IAG',  name: 'IAMGOLD',               note: 'Gold mining.' },
      { symbol: 'BTG',  name: 'B2Gold',                note: 'Gold mining.' },
      { symbol: 'HBM',  name: 'Hudbay Minerals',       note: 'Copper, gold, silver mining.' },
      { symbol: 'SVM',  name: 'Silvercorp Metals',     note: 'Silver and gold mining.' },
      { symbol: 'CENX', name: 'Century Aluminum',      note: 'Aluminum mining and smelting.' },
      { symbol: 'AG',   name: 'First Majestic Silver', note: 'Silver mining.' },
      { symbol: 'EXK',  name: 'Endeavour Silver',      note: 'Silver mining.' },
      { symbol: 'MUX',  name: 'McEwen Mining',         note: 'Gold and silver mining.' },
      // Defense:
      { symbol: 'LMT',  name: 'Lockheed Martin',       note: 'Defense — F-35, missiles, naval systems.' },
      { symbol: 'NOC',  name: 'Northrop Grumman',      note: 'Defense — B-21 bomber, space, autonomous systems.' },
      { symbol: 'RTX',  name: 'RTX Corporation',       note: 'Defense and aerospace — Raytheon missiles, Pratt & Whitney engines, Collins avionics.' },
      { symbol: 'GD',   name: 'General Dynamics',      note: 'Defense — combat vehicles, submarines, IT services.' },
      { symbol: 'LHX',  name: 'L3Harris Technologies', note: 'Defense communications and electronics.' },
      { symbol: 'LDOS', name: 'Leidos Holdings',       note: 'Defense and government IT services.' },
      { symbol: 'HII',  name: 'Huntington Ingalls Industries', note: 'Defense — largest US military shipbuilder.' },
      { symbol: 'TXT',  name: 'Textron',               note: 'Defense and aerospace — Bell helicopters, Cessna, military vehicles.' },
      { symbol: 'KTOS', name: 'Kratos Defense',        note: 'Defense — drones, satellite communications.' },
      { symbol: 'BWXT', name: 'BWX Technologies',      note: 'Defense — naval nuclear propulsion components.' },
      // Defense IT / services / data — second-tier primes built on
      // long-cycle DoD and intelligence-community contracts.
      { symbol: 'PLTR', name: 'Palantir Technologies', note: 'Defense — Gotham (intel) and Foundry data platforms for DoD and three-letter agencies.' },
      { symbol: 'CACI', name: 'CACI International',    note: 'Defense — IT, intelligence, and electronic-warfare services.' },
      { symbol: 'SAIC', name: 'Science Applications International', note: 'Defense — engineering and integration services for DoD and federal civilian.' },
      { symbol: 'BAH',  name: 'Booz Allen Hamilton',   note: 'Defense — consulting + tech integration for defense, intel, civil.' },
      { symbol: 'PSN',  name: 'Parsons Corporation',   note: 'Defense and critical infrastructure — cyber, missile defense, smart cities.' },
      // Defense components / specialty / international.
      { symbol: 'MRCY', name: 'Mercury Systems',       note: 'Defense — mission-critical processing and RF subsystems.' },
      { symbol: 'OSK',  name: 'Oshkosh',               note: 'Defense — military tactical vehicles (JLTV, MRAP) + commercial trucks.' },
      { symbol: 'ATRO', name: 'Astronics',             note: 'Defense — aerospace and military test, lighting, power systems.' },
      { symbol: 'WWD',  name: 'Woodward',              note: 'Defense — fuel, motion-control, and energy systems for military and commercial aviation.' },
      { symbol: 'AIR',  name: 'AAR Corp',              note: 'Defense — aircraft MRO and parts supply for military fleets.' },
      { symbol: 'NPK',  name: 'National Presto Industries', note: 'Defense — ammunition (40mm, 105mm) manufacturer.' },
      { symbol: 'ESLT', name: 'Elbit Systems',         note: 'Defense — Israeli electronics, drones, and land systems (ADR).' },
      // Drones:
      { symbol: 'AVAV', name: 'AeroVironment',         note: 'Defense — Switchblade loitering munitions and military drones.' },
      { symbol: 'RCAT', name: 'Red Cat Holdings',      note: 'Defense — Teal small unmanned drones for military and government.' },
      { symbol: 'ONDS', name: 'Ondas Holdings',        note: 'Defense — drone networks (Iron Drone Raider, Optimus).' },
      { symbol: 'AXON', name: 'Axon Enterprise',       note: 'Defense — TASER, body cameras, and public-safety drones.' },
      { symbol: 'TDY',  name: 'Teledyne Technologies', note: 'Defense — drone sensors, imaging, and electronic systems.' },
      { symbol: 'UAVS', name: 'AgEagle Aerial Systems',note: 'Drones — agricultural and commercial drone systems.' },
      { symbol: 'DPRO', name: 'Draganfly',             note: 'Drones — Canadian commercial and public-safety drone maker.' },
      // Aerospace:
      { symbol: 'BA',   name: 'Boeing',                note: 'Aerospace — commercial airliners and defense aircraft.' },
      { symbol: 'GE',   name: 'GE Aerospace',          note: 'Aerospace — jet engines (commercial and military).' },
      { symbol: 'HEI',  name: 'HEICO',                 note: 'Aerospace components and replacement parts.' },
      { symbol: 'HWM',  name: 'Howmet Aerospace',      note: 'Aerospace — engine components and structural castings.' },
      { symbol: 'TDG',  name: 'TransDigm Group',       note: 'Aerospace — proprietary aircraft components.' },
      { symbol: 'HXL',  name: 'Hexcel',                note: 'Aerospace — carbon-fiber composite materials.' },
      { symbol: 'CW',   name: 'Curtiss-Wright',        note: 'Aerospace and defense engineering components.' },
      { symbol: 'ERJ',  name: 'Embraer',               note: 'Aerospace — regional jets and military aircraft.' },
      // Under-$20 aerospace — emerging-segment names (eVTOL, satellite,
      // small launch, components). Higher beta; many pre-revenue or
      // early-revenue, with valuations driven by milestone news rather
      // than financials. Speculative compared to BA / GE / HEI above.
      { symbol: 'JOBY', name: 'Joby Aviation',        note: 'Aerospace — eVTOL air taxis (FAA certification in progress).' },
      { symbol: 'ACHR', name: 'Archer Aviation',      note: 'Aerospace — eVTOL air taxis (Midnight aircraft).' },
      { symbol: 'EH',   name: 'EHang Holdings',       note: 'Aerospace — autonomous flying vehicles, China (ADR).' },
      { symbol: 'BLDE', name: 'Blade Air Mobility',   note: 'Aerospace — urban helicopter and short-haul air transit.' },
      { symbol: 'VSAT', name: 'Viasat',               note: 'Aerospace — satellite broadband for in-flight and government.' },
      { symbol: 'RDW',  name: 'Redwire',              note: 'Aerospace — in-space manufacturing and infrastructure.' },
      { symbol: 'SPIR', name: 'Spire Global',         note: 'Aerospace — radio-frequency satellites + space-data subscriptions.' },
      { symbol: 'TGI',  name: 'Triumph Group',        note: 'Aerospace — aircraft components and systems (commercial and defense).' },
      { symbol: 'MNTS', name: 'Momentus',             note: 'Aerospace — in-space transport (last-mile orbital delivery).' },
      { symbol: 'BKSY', name: 'BlackSky Technology',  note: 'Aerospace — real-time satellite imagery for governments.' },
      // Telecom:
      { symbol: 'TMUS', name: 'T-Mobile US',           note: 'Telecom — wireless carrier.' },
      { symbol: 'LUMN', name: 'Lumen Technologies',    note: 'Telecom — fiber and enterprise networking.' },
      { symbol: 'CCOI', name: 'Cogent Communications', note: 'Telecom — internet service provider.' },
      { symbol: 'ATUS', name: 'Altice USA',            note: 'Telecom — cable and broadband.' },
      { symbol: 'USM',  name: 'United States Cellular',note: 'Telecom — regional wireless carrier.' },
      { symbol: 'IRDM', name: 'Iridium Communications',note: 'Telecom — satellite communications.' },
      { symbol: 'AMX',  name: 'America Movil',         note: 'Telecom — Latin-American wireless ADR.' },
      { symbol: 'BCE',  name: 'BCE Inc',               note: 'Telecom — Canadian wireless carrier.' },
      // Hotel:
      { symbol: 'HLT',  name: 'Hilton Worldwide',      note: 'Hotel chain operator.' },
      { symbol: 'MAR',  name: 'Marriott International',note: 'Hotel chain operator.' },
      { symbol: 'HST',  name: 'Host Hotels & Resorts', note: 'Hotel REIT — luxury and upscale properties.' },
      { symbol: 'WH',   name: 'Wyndham Hotels & Resorts', note: 'Hotel franchise operator.' },
      // Pharma:
      { symbol: 'MRK',  name: 'Merck',                 note: 'Pharma — Keytruda, vaccines.' },
      { symbol: 'BMY',  name: 'Bristol-Myers Squibb',  note: 'Pharma — oncology and cardiovascular.' },
      { symbol: 'LLY',  name: 'Eli Lilly',             note: 'Pharma — diabetes (Mounjaro) and obesity (Zepbound).' },
      { symbol: 'GILD', name: 'Gilead Sciences',       note: 'Pharma — HIV and oncology.' },
      { symbol: 'AMGN', name: 'Amgen',                 note: 'Pharma — biologics and biosimilars.' },
      { symbol: 'TEVA', name: 'Teva Pharmaceutical',   note: 'Pharma — generic and specialty drugs.' },
      { symbol: 'VTRS', name: 'Viatris',               note: 'Pharma — Mylan + Upjohn merger spinout.' },
      { symbol: 'ELAN', name: 'Elanco Animal Health',  note: 'Pharma — animal health.' },
      { symbol: 'NVO',  name: 'Novo Nordisk',          note: 'Pharma — Danish, diabetes (Ozempic) and obesity (Wegovy).' },
      { symbol: 'AZN',  name: 'AstraZeneca',           note: 'Pharma — UK/Sweden, oncology and rare diseases.' },
      { symbol: 'GSK',  name: 'GSK',                   note: 'Pharma — UK, vaccines and respiratory.' },
      { symbol: 'SNY',  name: 'Sanofi',                note: 'Pharma — French, vaccines and rare diseases.' },
      { symbol: 'NVS',  name: 'Novartis',              note: 'Pharma — Swiss, oncology and immunology.' },
      { symbol: 'MRNA', name: 'Moderna',               note: 'Pharma — mRNA vaccines and therapeutics.' },
      { symbol: 'BNTX', name: 'BioNTech',              note: 'Pharma — mRNA platform (Pfizer COVID-19 partner).' },
      { symbol: 'REGN', name: 'Regeneron',             note: 'Pharma — Eylea (eye disease), Dupixent (allergy/asthma).' },
      { symbol: 'VRTX', name: 'Vertex Pharmaceuticals',note: 'Pharma — cystic fibrosis franchise (Trikafta).' },
      { symbol: 'BIIB', name: 'Biogen',                note: 'Pharma — multiple sclerosis and Alzheimer’s.' },
      { symbol: 'ZTS',  name: 'Zoetis',                note: 'Pharma — animal health, largest in the world.' },
      { symbol: 'ABT',  name: 'Abbott Laboratories',   note: 'Pharma — diversified healthcare, devices, and nutrition.' },
      // Banks:
      { symbol: 'BAC',  name: 'Bank of America',       note: 'Bank — largest US consumer bank.' },
      { symbol: 'WFC',  name: 'Wells Fargo',           note: 'Bank — major US consumer and commercial bank.' },
      { symbol: 'C',    name: 'Citigroup',             note: 'Bank — global investment and consumer bank.' },
      { symbol: 'USB',  name: 'U.S. Bancorp',          note: 'Bank — large super-regional bank.' },
      { symbol: 'TFC',  name: 'Truist Financial',      note: 'Bank — large regional bank (BB&T + SunTrust).' },
      { symbol: 'FITB', name: 'Fifth Third Bancorp',   note: 'Bank — regional bank.' },
      { symbol: 'RF',   name: 'Regions Financial',     note: 'Bank — regional bank.' },
      { symbol: 'CFG',  name: 'Citizens Financial',    note: 'Bank — regional bank.' },
      { symbol: 'ALLY', name: 'Ally Financial',        note: 'Bank — online consumer bank.' },
      { symbol: 'KEY',  name: 'KeyCorp',               note: 'Bank — regional bank.' },
      // AI:
      { symbol: 'AVGO', name: 'Broadcom',              note: 'Semis — AI accelerators and networking chips.' },
      { symbol: 'AMD',  name: 'Advanced Micro Devices',note: 'Semis — AI GPUs (MI300) and CPUs.' },
      { symbol: 'PLTR', name: 'Palantir Technologies', note: 'AI data analytics platform (AIP).' },
      { symbol: 'ANET', name: 'Arista Networks',       note: 'AI cloud networking switches.' },
      { symbol: 'SMCI', name: 'Super Micro Computer',  note: 'AI server hardware (Nvidia H100/B200 systems).' },
      { symbol: 'ORCL', name: 'Oracle',                note: 'AI cloud infrastructure and database.' },
      { symbol: 'CRWD', name: 'CrowdStrike',           note: 'AI-powered cybersecurity (Falcon platform).' },
      { symbol: 'DDOG', name: 'Datadog',               note: 'AI observability and monitoring.' },
      { symbol: 'AI',   name: 'C3.ai',                 note: 'Enterprise AI applications.' },
      { symbol: 'SOUN', name: 'SoundHound AI',         note: 'Voice AI for autos and restaurants.' },
      // EV:
      { symbol: 'GM',   name: 'General Motors',        note: 'EV (Chevy Bolt, Hummer EV, Cadillac Lyriq).' },
      { symbol: 'RIVN', name: 'Rivian',                note: 'EV — electric trucks and SUVs.' },
      { symbol: 'LCID', name: 'Lucid Motors',          note: 'EV — luxury electric sedans.' },
      { symbol: 'NIO',  name: 'NIO',                   note: 'EV — China-based electric vehicle maker.' },
      { symbol: 'XPEV', name: 'XPeng',                 note: 'EV — China-based electric vehicle maker.' },
      { symbol: 'LI',   name: 'Li Auto',               note: 'EV — China-based extended-range hybrids.' },
      { symbol: 'BLNK', name: 'Blink Charging',        note: 'EV charging stations.' },
      { symbol: 'CHPT', name: 'ChargePoint',           note: 'EV charging network.' },
      { symbol: 'EVGO', name: 'EVgo',                  note: 'EV fast-charging network.' },
      { symbol: 'QS',   name: 'QuantumScape',          note: 'EV solid-state battery technology.' },
      // Energy (oil & gas):
      { symbol: 'COP',  name: 'ConocoPhillips',        note: 'Energy — US oil and gas E&P.' },
      { symbol: 'OXY',  name: 'Occidental Petroleum',  note: 'Energy — US oil and gas, Berkshire-backed.' },
      { symbol: 'EOG',  name: 'EOG Resources',         note: 'Energy — US shale oil and gas.' },
      { symbol: 'PSX',  name: 'Phillips 66',           note: 'Energy — refining and midstream.' },
      { symbol: 'MPC',  name: 'Marathon Petroleum',    note: 'Energy — US refiner.' },
      { symbol: 'VLO',  name: 'Valero Energy',         note: 'Energy — US refiner.' },
      { symbol: 'SLB',  name: 'Schlumberger',          note: 'Energy — oilfield services.' },
      { symbol: 'HAL',  name: 'Halliburton',           note: 'Energy — oilfield services.' },
      { symbol: 'BKR',  name: 'Baker Hughes',          note: 'Energy — oilfield services and equipment.' },
      { symbol: 'DVN',  name: 'Devon Energy',          note: 'Energy — US shale producer.' },
      // Under-$25 energy — smaller E&Ps, secondary refiners, drilling
      // and pressure-pumping services, and coal/gas miners. Higher
      // operational leverage to commodity prices than the majors above.
      { symbol: 'CTRA', name: 'Coterra Energy',        note: 'Energy — natural-gas-weighted E&P (Permian + Marcellus + Anadarko).' },
      { symbol: 'PR',   name: 'Permian Resources',     note: 'Energy — pure-play Permian Basin E&P.' },
      { symbol: 'CRGY', name: 'Crescent Energy',       note: 'Energy — Eagle Ford and Uinta Basin E&P (KKR-affiliated).' },
      { symbol: 'CNX',  name: 'CNX Resources',         note: 'Energy — Appalachian natural-gas producer.' },
      { symbol: 'BTU',  name: 'Peabody Energy',        note: 'Energy — US coal miner (thermal + metallurgical).' },
      { symbol: 'DK',   name: 'Delek US Holdings',     note: 'Energy — independent refiner (Texas, Arkansas, Tennessee).' },
      { symbol: 'PARR', name: 'Par Pacific Holdings',  note: 'Energy — Hawaii, Pacific Northwest, Wyoming refiner + retail.' },
      { symbol: 'RIG',  name: 'Transocean',            note: 'Energy — offshore drilling rigs (ultra-deepwater).' },
      { symbol: 'PTEN', name: 'Patterson-UTI Energy',  note: 'Energy — onshore contract drilling and pressure pumping.' },
      { symbol: 'LBRT', name: 'Liberty Energy',        note: 'Energy — hydraulic fracturing and completion services.' },
      { symbol: 'AESI', name: 'Atlas Energy Solutions', note: 'Energy — frac sand and last-mile logistics in the Permian.' },
      { symbol: 'VTLE', name: 'Vital Energy',          note: 'Energy — small-cap Permian Basin oil producer.' },
      // Utilities:
      { symbol: 'NEE',  name: 'NextEra Energy',        note: 'Utility — Florida Power & Light + largest US renewables.' },
      { symbol: 'DUK',  name: 'Duke Energy',           note: 'Utility — Southeast US electric and gas.' },
      { symbol: 'AEP',  name: 'American Electric Power', note: 'Utility — multi-state electric.' },
      { symbol: 'D',    name: 'Dominion Energy',       note: 'Utility — Virginia and Carolinas electric.' },
      { symbol: 'EXC',  name: 'Exelon',                note: 'Utility — Mid-Atlantic electric and gas.' },
      { symbol: 'AEE',  name: 'Ameren',                note: 'Utility — Missouri and Illinois electric and gas.' },
      { symbol: 'ED',   name: 'Consolidated Edison',   note: 'Utility — New York City electric and gas, dividend aristocrat (50+ years).' },
      { symbol: 'XEL',  name: 'Xcel Energy',           note: 'Utility — Midwest electric and gas.' },
      { symbol: 'WEC',  name: 'WEC Energy',            note: 'Utility — Wisconsin and Illinois electric and gas.' },
      { symbol: 'PPL',  name: 'PPL Corporation',       note: 'Utility — Pennsylvania and Kentucky electric.' },
      // Semis:
      { symbol: 'TSM',  name: 'Taiwan Semiconductor',  note: 'Semis — leading chip foundry (Apple, Nvidia, AMD).' },
      { symbol: 'INTC', name: 'Intel',                 note: 'Semis — CPUs and foundry (turnaround story).' },
      { symbol: 'MU',   name: 'Micron Technology',     note: 'Semis — memory (DRAM, NAND, HBM for AI).' },
      { symbol: 'QCOM', name: 'Qualcomm',              note: 'Semis — mobile chips (Snapdragon) and 5G modems.' },
      { symbol: 'ASML', name: 'ASML Holding',          note: 'Semis — EUV lithography monopoly (Dutch).' },
      { symbol: 'AMAT', name: 'Applied Materials',     note: 'Semis — chip-fab equipment.' },
      { symbol: 'LRCX', name: 'Lam Research',          note: 'Semis — chip-fab equipment (etch / deposition).' },
      { symbol: 'KLAC', name: 'KLA Corporation',       note: 'Semis — chip-fab metrology and inspection.' },
      { symbol: 'MRVL', name: 'Marvell Technology',    note: 'Semis — data-center networking and storage chips.' },
      { symbol: 'TXN',  name: 'Texas Instruments',     note: 'Semis — analog and embedded; long-standing dividend aristocrat.' },
      { symbol: 'ADI',  name: 'Analog Devices',        note: 'Semis — high-performance analog ICs (signal chain, power).' },
      { symbol: 'NXPI', name: 'NXP Semiconductors',    note: 'Semis — automotive, secure ID, and industrial chips.' },
      { symbol: 'MCHP', name: 'Microchip Technology',  note: 'Semis — microcontrollers and analog for industrial / auto.' },
      { symbol: 'ON',   name: 'ON Semiconductor',      note: 'Semis — power and silicon-carbide for EVs and industrial.' },
      { symbol: 'ARM',  name: 'Arm Holdings',          note: 'Semis — chip-architecture IP (mobile, data center, AI).' },
      { symbol: 'TER',  name: 'Teradyne',              note: 'Semis — automated chip-test equipment.' },
      { symbol: 'STM',  name: 'STMicroelectronics',    note: 'Semis — European mixed-signal, automotive, MCUs (ADR).' },
      { symbol: 'SWKS', name: 'Skyworks Solutions',    note: 'Semis — RF front-end for smartphones and IoT.' },
      { symbol: 'QRVO', name: 'Qorvo',                 note: 'Semis — RF chips for 5G, defense, infrastructure.' },
      { symbol: 'ENTG', name: 'Entegris',              note: 'Semis — materials, filtration, and handling for chip fabs.' },
      { symbol: 'MKSI', name: 'MKS Instruments',       note: 'Semis — fab subsystems (vacuum, gas, photonics).' },
      { symbol: 'WOLF', name: 'Wolfspeed',             note: 'Semis — silicon-carbide power chips for EVs and grid.' },
      { symbol: 'CRDO', name: 'Credo Technology',      note: 'Semis — high-speed connectivity for AI data centers.' },
      { symbol: 'AMBA', name: 'Ambarella',             note: 'Semis — vision-AI chips for cameras, automotive, robotics.' },
      // Smaller-cap / lower-priced semis (typically under $60 / share) —
      // packaging, smaller foundries, analog & discrete, and equipment.
      { symbol: 'ASX',  name: 'ASE Technology Holding', note: 'Semis — world\'s largest OSAT (chip assembly and test, ADR).' },
      { symbol: 'AMKR', name: 'Amkor Technology',       note: 'Semis — chip packaging and test (OSAT) for major foundries.' },
      { symbol: 'UMC',  name: 'United Microelectronics', note: 'Semis — Taiwan foundry, mature-node alternative to TSMC.' },
      { symbol: 'TSEM', name: 'Tower Semiconductor',    note: 'Semis — Israeli specialty foundry (analog, RF, automotive).' },
      { symbol: 'HIMX', name: 'Himax Technologies',     note: 'Semis — display driver ICs for OLED, LCD, and AR/VR (ADR).' },
      { symbol: 'VSH',  name: 'Vishay Intertechnology', note: 'Semis — discrete semis, MOSFETs, and passive components.' },
      { symbol: 'ALGM', name: 'Allegro MicroSystems',   note: 'Semis — magnetic sensors and power chips for autos and industrial.' },
      { symbol: 'AOSL', name: 'Alpha and Omega Semiconductor', note: 'Semis — power MOSFETs and ICs for consumer and industrial.' },
      { symbol: 'AEHR', name: 'Aehr Test Systems',      note: 'Semis — burn-in test systems, esp. silicon-carbide power chips.' },
      { symbol: 'ICHR', name: 'Ichor Holdings',         note: 'Semis — fluid delivery subsystems for chip-fab tools.' },
      { symbol: 'VECO', name: 'Veeco Instruments',      note: 'Semis — deposition and lithography equipment.' },
      { symbol: 'ACMR', name: 'ACM Research',           note: 'Semis — wafer cleaning equipment (China-exposed).' },
      // Ultra-low-priced semis (typically under $25 / share) — auto ADAS,
      // GaN power, niche memory, photonics, and small-cap packaging.
      // Higher beta than the names above; volatile single-product stories.
      { symbol: 'MBLY', name: 'Mobileye Global',        note: 'Semis — ADAS / autonomous-driving chips (Intel spin-off).' },
      { symbol: 'INDI', name: 'indie Semiconductor',    note: 'Semis — mixed-signal automotive chips (radar, cabin, ADAS).' },
      { symbol: 'NVTS', name: 'Navitas Semiconductor',  note: 'Semis — gallium-nitride (GaN) power chips for EVs and data centers.' },
      { symbol: 'TGAN', name: 'Transphorm',             note: 'Semis — GaN power semis (Renesas-owned).' },
      { symbol: 'CEVA', name: 'Ceva',                   note: 'Semis — chip IP for AI, DSP, 5G, and Wi-Fi.' },
      { symbol: 'MRAM', name: 'Everspin Technologies',  note: 'Semis — MRAM (magnetic memory) for industrial and aerospace.' },
      { symbol: 'MX',   name: 'Magnachip Semiconductor',note: 'Semis — display driver ICs and power chips (Korean).' },
      { symbol: 'AXTI', name: 'AXT',                    note: 'Semis — compound semi substrates (InP, GaAs, germanium).' },
      { symbol: 'IMOS', name: 'ChipMOS Technologies',   note: 'Semis — Taiwan-based assembly and test (ADR).' },
      { symbol: 'POET', name: 'POET Technologies',      note: 'Semis — silicon photonics for AI data-center interconnects.' },
      { symbol: 'EMKR', name: 'EMCORE',                 note: 'Semis — RF photonics and inertial navigation chips.' },
      { symbol: 'PXLW', name: 'Pixelworks',             note: 'Semis — video processors for mobile and projectors.' },
      { symbol: 'BABA', name: 'Alibaba',               note: 'China — e-commerce (Taobao, Tmall) and cloud.' },
      { symbol: 'JD',   name: 'JD.com',                note: 'China — e-commerce and logistics.' },
      { symbol: 'PDD',  name: 'PDD Holdings',          note: 'China — Pinduoduo / Temu parent.' },
      { symbol: 'BIDU', name: 'Baidu',                 note: 'China — search engine and AI.' },
      { symbol: 'NTES', name: 'NetEase',               note: 'China — gaming and online services.' },
      { symbol: 'TCEHY', name: 'Tencent Holdings',     note: 'China — WeChat, gaming, fintech (ADR).' },
      { symbol: 'BILI', name: 'Bilibili',              note: 'China — video streaming and gaming.' },
      // Entertainment:
      { symbol: 'DIS',  name: 'Walt Disney',            note: 'Entertainment — parks, ESPN, streaming (Disney+).' },
      { symbol: 'NFLX', name: 'Netflix',                note: 'Entertainment — global streaming subscriber leader.' },
      { symbol: 'WBD',  name: 'Warner Bros. Discovery', note: 'Entertainment — HBO, Max, Warner studios.' },
      { symbol: 'PARA', name: 'Paramount Global',       note: 'Entertainment — CBS, Paramount+, MTV.' },
      { symbol: 'FOX',  name: 'Fox Corporation',        note: 'Entertainment — Fox News, Fox Sports.' },
      { symbol: 'LYV',  name: 'Live Nation',            note: 'Entertainment — concerts and Ticketmaster.' },
      { symbol: 'EA',   name: 'Electronic Arts',        note: 'Entertainment — video games (FIFA, Madden, Apex Legends).' },
      { symbol: 'TTWO', name: 'Take-Two Interactive',   note: 'Entertainment — video games (GTA, NBA 2K, Rockstar).' },
      { symbol: 'RBLX', name: 'Roblox',                 note: 'Entertainment — user-generated game platform.' },
      { symbol: 'SPOT', name: 'Spotify',                note: 'Entertainment — music and podcast streaming.' },
      { symbol: 'ROKU', name: 'Roku',                   note: 'Entertainment — streaming devices and ad-supported TV.' },
      { symbol: 'AMC',  name: 'AMC Entertainment',      note: 'Entertainment — largest US movie theater chain.' },
      // Fintech:
      { symbol: 'V',    name: 'Visa',                   note: 'Fintech — global card / payments network.' },
      { symbol: 'MA',   name: 'Mastercard',             note: 'Fintech — global card / payments network.' },
      { symbol: 'PYPL', name: 'PayPal',                 note: 'Fintech — digital payments and Venmo.' },
      { symbol: 'SQ',   name: 'Block',                  note: 'Fintech — Square (merchants), Cash App, Bitcoin.' },
      { symbol: 'COIN', name: 'Coinbase',               note: 'Fintech — largest US crypto exchange.' },
      { symbol: 'AXP',  name: 'American Express',       note: 'Fintech — premium card network and lender.' },
      { symbol: 'DFS',  name: 'Discover Financial',     note: 'Fintech — Discover card network and consumer lender.' },
      { symbol: 'COF',  name: 'Capital One',            note: 'Fintech — credit card issuer and consumer bank.' },
      { symbol: 'SYF',  name: 'Synchrony Financial',    note: 'Fintech — private-label credit cards (Amazon, Lowe’s, PayPal).' },
      { symbol: 'BFH',  name: 'Bread Financial',        note: 'Fintech — co-branded credit card issuer (formerly Alliance Data).' },
      { symbol: 'SOFI', name: 'SoFi Technologies',      note: 'Fintech — online consumer bank and lending.' },
      { symbol: 'AFRM', name: 'Affirm',                 note: 'Fintech — buy-now-pay-later lender.' },
      { symbol: 'HOOD', name: 'Robinhood Markets',      note: 'Fintech — commission-free brokerage.' },
      { symbol: 'NU',   name: 'Nu Holdings',            note: 'Fintech — Brazilian neobank (Nubank).' },
      { symbol: 'UPST', name: 'Upstart',                note: 'Fintech — AI-driven consumer lending platform.' },
      { symbol: 'FIS',  name: 'Fidelity National Info', note: 'Fintech — banking and payments software.' },
      // Farming:
      { symbol: 'DE',   name: 'Deere & Company',        note: 'Farming — tractors and ag equipment (John Deere).' },
      { symbol: 'AGCO', name: 'AGCO Corporation',       note: 'Farming — ag equipment (Massey Ferguson, Fendt).' },
      { symbol: 'CNHI', name: 'CNH Industrial',         note: 'Farming — ag equipment (Case IH, New Holland).' },
      { symbol: 'BG',   name: 'Bunge Global',           note: 'Farming — global grain trading and processing.' },
      { symbol: 'ADM',  name: 'Archer-Daniels-Midland', note: 'Farming — global grain trading and food ingredients.' },
      { symbol: 'CTVA', name: 'Corteva',                note: 'Farming — seeds and crop protection (DowDuPont spinoff).' },
      { symbol: 'MOS',  name: 'Mosaic',                 note: 'Farming — phosphate and potash fertilizer.' },
      { symbol: 'CF',   name: 'CF Industries',          note: 'Farming — nitrogen fertilizer (urea, ammonia).' },
      { symbol: 'NTR',  name: 'Nutrien',                note: 'Farming — largest fertilizer producer (Canadian).' },
      { symbol: 'FMC',  name: 'FMC Corporation',        note: 'Farming — agricultural chemicals (crop protection).' },
      { symbol: 'TSN',  name: 'Tyson Foods',            note: 'Farming — largest US meat processor (chicken, beef, pork).' },
      // Local · IA — Iowa-headquartered public companies:
      { symbol: 'PFG',  name: 'Principal Financial Group', note: 'Local · IA — Des Moines-based insurance and asset management.' },
      { symbol: 'CASY', name: "Casey's General Stores",   note: 'Local · IA — Ankeny-based convenience-store chain across the Midwest.' },
      { symbol: 'HNI',  name: 'HNI Corporation',          note: 'Local · IA — Muscatine-based office furniture (HON brand).' },
      { symbol: 'WK',   name: 'Workiva',                  note: 'Local · IA — Ames-based cloud reporting / compliance SaaS.' },
      { symbol: 'HTLD', name: 'Heartland Express',        note: 'Local · IA — North Liberty-based long-haul trucking.' },
      { symbol: 'LEE',  name: 'Lee Enterprises',          note: 'Local · IA — Davenport-based local newspaper publisher.' },
      { symbol: 'WTBA', name: 'West Bancorporation',      note: 'Local · IA — West Des Moines community bank.' },
      { symbol: 'MOFG', name: 'MidWestOne Financial',     note: 'Local · IA — Iowa City-based community bank.' },
      // Auto:
      { symbol: 'HMC',  name: 'Honda Motor',              note: 'Auto — Honda (Japanese automaker, ADR).' },
      { symbol: 'TM',   name: 'Toyota Motor',             note: 'Auto — Toyota (Japanese automaker, ADR).' },
      { symbol: 'STLA', name: 'Stellantis',               note: 'Auto — Stellantis (Jeep, Ram, Chrysler, Fiat, Peugeot).' },
      { symbol: 'HOG',  name: 'Harley-Davidson',          note: 'Auto — Harley-Davidson motorcycles.' },
      // Food:
      { symbol: 'KHC',  name: 'Kraft Heinz',              note: 'Food — Kraft Heinz (packaged: Heinz, Kraft, Oscar Mayer).' },
      { symbol: 'CAG',  name: 'Conagra Brands',           note: 'Food — Conagra (Slim Jim, Hunt’s, Marie Callender’s).' },
      { symbol: 'K',    name: 'Kellanova',                note: 'Food — Kellanova (snacks and breakfast, formerly Kellogg).' },
      { symbol: 'SJM',  name: 'J.M. Smucker',             note: 'Food — Smucker (jams, peanut butter, pet food).' },
      { symbol: 'MKC',  name: 'McCormick',                note: 'Food — McCormick (spices and seasonings).' },
      { symbol: 'CPB',  name: 'Campbell Soup',            note: 'Food — Campbell Soup.' },
      // Chemicals:
      { symbol: 'DOW',  name: 'Dow',                      note: 'Chemicals — Dow (commodity and specialty).' },
      { symbol: 'LYB',  name: 'LyondellBasell',           note: 'Chemicals — LyondellBasell (plastics and refining).' },
      { symbol: 'EMN',  name: 'Eastman Chemical',         note: 'Chemicals — Eastman (specialty materials).' },
      { symbol: 'ALB',  name: 'Albemarle',                note: 'Chemicals — Albemarle (largest lithium producer for batteries).' },
      { symbol: 'CE',   name: 'Celanese',                 note: 'Chemicals — Celanese (acetyl chain and engineered materials).' },
      { symbol: 'OLN',  name: 'Olin',                     note: 'Chemicals — Olin (chlor-alkali, Winchester ammunition).' },
      // Closed-end funds:
      { symbol: 'PDI',  name: 'PIMCO Dynamic Income Fund', note: 'Fund — PIMCO Dynamic Income (multi-sector bond CEF).' },
      { symbol: 'BST',  name: 'BlackRock Science & Tech',  note: 'Fund — BlackRock Science & Tech Trust (tech-focused CEF).' },
      { symbol: 'ADX',  name: 'Adams Diversified Equity',  note: 'Fund — Adams Diversified Equity (diversified US equity CEF).' },
      // REIT-Like (real estate exposure not structured as a REIT):
      { symbol: 'TPL',  name: 'Texas Pacific Land',       note: 'REIT-Like — Texas Pacific Land (Permian basin royalty / land).' },
      { symbol: 'FRPH', name: 'FRP Holdings',             note: 'REIT-Like — FRP Holdings (mineral royalties and warehouses).' },
      { symbol: 'FOR',  name: 'Forestar Group',           note: 'REIT-Like — Forestar Group (residential lot developer, D.R. Horton stake).' },
      // Local · MN — Minnesota-headquartered public companies:
      { symbol: 'TGT',  name: 'Target',                    note: 'Local · MN — Minneapolis-based big-box retailer.' },
      { symbol: 'UNH',  name: 'UnitedHealth Group',        note: 'Local · MN — Minnetonka-based largest US health insurer.' },
      { symbol: 'BBY',  name: 'Best Buy',                  note: 'Local · MN — Richfield-based consumer electronics retailer.' },
      { symbol: 'ECL',  name: 'Ecolab',                    note: 'Local · MN — St. Paul-based water and hygiene technologies.' },
      { symbol: 'MMM',  name: '3M',                        note: 'Local · MN — St. Paul-based industrial conglomerate.' },
      { symbol: 'HRL',  name: 'Hormel Foods',              note: 'Local · MN — Austin-based packaged meats (Spam, Skippy, Jennie-O).' },
      { symbol: 'CHRW', name: 'C.H. Robinson Worldwide',   note: 'Local · MN — Eden Prairie-based logistics broker.' },
      { symbol: 'GIS',  name: 'General Mills',             note: 'Local · MN — Minneapolis-based packaged foods (Cheerios, Pillsbury).' },
      { symbol: 'WGO',  name: 'Winnebago Industries',      note: 'Local · MN — Eden Prairie-based RV maker.' },
      { symbol: 'AMP',  name: 'Ameriprise Financial',      note: 'Local · MN — Minneapolis-based asset management.' },
      { symbol: 'TTC',  name: 'Toro Company',              note: 'Local · MN — Bloomington-based outdoor / turf equipment.' },
      // Local · KS — Kansas-headquartered public companies:
      { symbol: 'EVRG', name: 'Evergy',                    note: 'Local · KS — Topeka-based electric utility.' },
      { symbol: 'GRMN', name: 'Garmin',                    note: 'Local · KS — Olathe-based GPS, wearables, and aviation electronics.' },
      { symbol: 'CMP',  name: 'Compass Minerals',          note: 'Local · KS — Overland Park-based salt and specialty minerals.' },
      { symbol: 'SPR',  name: 'Spirit AeroSystems',        note: 'Local · KS — Wichita-based aerospace structures (Boeing supplier).' },
      { symbol: 'SEB',  name: 'Seaboard Corporation',      note: 'Local · KS — Merriam-based diversified agribusiness and shipping.' },
      // Local · IL — Illinois-headquartered public companies:
      { symbol: 'WBA',  name: 'Walgreens Boots Alliance',  note: 'Local · IL — Deerfield-based drugstore chain.' },
      { symbol: 'MDLZ', name: 'Mondelez International',    note: 'Local · IL — Chicago-based snacks (Oreo, Cadbury, Ritz).' },
      { symbol: 'ALL',  name: 'Allstate',                  note: 'Local · IL — Northbrook-based property and casualty insurer.' },
      { symbol: 'AON',  name: 'Aon plc',                   note: 'Local · IL — Chicago-based global insurance broker.' },
      { symbol: 'ITW',  name: 'Illinois Tool Works',       note: 'Local · IL — Glenview-based diversified industrial manufacturer.' },
      { symbol: 'BAX',  name: 'Baxter International',      note: 'Local · IL — Deerfield-based medical devices (renal, infusion).' },
      { symbol: 'GWW',  name: 'W.W. Grainger',             note: 'Local · IL — Lake Forest-based industrial supply distributor.' },
      { symbol: 'ULTA', name: 'Ulta Beauty',               note: 'Local · IL — Bolingbrook-based beauty-products retailer.' },
      // International banks (ADRs):
      { symbol: 'ITUB', name: 'Itaú Unibanco',             note: 'Bank — Brazilian banking giant ADR.' },
      { symbol: 'BBD',  name: 'Banco Bradesco',            note: 'Bank — Brazilian bank ADR.' },
      { symbol: 'ING',  name: 'ING Groep',                 note: 'Bank — Dutch global bank ADR.' },
      { symbol: 'SAN',  name: 'Banco Santander',           note: 'Bank — Spanish global bank ADR.' },
      { symbol: 'LYG',  name: 'Lloyds Banking Group',      note: 'Bank — UK retail bank ADR.' },
      { symbol: 'NLY',  name: 'Annaly Capital Management', note: 'Mortgage REIT — large agency-MBS REIT.' },
      { symbol: 'FSK',  name: 'FS KKR Capital',            note: 'BDC — business development company.' },
      { symbol: 'NEWT', name: 'NewtekOne',                 note: 'Financial — small-business lending and banking.' },
      // International telecom (ADRs):
      { symbol: 'VOD',  name: 'Vodafone Group',            note: 'Telecom — UK global wireless ADR.' },
      { symbol: 'ORAN', name: 'Orange',                    note: 'Telecom — French wireless and broadband ADR.' },
      { symbol: 'TIMB', name: 'TIM S.A.',                  note: 'Telecom — Brazilian wireless ADR.' },
      { symbol: 'VIV',  name: 'Telefônica Brasil',         note: 'Telecom — Brazilian wireless ADR (Vivo).' },
      { symbol: 'TU',   name: 'TELUS',                     note: 'Telecom — Canadian wireless ADR.' },
      { symbol: 'KEP',  name: 'Korea Electric Power',      note: 'Utility — South Korean electric utility ADR.' },
      // Media:
      { symbol: 'SIRI', name: 'Sirius XM Holdings',        note: 'Media — satellite radio and Pandora.' },
      { symbol: 'PARA', name: 'Paramount Global',          note: 'Media — Paramount+ streaming, CBS, MTV.' },
      { symbol: 'TGNA', name: 'Tegna',                     note: 'Media — local-TV broadcaster.' },
      { symbol: 'WU',   name: 'Western Union',             note: 'Fintech — global money transfer.' },
      // Tanker & dry-bulk shipping:
      { symbol: 'DHT',  name: 'DHT Holdings',              note: 'Shipping — crude-oil tanker fleet (VLCCs).' },
      { symbol: 'FRO',  name: 'Frontline',                 note: 'Shipping — large crude-oil tanker fleet.' },
      { symbol: 'SBLK', name: 'Star Bulk Carriers',        note: 'Shipping — dry-bulk fleet (iron ore, grain, coal).' },
      { symbol: 'GOGL', name: 'Golden Ocean Group',        note: 'Shipping — dry-bulk fleet.' },
      { symbol: 'SB',   name: 'Safe Bulkers',              note: 'Shipping — dry-bulk fleet.' },
      { symbol: 'GNK',  name: 'Genco Shipping & Trading',  note: 'Shipping — dry-bulk fleet.' },
      // International mining:
      { symbol: 'HMY',  name: 'Harmony Gold Mining',       note: 'Mining — South African gold miner ADR.' },
      { symbol: 'GFI',  name: 'Gold Fields',               note: 'Mining — South African gold miner ADR.' },
      { symbol: 'SBSW', name: 'Sibanye Stillwater',        note: 'Mining — South African platinum and gold ADR.' },
      { symbol: 'VALE', name: 'Vale',                      note: 'Mining — Brazilian iron-ore and metals ADR.' },
      // Chemicals:
      { symbol: 'KRO',  name: 'Kronos Worldwide',          note: 'Chemicals — titanium-dioxide pigment maker.' },
      // Cybersecurity:
      { symbol: 'PANW', name: 'Palo Alto Networks',        note: 'Cybersecurity — next-gen firewalls, Cortex XSIAM, Prisma cloud security.' },
      { symbol: 'NET',  name: 'Cloudflare',                note: 'Cybersecurity — edge / DDoS protection, Zero Trust platform.' },
      { symbol: 'ZS',   name: 'Zscaler',                   note: 'Cybersecurity — Zero Trust Exchange (cloud SASE).' },
      { symbol: 'FTNT', name: 'Fortinet',                  note: 'Cybersecurity — firewalls, secure SD-WAN, security fabric.' },
      { symbol: 'OKTA', name: 'Okta',                      note: 'Cybersecurity — identity & access management (Auth0).' },
      { symbol: 'S',    name: 'SentinelOne',               note: 'Cybersecurity — autonomous endpoint protection.' },
      { symbol: 'CYBR', name: 'CyberArk Software',         note: 'Cybersecurity — privileged-access management.' },
      { symbol: 'RPD',  name: 'Rapid7',                    note: 'Cybersecurity — vulnerability management and SIEM.' },
      { symbol: 'TENB', name: 'Tenable Holdings',          note: 'Cybersecurity — Nessus and exposure management.' },
      { symbol: 'VRNS', name: 'Varonis Systems',           note: 'Cybersecurity — data security and insider-threat detection.' },
      // Software / SaaS:
      { symbol: 'CRM',  name: 'Salesforce',                note: 'Software — CRM, Slack, Tableau, Mulesoft, Einstein AI.' },
      { symbol: 'ADBE', name: 'Adobe',                     note: 'Software — Creative Cloud (Photoshop), Document Cloud, Firefly AI.' },
      { symbol: 'NOW',  name: 'ServiceNow',                note: 'Software — IT service management and workflow automation.' },
      { symbol: 'INTU', name: 'Intuit',                    note: 'Software — TurboTax, QuickBooks, Credit Karma, Mailchimp.' },
      { symbol: 'WDAY', name: 'Workday',                   note: 'Software — HR and finance cloud (HCM, Adaptive Planning).' },
      { symbol: 'SNOW', name: 'Snowflake',                 note: 'Software — cloud data warehouse / AI Data Cloud.' },
      { symbol: 'MDB',  name: 'MongoDB',                   note: 'Software — document database (Atlas).' },
      { symbol: 'TEAM', name: 'Atlassian',                 note: 'Software — Jira, Confluence, Trello, Bitbucket.' },
      { symbol: 'ZM',   name: 'Zoom Communications',       note: 'Software — video meetings, Zoom Phone, contact center.' },
      { symbol: 'DOCU', name: 'DocuSign',                  note: 'Software — e-signature and contract lifecycle management.' },
      { symbol: 'SHOP', name: 'Shopify',                   note: 'Software — e-commerce platform for merchants.' },
      { symbol: 'TWLO', name: 'Twilio',                    note: 'Software — programmable communications APIs (SMS, voice, email).' },
      { symbol: 'ESTC', name: 'Elastic',                   note: 'Software — Elasticsearch, observability, security analytics.' },
      { symbol: 'FROG', name: 'JFrog',                     note: 'Software — DevOps artifact and software-supply-chain platform.' },
      { symbol: 'GTLB', name: 'GitLab',                    note: 'Software — DevSecOps platform.' },
      // Insurance:
      { symbol: 'PGR',  name: 'Progressive',               note: 'Insurance — auto and home (direct + agent).' },
      { symbol: 'TRV',  name: 'Travelers',                 note: 'Insurance — commercial and personal P&C.' },
      { symbol: 'CB',   name: 'Chubb',                     note: 'Insurance — global commercial P&C and specialty.' },
      { symbol: 'AIG',  name: 'American International Group', note: 'Insurance — global commercial and specialty.' },
      { symbol: 'MET',  name: 'MetLife',                   note: 'Insurance — life and group benefits.' },
      { symbol: 'PRU',  name: 'Prudential Financial',      note: 'Insurance — life, retirement, asset management (PGIM).' },
      { symbol: 'MMC',  name: 'Marsh McLennan',            note: 'Insurance — global broker (Marsh, Mercer, Guy Carpenter).' },
      { symbol: 'AJG',  name: 'Arthur J. Gallagher',       note: 'Insurance — global broker.' },
      { symbol: 'WTW',  name: 'Willis Towers Watson',      note: 'Insurance — broker and HR consulting.' },
      { symbol: 'HIG',  name: 'Hartford Financial',        note: 'Insurance — P&C, group benefits, mutual funds.' },
      { symbol: 'CINF', name: 'Cincinnati Financial',      note: 'Insurance — regional P&C, dividend aristocrat.' },
      { symbol: 'L',    name: 'Loews Corporation',         note: 'Insurance — CNA Financial holding (Tisch family).' },
      // Healthcare services:
      { symbol: 'UNH',  name: 'UnitedHealth Group',        note: 'Healthcare — largest US health insurer + Optum services.' },
      { symbol: 'CVS',  name: 'CVS Health',                note: 'Healthcare — pharmacy retail, Aetna insurance, Caremark PBM.' },
      { symbol: 'CI',   name: 'Cigna Group',               note: 'Healthcare — insurance and Express Scripts PBM.' },
      { symbol: 'HUM',  name: 'Humana',                    note: 'Healthcare — Medicare Advantage leader.' },
      { symbol: 'ELV',  name: 'Elevance Health',           note: 'Healthcare — Anthem Blue Cross plans.' },
      { symbol: 'HCA',  name: 'HCA Healthcare',            note: 'Healthcare — largest US for-profit hospital operator.' },
      { symbol: 'CNC',  name: 'Centene',                   note: 'Healthcare — Medicaid and ACA marketplace insurer.' },
      { symbol: 'MOH',  name: 'Molina Healthcare',         note: 'Healthcare — Medicaid and Medicare insurer.' },
      { symbol: 'DVA',  name: 'DaVita',                    note: 'Healthcare — kidney-dialysis services.' },
      { symbol: 'ISRG', name: 'Intuitive Surgical',        note: 'Healthcare — da Vinci surgical robotics.' },
      { symbol: 'IDXX', name: 'IDEXX Laboratories',        note: 'Healthcare — veterinary diagnostics.' },
      { symbol: 'DXCM', name: 'DexCom',                    note: 'Healthcare — continuous glucose monitors.' },
      // Retail:
      { symbol: 'COST', name: 'Costco Wholesale',          note: 'Retail — membership warehouse club.' },
      { symbol: 'HD',   name: 'Home Depot',                note: 'Retail — home improvement leader.' },
      { symbol: 'LOW',  name: "Lowe's",                    note: 'Retail — home improvement runner-up to HD.' },
      { symbol: 'TJX',  name: 'TJX Companies',             note: 'Retail — TJ Maxx, Marshalls, HomeGoods off-price.' },
      { symbol: 'TGT',  name: 'Target',                    note: 'Retail — mass-merchandise discount chain.' },
      { symbol: 'DG',   name: 'Dollar General',            note: 'Retail — small-town dollar-store leader.' },
      { symbol: 'DLTR', name: 'Dollar Tree',               note: 'Retail — discount variety store (Family Dollar parent).' },
      { symbol: 'BBY',  name: 'Best Buy',                  note: 'Retail — consumer electronics chain.' },
      { symbol: 'ROST', name: 'Ross Stores',               note: 'Retail — off-price apparel and home goods.' },
      { symbol: 'BURL', name: 'Burlington Stores',         note: 'Retail — off-price apparel and home.' },
      { symbol: 'AZO',  name: 'AutoZone',                  note: 'Retail — auto parts retailer.' },
      { symbol: 'ORLY', name: "O'Reilly Automotive",       note: 'Retail — auto parts retailer.' },
      { symbol: 'TSCO', name: 'Tractor Supply',            note: 'Retail — rural lifestyle / farm-supply chain.' },
      { symbol: 'FIVE', name: 'Five Below',                note: 'Retail — $1–$5 discount chain for teens / tweens.' },
      // Consumer staples:
      { symbol: 'PG',   name: 'Procter & Gamble',          note: 'Consumer staples — Tide, Pampers, Gillette, Crest.' },
      { symbol: 'PEP',  name: 'PepsiCo',                   note: 'Consumer staples — Pepsi, Frito-Lay, Quaker, Gatorade.' },
      { symbol: 'CL',   name: 'Colgate-Palmolive',         note: 'Consumer staples — toothpaste, soap, pet food (Hill\'s).' },
      { symbol: 'KMB',  name: 'Kimberly-Clark',            note: 'Consumer staples — Kleenex, Huggies, Cottonelle.' },
      { symbol: 'GIS',  name: 'General Mills',             note: 'Consumer staples — Cheerios, Yoplait, Pillsbury, Häagen-Dazs.' },
      { symbol: 'K',    name: 'Kellanova',                 note: 'Consumer staples — Pringles, Cheez-It, RX (Kellogg\'s snacks spinoff).' },
      { symbol: 'KHC',  name: 'Kraft Heinz',               note: 'Consumer staples — Kraft, Heinz, Oscar Mayer, Philadelphia.' },
      { symbol: 'CPB',  name: 'Campbell Soup',             note: 'Consumer staples — soup, Pepperidge Farm, Snyder\'s.' },
      { symbol: 'STZ',  name: 'Constellation Brands',      note: 'Consumer staples — Corona, Modelo, Robert Mondavi.' },
      { symbol: 'TAP',  name: 'Molson Coors',              note: 'Consumer staples — Coors Light, Miller, Blue Moon.' },
      { symbol: 'CHD',  name: 'Church & Dwight',           note: 'Consumer staples — Arm & Hammer, OxiClean, Trojan.' },
      { symbol: 'CLX',  name: 'Clorox',                    note: 'Consumer staples — Clorox, Brita, Glad, Hidden Valley.' },
      // Travel & leisure:
      { symbol: 'ABNB', name: 'Airbnb',                    note: 'Travel — short-term home rental marketplace.' },
      { symbol: 'BKNG', name: 'Booking Holdings',          note: 'Travel — Booking.com, Priceline, Kayak, OpenTable.' },
      { symbol: 'EXPE', name: 'Expedia Group',             note: 'Travel — Expedia, Hotels.com, Vrbo, Trivago.' },
      { symbol: 'DAL',  name: 'Delta Air Lines',           note: 'Travel — major US airline.' },
      { symbol: 'UAL',  name: 'United Airlines',           note: 'Travel — major US airline.' },
      { symbol: 'AAL',  name: 'American Airlines',         note: 'Travel — major US airline.' },
      { symbol: 'LUV',  name: 'Southwest Airlines',        note: 'Travel — low-cost US airline.' },
      { symbol: 'ALK',  name: 'Alaska Air Group',          note: 'Travel — Alaska Airlines + Hawaiian Airlines (post-merger).' },
      { symbol: 'JBLU', name: 'JetBlue Airways',           note: 'Travel — low-cost US airline.' },
      { symbol: 'CCL',  name: 'Carnival',                  note: 'Travel — largest cruise line operator.' },
      { symbol: 'RCL',  name: 'Royal Caribbean',           note: 'Travel — cruise line operator.' },
      { symbol: 'NCLH', name: 'Norwegian Cruise Line',     note: 'Travel — cruise line operator.' },
      { symbol: 'MGM',  name: 'MGM Resorts',               note: 'Travel — Las Vegas casinos and resorts.' },
      { symbol: 'WYNN', name: 'Wynn Resorts',              note: 'Travel — Vegas and Macau casinos.' },
      { symbol: 'LVS',  name: 'Las Vegas Sands',           note: 'Travel — Macau and Singapore integrated resorts.' },
      { symbol: 'CZR',  name: 'Caesars Entertainment',     note: 'Travel — Caesars Palace, Harrah\'s, regional casinos.' },
      { symbol: 'DKNG', name: 'DraftKings',                note: 'Travel — sports betting and DFS.' },
      { symbol: 'PENN', name: 'Penn Entertainment',        note: 'Travel — regional casinos + ESPN Bet.' },
      // Industrial / infrastructure:
      { symbol: 'HON',  name: 'Honeywell',                 note: 'Industrial — aerospace, building tech, performance materials.' },
      { symbol: 'MMM',  name: '3M',                        note: 'Industrial — diversified manufacturing (Post-it, Scotch).' },
      { symbol: 'ETN',  name: 'Eaton',                     note: 'Industrial — electrical components and power management.' },
      { symbol: 'EMR',  name: 'Emerson Electric',          note: 'Industrial — automation, climate, commercial controls.' },
      { symbol: 'PH',   name: 'Parker Hannifin',           note: 'Industrial — motion and control technologies.' },
      { symbol: 'CMI',  name: 'Cummins',                   note: 'Industrial — diesel and natural-gas engines.' },
      { symbol: 'URI',  name: 'United Rentals',            note: 'Industrial — equipment rental leader.' },
      { symbol: 'PCAR', name: 'PACCAR',                    note: 'Industrial — Kenworth, Peterbilt, DAF heavy trucks.' },
      // Real estate (non-low-yield REITs):
      { symbol: 'AMT',  name: 'American Tower',            note: 'Real estate — wireless communication towers (REIT).' },
      { symbol: 'CCI',  name: 'Crown Castle',              note: 'Real estate — towers and fiber (REIT).' },
      { symbol: 'PLD',  name: 'Prologis',                  note: 'Real estate — global industrial / warehouse leader (REIT).' },
      { symbol: 'EQIX', name: 'Equinix',                   note: 'Real estate — data center colocation REIT.' },
      { symbol: 'DLR',  name: 'Digital Realty',            note: 'Real estate — data center REIT.' },
      { symbol: 'AVB',  name: 'AvalonBay Communities',     note: 'Real estate — apartment REIT.' },
      { symbol: 'EQR',  name: 'Equity Residential',        note: 'Real estate — apartment REIT.' },
      { symbol: 'SPG',  name: 'Simon Property Group',      note: 'Real estate — premium mall REIT.' },
      { symbol: 'VICI', name: 'VICI Properties',           note: 'Real estate — gaming / experiential REIT (Caesars triple-net).' },
      { symbol: 'WELL', name: 'Welltower',                 note: 'Real estate — senior-housing REIT.' },
      { symbol: 'PSA',  name: 'Public Storage',            note: 'Real estate — self-storage REIT leader.' },
      { symbol: 'EXR',  name: 'Extra Space Storage',       note: 'Real estate — self-storage REIT.' },
      { symbol: 'IRM',  name: 'Iron Mountain',             note: 'Real estate — records storage and data centers (REIT).' },
      // Logistics / freight rail:
      { symbol: 'UPS',  name: 'United Parcel Service',     note: 'Logistics — global parcel and freight delivery.' },
      { symbol: 'FDX',  name: 'FedEx',                     note: 'Logistics — global express, ground, freight.' },
      { symbol: 'CHRW', name: 'C.H. Robinson',             note: 'Logistics — third-party logistics broker.' },
      { symbol: 'JBHT', name: 'J.B. Hunt Transport',       note: 'Logistics — intermodal and trucking.' },
      { symbol: 'KNX',  name: 'Knight-Swift Transportation', note: 'Logistics — largest US trucking fleet.' },
      { symbol: 'ODFL', name: 'Old Dominion Freight Line', note: 'Logistics — less-than-truckload freight.' },
      { symbol: 'XPO',  name: 'XPO Inc.',                  note: 'Logistics — less-than-truckload freight.' },
      { symbol: 'UNP',  name: 'Union Pacific',             note: 'Rail — Western US Class I railroad.' },
      { symbol: 'CSX',  name: 'CSX Corporation',           note: 'Rail — Eastern US Class I railroad.' },
      { symbol: 'NSC',  name: 'Norfolk Southern',          note: 'Rail — Eastern US Class I railroad.' },
      { symbol: 'CNI',  name: 'Canadian National Railway', note: 'Rail — Canadian transcontinental Class I railroad.' },
      { symbol: 'CP',   name: 'Canadian Pacific Kansas City', note: 'Rail — Canada–US–Mexico Class I railroad.' },
      // Materials & metals:
      { symbol: 'NEM',  name: 'Newmont',                   note: 'Materials — largest US gold miner.' },
      { symbol: 'FCX',  name: 'Freeport-McMoRan',          note: 'Materials — copper and gold mining.' },
      { symbol: 'LIN',  name: 'Linde',                     note: 'Materials — industrial and specialty gases.' },
      { symbol: 'APD',  name: 'Air Products & Chemicals',  note: 'Materials — industrial gases.' },
      { symbol: 'SHW',  name: 'Sherwin-Williams',          note: 'Materials — paints and coatings.' },
      { symbol: 'PPG',  name: 'PPG Industries',            note: 'Materials — paints and specialty coatings.' },
      { symbol: 'VMC',  name: 'Vulcan Materials',          note: 'Materials — construction aggregates (crushed stone).' },
      { symbol: 'MLM',  name: 'Martin Marietta Materials', note: 'Materials — construction aggregates.' },
      { symbol: 'NUE',  name: 'Nucor',                     note: 'Materials — largest US steel producer.' },
      { symbol: 'STLD', name: 'Steel Dynamics',            note: 'Materials — US mini-mill steelmaker.' },
      { symbol: 'CLF',  name: 'Cleveland-Cliffs',          note: 'Materials — flat-rolled steel and iron ore.' },
      { symbol: 'X',    name: 'United States Steel',       note: 'Materials — US Steel (pending Nippon Steel acquisition).' },
      { symbol: 'AA',   name: 'Alcoa',                     note: 'Materials — aluminum producer.' },
      // Quantum computing:
      { symbol: 'IONQ', name: 'IonQ',                      note: 'Quantum — trapped-ion quantum computing.' },
      { symbol: 'RGTI', name: 'Rigetti Computing',         note: 'Quantum — superconducting quantum processors.' },
      { symbol: 'QBTS', name: 'D-Wave Quantum',            note: 'Quantum — quantum annealing systems.' },
      { symbol: 'QUBT', name: 'Quantum Computing Inc.',    note: 'Quantum — photonic quantum systems.' },
      // Space:
      { symbol: 'RKLB', name: 'Rocket Lab',                note: 'Space — small-launch rockets (Electron) and Neutron in development.' },
      { symbol: 'ASTS', name: 'AST SpaceMobile',           note: 'Space — direct-to-cell satellite broadband.' },
      { symbol: 'LUNR', name: 'Intuitive Machines',        note: 'Space — lunar landers (NASA CLPS contracts).' },
      { symbol: 'PL',   name: 'Planet Labs',               note: 'Space — daily Earth-imaging satellite constellation.' },
      { symbol: 'SPCE', name: 'Virgin Galactic',           note: 'Space — suborbital tourism flights.' },
      { symbol: 'MNTS', name: 'Momentus',                  note: 'Space — in-space transportation services.' },
      { symbol: 'BKSY', name: 'BlackSky Technology',       note: 'Space — high-revisit Earth observation satellites.' },
      // Genomic biotech:
      { symbol: 'CRSP', name: 'CRISPR Therapeutics',       note: 'Biotech — CRISPR/Cas9 gene-editing therapies (Casgevy approved).' },
      { symbol: 'NTLA', name: 'Intellia Therapeutics',     note: 'Biotech — in vivo CRISPR gene editing.' },
      { symbol: 'BEAM', name: 'Beam Therapeutics',         note: 'Biotech — base editing platform.' },
      { symbol: 'EDIT', name: 'Editas Medicine',           note: 'Biotech — CRISPR gene-editing pipeline.' },
      { symbol: 'DNA',  name: 'Ginkgo Bioworks',           note: 'Biotech — synthetic biology cell-programming platform.' },
      { symbol: 'PACB', name: 'Pacific Biosciences',       note: 'Biotech — long-read DNA sequencing.' },
      { symbol: 'ILMN', name: 'Illumina',                  note: 'Biotech — DNA sequencing market leader.' },
      // Midstream / pipeline MLPs (oil & gas transport, high yields):
      { symbol: 'ET',   name: 'Energy Transfer',            note: 'Midstream — pipelines and storage MLP, quarterly distribution.' },
      { symbol: 'KMI',  name: 'Kinder Morgan',              note: 'Midstream — North American natural-gas pipeline operator.' },
      { symbol: 'PAA',  name: 'Plains All American',        note: 'Midstream — crude oil pipelines and storage MLP.' },
      { symbol: 'AM',   name: 'Antero Midstream',           note: 'Midstream — Appalachian gas gathering and water services.' },
      { symbol: 'KGS',  name: 'Kodiak Gas Services',        note: 'Midstream — contracted natural-gas compression services.' },
      // Royalty trusts (passive oil & gas income, monthly distributions):
      { symbol: 'PBT',  name: 'Permian Basin Royalty Trust',note: 'Royalty trust — Permian basin oil & gas, monthly distributions.' },
      { symbol: 'BPT',  name: 'BP Prudhoe Bay Royalty Trust',note: 'Royalty trust — Alaskan North Slope oil royalties.' },
      { symbol: 'CRT',  name: 'Cross Timbers Royalty Trust',note: 'Royalty trust — Texas/Oklahoma/New Mexico oil & gas.' },
      { symbol: 'MVO',  name: 'MV Oil Trust',               note: 'Royalty trust — Kansas/Colorado conventional oil.' },
      // Closed-end funds (high-distribution income vehicles):
      { symbol: 'PDO',  name: 'PIMCO Dynamic Income Opp',   note: 'Fund — PIMCO Dynamic Income Opps (multi-sector bond CEF, monthly).' },
      { symbol: 'PHK',  name: 'PIMCO High Income Fund',     note: 'Fund — PIMCO High Income (high-yield bond CEF, monthly).' },
      { symbol: 'HYT',  name: 'BlackRock Corporate High Yield', note: 'Fund — BlackRock High Yield (junk-bond CEF, monthly).' },
      { symbol: 'JFR',  name: 'Nuveen Floating Rate Income',note: 'Fund — Nuveen Floating Rate (senior loan CEF, monthly).' },
      { symbol: 'DSL',  name: 'DoubleLine Income Solutions',note: 'Fund — DoubleLine multi-sector income CEF, monthly.' },
      { symbol: 'BGT',  name: 'BlackRock Floating Rate',    note: 'Fund — BlackRock Floating Rate Income Strategy CEF.' },
      // Foreign-bank ADRs (cheap shares + real dividends):
      { symbol: 'BBVA', name: 'Banco Bilbao Vizcaya Argentaria', note: 'Foreign bank — BBVA (Spanish multinational, semi-annual dividend).' },
      { symbol: 'SAN',  name: 'Banco Santander',            note: 'Foreign bank — Santander (Spain, semi-annual dividend).' },
      { symbol: 'LYG',  name: 'Lloyds Banking Group',       note: 'Foreign bank — Lloyds (UK retail bank, semi-annual dividend).' },
      { symbol: 'ING',  name: 'ING Groep',                  note: 'Foreign bank — ING (Dutch retail and commercial bank).' },
      { symbol: 'DB',   name: 'Deutsche Bank',              note: 'Foreign bank — Deutsche Bank (German, ADR).' },
      { symbol: 'VOD',  name: 'Vodafone Group',             note: 'Telecom — Vodafone (UK wireless, semi-annual dividend).' },
      { symbol: 'ITUB', name: 'Itaú Unibanco',              note: 'Foreign bank — Itaú (largest Brazilian bank).' },
      // Dry-bulk shipping (cyclical, but pay big when freight rates rise):
      { symbol: 'SBLK', name: 'Star Bulk Carriers',         note: 'Shipping — dry-bulk fleet, variable quarterly dividend.' },
      { symbol: 'GOGL', name: 'Golden Ocean Group',         note: 'Shipping — dry-bulk fleet, quarterly distributions.' },
      // More regional banks:
      { symbol: 'FNB',  name: 'F.N.B. Corporation',         note: 'Bank — Pittsburgh-based regional bank.' },
      { symbol: 'VLY',  name: 'Valley National Bancorp',    note: 'Bank — New Jersey-based regional bank.' },
      // Other under-$20 dividend payers:
      { symbol: 'VGR',  name: 'Vector Group',               note: 'Tobacco — Liggett (4th-largest US cigarette maker), high dividend.' },
      { symbol: 'GNW',  name: 'Genworth Financial',         note: 'Insurance — life and long-term-care insurance.' },
      // Under-$20 non-dividend / speculative — apparel, telecom, hydrogen,
      // meme retail, crypto miners, cannabis, real-estate tech, biotech,
      // airlines, solar. Higher beta than the names above; many pre-profit
      // or cyclical. Tagged by their natural chip via the `Xxx —` prefix.
      { symbol: 'HBI',  name: 'Hanesbrands',                note: 'Retail — basics and innerwear (Hanes, Champion).' },
      { symbol: 'AEO',  name: 'American Eagle Outfitters',  note: 'Retail — apparel (American Eagle, Aerie).' },
      { symbol: 'GAP',  name: 'Gap Inc',                    note: 'Retail — Gap, Old Navy, Banana Republic, Athleta.' },
      { symbol: 'GME',  name: 'GameStop',                   note: 'Retail — video-game retailer, meme-stock template.' },
      { symbol: 'ERIC', name: 'Ericsson',                   note: 'Telecom — 5G network equipment (Swedish, ADR).' },
      { symbol: 'NOK',  name: 'Nokia',                      note: 'Telecom — network equipment, fixed and mobile broadband.' },
      { symbol: 'PLUG', name: 'Plug Power',                 note: 'Energy — hydrogen fuel cells and electrolyzers.' },
      { symbol: 'RIOT', name: 'Riot Platforms',             note: 'Crypto — Bitcoin mining (Texas-based hashrate).' },
      { symbol: 'MARA', name: 'Marathon Digital',           note: 'Crypto — Bitcoin mining operations.' },
      { symbol: 'TLRY', name: 'Tilray Brands',              note: 'Cannabis — Canadian cannabis + beverages.' },
      { symbol: 'CGC',  name: 'Canopy Growth',              note: 'Cannabis — Canadian cannabis producer.' },
      { symbol: 'OPEN', name: 'Opendoor Technologies',      note: 'REIT-Like — algorithmic residential home buying.' },
      { symbol: 'NVAX', name: 'Novavax',                    note: 'Biotech — protein-based COVID and seasonal-flu vaccines.' },
      { symbol: 'JBLU', name: 'JetBlue Airways',            note: 'Travel — US low-cost airline.' },
      { symbol: 'CSIQ', name: 'Canadian Solar',             note: 'Energy — solar modules and project development.' },
      { symbol: 'SHLS', name: 'Shoals Technologies',        note: 'Energy — electrical balance-of-system for utility-scale solar.' },
      // Another under-$20 wave — telehealth, China-listed consumer
      // names, gold/silver, BTC miners, fuel cells, shipping, classic
      // consumer brands. Tagged by their chip via the `Xxx —` prefix.
      { symbol: 'HIMS', name: 'Hims & Hers Health',         note: 'Healthcare — direct-to-consumer telehealth (sexual health, weight loss, mental).' },
      { symbol: 'TDOC', name: 'Teladoc Health',             note: 'Healthcare — virtual-care platform (primary care, mental health, chronic).' },
      { symbol: 'AMWL', name: 'American Well',              note: 'Healthcare — enterprise telehealth platform for health systems.' },
      { symbol: 'TAK',  name: 'Takeda Pharmaceutical',      note: 'Pharma — Japanese big-pharma, oncology and rare diseases (ADR).' },
      { symbol: 'BHC',  name: 'Bausch Health',              note: 'Pharma — diversified specialty pharma (eye care, GI, dermatology).' },
      { symbol: 'GRAB', name: 'Grab Holdings',              note: 'Tech — Southeast-Asia super-app (ride-hailing, delivery, fintech).' },
      { symbol: 'SNAP', name: 'Snap Inc',                   note: 'Entertainment — Snapchat camera and AR platform.' },
      { symbol: 'PTON', name: 'Peloton Interactive',        note: 'Retail — connected fitness hardware and subscription content.' },
      { symbol: 'VIPS', name: 'Vipshop Holdings',           note: 'China — online discount apparel and beauty retailer.' },
      { symbol: 'TME',  name: 'Tencent Music Entertainment',note: 'Entertainment — China music streaming (QQ, Kugou, Kuwo).' },
      { symbol: 'COTY', name: 'Coty Inc',                   note: 'Retail — cosmetics and fragrance brands (CoverGirl, Rimmel, licensed luxury).' },
      { symbol: 'GOLD', name: 'Barrick Gold',               note: 'Mining — global gold miner (one of the world\'s largest by output).' },
      { symbol: 'FCEL', name: 'FuelCell Energy',            note: 'Energy — stationary fuel-cell power plants.' },
      { symbol: 'BE',   name: 'Bloom Energy',               note: 'Energy — solid-oxide fuel cells for on-site distributed power.' },
      { symbol: 'AMRC', name: 'Ameresco',                   note: 'Energy — energy-efficiency services and on-site renewables.' },
      { symbol: 'CLSK', name: 'CleanSpark',                 note: 'Crypto — Bitcoin mining (US-based, low-cost hashrate).' },
      { symbol: 'WULF', name: 'TeraWulf',                   note: 'Crypto — Bitcoin mining + AI-compute hosting.' },
      { symbol: 'ZIM',  name: 'ZIM Integrated Shipping',    note: 'Shipping — Israeli container shipping (asset-light, charter model).' },
      { symbol: 'TRIP', name: 'Tripadvisor',                note: 'Travel — travel-planning marketplace and reviews.' },
      { symbol: 'MAT',  name: 'Mattel',                     note: 'Retail — toy and brand IP company (Barbie, Hot Wheels, Fisher-Price).' },
      // ── Under-$20 coverage by chip ────────────────────────────────────
      // Filling gaps where the chip filter had <5 sub-$20 names. Some
      // chips (utility, tobacco, cybersecurity, logistics) are inherently
      // large-cap dominated; we add what's available and accept the
      // shortfall rather than reaching for illiquid micro-caps.

      // AI — voice / vision / defense AI smaller caps.
      { symbol: 'SOUN', name: 'SoundHound AI',              note: 'AI — voice and conversational AI for autos, restaurants, IoT.' },
      { symbol: 'BBAI', name: 'BigBear.ai',                 note: 'AI — defense and intelligence analytics.' },
      { symbol: 'VERI', name: 'Veritone',                   note: 'AI — applied AI for media, public sector, energy.' },
      { symbol: 'WIMI', name: 'WiMi Hologram Cloud',        note: 'AI — Chinese AR / hologram and AI vision (ADR).' },

      // Auto — legacy ADRs and motorcycles (sub-$20 spectrum thin; most
      // names are EV/in-EV chip).
      { symbol: 'STLA', name: 'Stellantis',                 note: 'Auto — Chrysler/Peugeot/Fiat parent (Dutch ADR).' },
      { symbol: 'VWAGY',name: 'Volkswagen',                 note: 'Auto — German automaker (ADR).' },
      { symbol: 'NSANY',name: 'Nissan Motor',               note: 'Auto — Japanese automaker (ADR).' },
      { symbol: 'POAHY',name: 'Porsche Automobil Holding',  note: 'Auto — Porsche / VW holding company (ADR).' },

      // Chemicals — specialty and basic chemicals smaller caps.
      { symbol: 'TROX', name: 'Tronox Holdings',            note: 'Chemicals — titanium-dioxide pigment producer.' },
      { symbol: 'ASIX', name: 'AdvanSix',                   note: 'Chemicals — nylon, ammonium sulfate, chemical intermediates.' },
      { symbol: 'OLN',  name: 'Olin',                       note: 'Chemicals — chlor-alkali + Winchester ammunition.' },
      { symbol: 'MEOH', name: 'Methanex',                   note: 'Chemicals — world\'s largest methanol producer.' },

      // Cybersecurity — most cyber names trade $30+; here are the
      // legitimate sub-$20 options.
      { symbol: 'OSPN', name: 'OneSpan',                    note: 'Cybersecurity — identity authentication and anti-fraud.' },
      { symbol: 'ATEN', name: 'A10 Networks',               note: 'Cybersecurity — application delivery and DDoS protection.' },
      { symbol: 'KSCP', name: 'Knightscope',                note: 'Cybersecurity — autonomous physical-security robots.' },

      // Farming — small-cap producers and food-supply names.
      { symbol: 'LND',  name: 'BrasilAgro',                 note: 'Farming — Brazilian sugarcane, grains, and cattle (ADR).' },
      { symbol: 'AVO',  name: 'Mission Produce',            note: 'Farming — global avocado grower and distributor.' },
      { symbol: 'DOLE', name: 'Dole plc',                   note: 'Farming — global fresh fruit and vegetables.' },
      { symbol: 'LMNR', name: 'Limoneira',                  note: 'Farming — California citrus grower (lemons, oranges).' },
      { symbol: 'VFF',  name: 'Village Farms International',note: 'Farming — greenhouse vegetable and cannabis grower.' },

      // Fintech — payments, lending, and consumer fintech smaller caps.
      { symbol: 'WU',   name: 'Western Union',              note: 'Fintech — cross-border money transfer.' },
      { symbol: 'LU',   name: 'Lufax Holding',              note: 'Fintech — Chinese personal lending platform (ADR).' },
      { symbol: 'OPRT', name: 'Oportun Financial',          note: 'Fintech — small-dollar lending for underbanked consumers.' },
      { symbol: 'LMND', name: 'Lemonade',                   note: 'Fintech — AI-driven insurance platform (renters, pet, home).' },

      // Food — restaurants and packaged-food smaller caps.
      { symbol: 'WEN',  name: 'Wendy\'s',                   note: 'Food — fast-food burger chain.' },
      { symbol: 'DENN', name: 'Denny\'s',                   note: 'Food — family-dining restaurant chain.' },
      { symbol: 'DNUT', name: 'Krispy Kreme',               note: 'Food — donut retail and wholesale.' },
      { symbol: 'NOMD', name: 'Nomad Foods',                note: 'Food — European frozen-food brands (Birds Eye, Findus).' },
      { symbol: 'BLMN', name: 'Bloomin\' Brands',           note: 'Food — Outback Steakhouse, Carrabba\'s, Bonefish Grill.' },

      // Insurance — life, P&C, and insurtech sub-$20.
      { symbol: 'AMBC', name: 'Ambac Financial',            note: 'Insurance — financial guarantee and specialty P&C.' },
      { symbol: 'IGIC', name: 'International General Insurance', note: 'Insurance — specialty commercial insurance and reinsurance.' },
      { symbol: 'NODK', name: 'NI Holdings',                note: 'Insurance — Midwest P&C (auto, crop, non-standard).' },

      // Logistics — sub-$20 is genuinely thin; here are the real options.
      { symbol: 'HTLD', name: 'Heartland Express',          note: 'Logistics — short-to-medium-haul truckload carrier.' },
      { symbol: 'ATSG', name: 'Air Transport Services Group', note: 'Logistics — air-cargo aircraft leasing and operations.' },
      { symbol: 'PANL', name: 'Pangaea Logistics Solutions',note: 'Logistics — ice-class dry-bulk shipping.' },

      // REIT-Like — real-estate operating companies and tech platforms.
      { symbol: 'RDFN', name: 'Redfin',                     note: 'REIT-Like — tech-driven residential brokerage.' },
      { symbol: 'COMP', name: 'Compass',                    note: 'REIT-Like — residential brokerage tech platform.' },
      { symbol: 'EXPI', name: 'eXp World Holdings',         note: 'REIT-Like — cloud-based residential brokerage.' },

      // Software — most software is $30+; here are sub-$20 names.
      { symbol: 'DOMO', name: 'Domo',                       note: 'Software — business intelligence and data analytics.' },
      { symbol: 'NRDS', name: 'NerdWallet',                 note: 'Software — personal-finance comparison platform.' },
      { symbol: 'MGNI', name: 'Magnite',                    note: 'Software — sell-side ad tech for CTV and digital.' },

      // Staples — household and packaged-goods sub-$20.
      { symbol: 'NWL',  name: 'Newell Brands',              note: 'Staples — Rubbermaid, Sharpie, Yankee Candle, Coleman.' },
      { symbol: 'HLF',  name: 'Herbalife',                  note: 'Staples — nutrition shakes and supplements (MLM model).' },
      { symbol: 'HAIN', name: 'Hain Celestial',             note: 'Staples — organic packaged food (Celestial Seasonings, Terra).' },
      { symbol: 'MED',  name: 'Medifast',                   note: 'Staples — meal-replacement weight-management products.' },
      { symbol: 'WW',   name: 'WW International',           note: 'Staples — WeightWatchers digital + GLP-1 services.' },

      // Tech — sub-$20 tech is mostly ADRs and Chinese names.
      { symbol: 'WIT',  name: 'Wipro',                      note: 'Tech — Indian IT services (ADR).' },
      { symbol: 'IQ',   name: 'iQIYI',                      note: 'Tech — Chinese video streaming, Baidu-affiliated (ADR).' },
      { symbol: 'WB',   name: 'Weibo',                      note: 'Tech — Chinese microblogging social network (ADR).' },
      { symbol: 'HUYA', name: 'HUYA',                       note: 'Tech — Chinese live-streaming video platform (ADR).' },
      { symbol: 'CNDT', name: 'Conduent',                   note: 'Tech — business-process services and digital platforms.' },

      // Tobacco — sub-$20 is rare; legitimate options:
      { symbol: 'TPB',  name: 'Turning Point Brands',       note: 'Tobacco — Zig-Zag papers, Stoker\'s smokeless, vapor.' },
      { symbol: 'XXII', name: '22nd Century Group',         note: 'Tobacco — reduced-nicotine cigarettes (FDA-authorized).' },

      // Utility — most US utilities are $30+; sub-$20 picks:
      { symbol: 'PCG',  name: 'PG&E',                       note: 'Utility — California electric and gas (post-bankruptcy recovery).' },
      { symbol: 'AES',  name: 'AES Corporation',            note: 'Utility — global electric utility with heavy renewables transition.' },
      { symbol: 'AT',   name: 'Atlantica Sustainable Infrastructure', note: 'Utility — renewables, transmission, water YieldCo.' },
      { symbol: 'GNE',  name: 'Genie Energy',               note: 'Utility — retail electricity and natural gas reseller.' },

      // Pharma — additional sub-$20 names beyond VTRS/BHC/TAK.
      { symbol: 'AKBA', name: 'Akebia Therapeutics',        note: 'Pharma — anemia therapies for chronic kidney disease.' },
      { symbol: 'MNKD', name: 'MannKind',                   note: 'Pharma — inhaled insulin (Afrezza) and pulmonary platform.' },
      { symbol: 'IRWD', name: 'Ironwood Pharmaceuticals',   note: 'Pharma — GI franchise (Linzess for IBS-C).' },

      // Industrial — sub-$20 industrials.
      { symbol: 'GTES', name: 'Gates Industrial',           note: 'Industrial — power-transmission belts and fluid-power hoses.' },
      { symbol: 'EVTC', name: 'Evertec',                    note: 'Industrial — Puerto Rico payment processing and IT services.' },
      { symbol: 'ATKR', name: 'Atkore',                     note: 'Industrial — electrical conduit, cables, and metal framing.' },
    ],
  },
  {
    id: 'crypto',
    label: 'Crypto',
    benchmark: 'BTCUSD',
    stocks: [
      { symbol: 'BTCUSD', name: 'Bitcoin', note: 'The original cryptocurrency.' },
      { symbol: 'ETHUSD', name: 'Ethereum', note: 'Largest smart-contract platform.' },
      { symbol: 'SOLUSD', name: 'Solana', note: 'High-throughput layer-1 chain.' },
      { symbol: 'DOGEUSD', name: 'Dogecoin', note: 'Meme-driven cryptocurrency.' },
    ],
  },
];

// Approximate holdings count per ETF, expressed as a display string with
// the right unit ("stocks", "bonds", "coin", "physical metal", etc.). These
// drift as funds rebalance so they're rounded; symbols not in the map render
// no badge.
// Dividend Kings — companies with 50+ consecutive years of dividend
// increases. Used by the "Top tier — Kings" sub-filter on the Dividend
// payers tab. Verified against publicly-tracked king lists; a few
// aristocrats just under 50 years (MCD ~49y, ABBV split history) are
// intentionally excluded.
const DIVIDEND_KINGS = new Set<string>([
  'KO', 'PEP', 'PG', 'KMB', 'JNJ', 'LOW', 'WMT',
  'DOV', 'EMR', 'PH', 'ITW', 'HRL', 'GPC', 'NDSN', 'ED', 'TGT',
  'AWR', 'CWT', 'FRT', 'BKH', 'LANC', 'NFG', 'ABM', 'SJW', 'GRC',
  'ABT', 'CL', 'CINF', 'GWW', 'NUE', 'PPG', 'SPGI', 'SWK', 'SYY',
]);

// Dividend Aristocrats — S&P 500 companies with 25+ consecutive years of
// dividend increases. Superset of Kings (every King is also an
// Aristocrat). Used by the "Top tier — Aristocrats" sub-filter.
const DIVIDEND_ARISTOCRATS = new Set<string>([
  // All Kings count as Aristocrats
  ...Array.from(DIVIDEND_KINGS),
  // 25-49 year aristocrats not yet in Kings
  'ADP', 'AFL', 'AOS', 'ATO', 'BDX', 'BEN', 'BRO', 'CAH', 'CHRW', 'CLX',
  'CTAS', 'ECL', 'ESS', 'EXPD', 'FAST', 'GD', 'LIN', 'MCD', 'MDT', 'MKC',
  'NEE', 'PNR', 'ROP', 'RTX', 'SHW', 'SJM', 'TROW', 'WST', 'CAT', 'CB',
  'CHD', 'CVX', 'XOM', 'IBM',
]);

// Logo.dev — public-key API for company logos. Token comes from
// VITE_LOGO_DEV_TOKEN in frontend/.env (gitignored). Free tier requires
// the "Logos by Logo.dev" attribution link in the footer.
const LOGO_DEV_TOKEN = (import.meta.env.VITE_LOGO_DEV_TOKEN as string | undefined) || '';
function logoUrlFor(symbol: string, size = 64): string {
  if (!LOGO_DEV_TOKEN || !symbol) return '';
  // Crypto pairs (BTCUSD/ETHUSD/etc.) and synthetic suffixes don't have
  // company logos — skip the round-trip.
  if (/USD$/.test(symbol)) return '';
  return `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${LOGO_DEV_TOKEN}&size=${size}&format=png`;
}

// Sample the top-K *vivid* colors from a logo image, ranked by weighted
// pixel count. Skips near-transparent, near-grayscale, and near-extreme
// pixels (so heavy black/white backgrounds don't dominate the picks)
// and weights surviving pixels by saturation. Returns the ranked hex
// list — most-prominent first — or `null` on canvas/network failure.
function sampleLogoDominantColors(url: string, topK = 6): Promise<string[] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map<string, number>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const lightness = (max + min) / 2;
          if (lightness < 25 || lightness > 235) continue;
          const sat = max === 0 ? 0 : (max - min) / max;
          if (sat < 0.20) continue;
          const qr = Math.round(r / 32) * 32;
          const qg = Math.round(g / 32) * 32;
          const qb = Math.round(b / 32) * 32;
          const key = `${qr},${qg},${qb}`;
          buckets.set(key, (buckets.get(key) || 0) + (1 + sat * 3));
        }
        if (buckets.size === 0) { resolve(null); return; }
        const ranked = Array.from(buckets.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, topK)
          .map(([key]) => {
            const [r, g, b] = key.split(',').map(Number);
            return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
          });
        resolve(ranked);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Module-level cache keyed by ticker symbol. Stores the ranked palette so
// the chart can walk down the list when its top pick collides with a
// color already claimed by another slice.
const logoColorCache = new Map<string, string[]>();

// Bucket a hex into the same 32-step quantization the sampler uses so two
// near-identical sampled colors hash to the same key — that's what makes
// "is this color already taken by another slice" robust against minor
// per-logo PNG variance.
function quantizeHex(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
}

// Brokerage hero-stack — curated unique-logo cross-section that scrolls
// across the brokerage page under the subtitle. Mostly individual stocks
// because Logo.dev returns the *issuer*'s logo for ETFs (so all 11 SPDR
// sector ETFs share the same State Street logo, all Vanguard ETFs share
// one Vanguard logo, etc.) — only one ETF per major issuer is included
// to keep every visible logo distinct.
const BROKERAGE_HERO_STACK: string[] = [
  // Mega-caps
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  // One ETF per major issuer — each issuer brand reads as a distinct logo
  'SPY',  // SPDR / State Street
  'VOO',  // Vanguard
  'IVV',  // iShares / BlackRock
  'QQQ',  // Invesco
  'SCHD', // Schwab
  'JEPI', // JPMorgan
  'FBTC', // Fidelity
  'USO',  // US Commodity Funds
  // Major banks & financials
  'JPM', 'BAC', 'WFC', 'GS', 'C', 'MS', 'USB', 'SCHW', 'BLK', 'COF', 'AXP', 'DFS',
  // Insurance
  'PGR', 'TRV', 'CB', 'AIG', 'MET', 'PRU', 'ALL', 'AON', 'MMC',
  // Tech & software
  'ORCL', 'CRM', 'ADBE', 'NOW', 'INTU', 'AMD', 'AVGO', 'PLTR', 'PANW', 'SNOW',
  'IBM', 'CSCO', 'WDAY', 'TEAM', 'ZM', 'SHOP', 'UBER', 'LYFT', 'DASH',
  // Semis
  'TSM', 'INTC', 'MU', 'QCOM', 'ARM',
  // Dividend Kings
  'KO', 'PG', 'JNJ', 'WMT', 'LOW', 'TGT', 'ABT', 'MCD', 'PEP', 'CL',
  'CINF', 'GWW', 'NUE', 'PPG', 'SPGI',
  // Aristocrats
  'ADP', 'MMM', 'CAT', 'CVX', 'XOM', 'CHRW', 'MDT', 'NEE', 'SHW', 'LIN',
  // Consumer brands
  'COST', 'NKE', 'SBUX', 'DIS', 'BKNG', 'ABNB', 'HD', 'V', 'MA', 'KMB',
  'GIS', 'KHC', 'HSY', 'LULU', 'CMG', 'DPZ', 'YUM',
  // Hospitality
  'MAR', 'HLT', 'WYNN', 'LVS', 'MGM',
  // Tobacco
  'MO', 'PM', 'BUD',
  // Industrials & defense
  'BA', 'DE', 'HON', 'UNP', 'LMT', 'NOC', 'RTX', 'GD',
  // Energy & utilities
  'COP', 'EOG', 'OXY', 'SLB', 'MPC', 'DUK', 'SO',
  // Healthcare services
  'UNH', 'CVS', 'CI', 'HUM', 'ELV', 'HCA',
  // Pharma
  'PFE', 'LLY', 'MRK', 'BMY', 'GILD', 'AMGN', 'AZN',
  // Auto & EV
  'F', 'GM', 'RIVN', 'LCID', 'HMC', 'TM',
  // Entertainment & media
  'NFLX', 'SPOT', 'ROKU', 'EA', 'TTWO', 'WBD', 'PARA',
  // Telecom
  'T', 'VZ', 'TMUS',
  // Fintech & payments
  'PYPL', 'SQ', 'COIN', 'HOOD', 'SOFI',
  // Modern themes — space, quantum, betting
  'RKLB', 'IONQ', 'ASTS', 'DKNG', 'RGTI', 'ENPH', 'FSLR',
  // China ADRs
  'BABA', 'JD', 'PDD', 'NIO', 'XPEV', 'BIDU',
  // REITs
  'O', 'AMT', 'PLD', 'EQIX', 'SPG',
  // Exchanges & financial data
  'ICE', 'CME', 'NDAQ', 'MCO', 'MSCI',
];

// Bottom-strip ticker symbols. Mix of broad-market index ETFs and well-
// known large-caps so the user sees a representative cross-section of
// "what the market is doing" at all times. Order is approximately the
// scroll order in the strip.
const TICKER_SYMBOLS: string[] = [
  'SPY', 'QQQ', 'DIA', 'VTI', 'IWM',
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  'JPM', 'V', 'BAC', 'WMT', 'XOM', 'JNJ', 'KO', 'DIS',
  'NFLX', 'AMD', 'NKE', 'MCD', 'ORCL',
];

const ETF_HOLDINGS: Record<string, string> = {
  // Index ETFs
  SPY: '500 stocks', IVV: '500 stocks', VOO: '500 stocks', SPLG: '500 stocks',
  RSP: '500 stocks', QQQ: '100 stocks', QQQM: '100 stocks', DIA: '30 stocks',
  MDY: '400 stocks', IWB: '1,000 stocks', IWM: '2,000 stocks', IWV: '3,000 stocks',
  VTI: '3,700 stocks', ITOT: '3,000 stocks',
  // Dividend ETFs
  SCHD: '100 stocks', DVY: '100 stocks', QYLD: '100 stocks', SPHD: '50 stocks',
  SPYD: '80 stocks', VYM: '440 stocks', VIG: '310 stocks', DGRO: '410 stocks',
  NOBL: '67 stocks', HDV: '75 stocks', JEPI: '120 stocks', JEPQ: '80 stocks',
  DIVO: '22 stocks', XYLD: '500 stocks', RYLD: '2,000 stocks',
  // Sector ETFs
  XLE: '22 stocks', XLC: '22 stocks', XLB: '28 stocks', XLU: '30 stocks',
  XLRE: '30 stocks', XLP: '38 stocks', XLY: '50 stocks', XLV: '60 stocks',
  XLK: '70 stocks', XLF: '70 stocks', XLI: '75 stocks', SOXX: '30 stocks',
  SMH: '25 stocks', IGV: '120 stocks', IBB: '270 stocks', KRE: '140 stocks',
  KBE: '100 stocks', ITA: '37 stocks', XAR: '37 stocks',
  // Bond ETFs
  AGG: '12,000 bonds', BND: '17,000 bonds', TLT: '40 bonds', IEF: '10 bonds',
  SHY: '80 bonds', BIL: '20 bonds', SGOV: '15 bonds', TIP: '50 bonds',
  LQD: '2,500 bonds', HYG: '1,200 bonds', JNK: '1,200 bonds', MUB: '5,000 bonds',
  EMB: '600 bonds', BNDX: '6,000 bonds',
  // International ETFs
  VXUS: '8,500 stocks', VEA: '4,000 stocks', IEFA: '2,800 stocks',
  ACWI: '2,300 stocks', EFA: '700 stocks', VWO: '5,500 stocks',
  IEMG: '3,000 stocks', EEM: '1,200 stocks', FXI: '50 stocks', MCHI: '600 stocks',
  KWEB: '30 stocks', EWJ: '230 stocks', INDA: '140 stocks', EWZ: '50 stocks',
  EWY: '110 stocks', EWT: '90 stocks', EWG: '60 stocks', EWU: '95 stocks',
  EWC: '95 stocks',
  // Commodity ETFs
  GLD: 'Physical gold', IAU: 'Physical gold', GLDM: 'Physical gold',
  SLV: 'Physical silver', SIVR: 'Physical silver', PPLT: 'Physical platinum',
  PALL: 'Physical palladium', USO: '1 future (WTI)', UNG: '1 future (natgas)',
  CPER: '1 future (copper)', DBC: '14 futures', PDBC: '14 futures',
  GDX: '50 miners', GDXJ: '80 miners', SIL: '40 miners', URA: '50 miners',
  // Crypto ETFs
  IBIT: '1 coin (BTC)', FBTC: '1 coin (BTC)', BITB: '1 coin (BTC)',
  ARKB: '1 coin (BTC)', GBTC: '1 coin (BTC)', BTCO: '1 coin (BTC)',
  HODL: '1 coin (BTC)', EZBC: '1 coin (BTC)', BRRR: '1 coin (BTC)',
  ETHA: '1 coin (ETH)', FETH: '1 coin (ETH)', ETHE: '1 coin (ETH)',
  ETHW: '1 coin (ETH)',
  // Thematic & factor ETFs
  ARKK: '35 stocks', ARKG: '30 stocks', ARKQ: '40 stocks', ARKW: '40 stocks',
  ARKF: '30 stocks', ICLN: '100 stocks', TAN: '40 stocks', LIT: '50 stocks',
  DRIV: '75 stocks', BOTZ: '45 stocks', AIQ: '85 stocks', CLOU: '35 stocks',
  HACK: '60 stocks', CIBR: '35 stocks', BLOK: '50 stocks', PAVE: '100 stocks',
  IBUY: '70 stocks', JETS: '50 stocks', MOO: '60 stocks', COWZ: '100 stocks',
  MOAT: '50 stocks', QUAL: '125 stocks', MTUM: '125 stocks', USMV: '180 stocks',
};

// Risk-tier classifications for ETFs. Conservative = broad index, quality
// dividends, investment-grade bonds, low-vol. Moderate = sector ETFs, large-cap,
// developed-market intl, mature dividend high-yielders. Aggressive = thematic,
// emerging/single-country, commodity, crypto, high-yield bonds, NAV-decay
// covered calls. Symbols not in the map render no badge.
// Tiering rule (so future additions stay consistent):
//   Conservative — broad/diversified, large-cap focus, investment-grade
//     bonds, dividend quality, low-vol factor. Historical max-drawdown
//     typically <30%; expected to hold up better in a recession.
//   Moderate     — single-index large-caps with concentration (Nasdaq,
//     Dow), sectors, developed-market intl, growth tilts, mid-caps.
//     30–45% drawdowns possible.
//   Aggressive   — small caps, emerging markets, single-country, thematic,
//     leveraged income, commodities, crypto, high-yield credit. 45%+
//     drawdowns expected at some point.
const ETF_RISK: Record<string, 'Conservative' | 'Moderate' | 'Aggressive'> = {
  // Conservative: S&P 500 (all four major trackers + low-cost SSGA)
  SPY: 'Conservative', IVV: 'Conservative', VOO: 'Conservative', SPLG: 'Conservative',
  RSP: 'Conservative',
  // Conservative: total US market
  VTI: 'Conservative', ITOT: 'Conservative', SCHB: 'Conservative',
  // Conservative: Russell large-cap, Dow, mega-cap value
  IWB: 'Conservative', IWV: 'Conservative', SCHX: 'Conservative', DIA: 'Conservative',
  IWD: 'Conservative', VTV: 'Conservative', MGV: 'Conservative',
  // Conservative: quality dividend payers
  SCHD: 'Conservative', VYM: 'Conservative', VIG: 'Conservative', DGRO: 'Conservative',
  NOBL: 'Conservative', HDV: 'Conservative',
  // Conservative: investment-grade & short-duration bonds
  AGG: 'Conservative', BND: 'Conservative', SHY: 'Conservative', BIL: 'Conservative',
  SGOV: 'Conservative', TIP: 'Conservative', LQD: 'Conservative', MUB: 'Conservative',
  BNDX: 'Conservative', IEF: 'Conservative',
  // Conservative: low-vol factor
  USMV: 'Conservative',
  // Moderate: tech/growth concentration (Nasdaq + growth tilts)
  QQQ: 'Moderate', QQQM: 'Moderate', ONEQ: 'Moderate',
  IWF: 'Moderate', VUG: 'Moderate', MGK: 'Moderate',
  // Moderate: mid-caps (more vol than large but more diversified than small)
  IWR: 'Moderate',
  // Moderate: sector ETFs
  XLK: 'Moderate', XLV: 'Moderate', XLF: 'Moderate', XLE: 'Moderate', XLI: 'Moderate',
  XLY: 'Moderate', XLP: 'Moderate', XLU: 'Moderate', XLB: 'Moderate', XLRE: 'Moderate',
  XLC: 'Moderate',
  // Moderate: developed-market intl + global all-cap
  VEA: 'Moderate', EFA: 'Moderate', IEFA: 'Moderate', SCHF: 'Moderate',
  VXUS: 'Moderate', IXUS: 'Moderate', ACWI: 'Moderate', VT: 'Moderate',
  // Moderate: dividend high-yield (mature names) + long Treasuries (rate risk)
  SPHD: 'Moderate', SPYD: 'Moderate', DVY: 'Moderate', DIVO: 'Moderate', JEPI: 'Moderate',
  TLT: 'Moderate',
  // Moderate: factor / quality
  MOAT: 'Moderate', QUAL: 'Moderate', COWZ: 'Moderate', MTUM: 'Moderate',
  // Aggressive: small/mid cap (small caps swing 1.3–1.5x the S&P)
  IWM: 'Aggressive', MDY: 'Aggressive', IJH: 'Aggressive', IJR: 'Aggressive',
  VB: 'Aggressive', SCHA: 'Aggressive', SCHM: 'Aggressive',
  // Aggressive: concentrated sector
  SOXX: 'Aggressive', SMH: 'Aggressive', IGV: 'Aggressive', IBB: 'Aggressive',
  KRE: 'Aggressive', KBE: 'Aggressive', ITA: 'Aggressive', XAR: 'Aggressive',
  // Aggressive: emerging markets & single country
  VWO: 'Aggressive', EEM: 'Aggressive', IEMG: 'Aggressive', FXI: 'Aggressive',
  MCHI: 'Aggressive', KWEB: 'Aggressive', INDA: 'Aggressive', EWZ: 'Aggressive',
  EWY: 'Aggressive', EWT: 'Aggressive', EWJ: 'Moderate', EWG: 'Moderate',
  EWU: 'Moderate', EWC: 'Moderate',
  // Aggressive: high-yield bonds
  HYG: 'Aggressive', JNK: 'Aggressive', EMB: 'Aggressive',
  // Aggressive: commodities
  GLD: 'Aggressive', IAU: 'Aggressive', GLDM: 'Aggressive', SLV: 'Aggressive',
  SIVR: 'Aggressive', PPLT: 'Aggressive', PALL: 'Aggressive', GDX: 'Aggressive',
  GDXJ: 'Aggressive', SIL: 'Aggressive', USO: 'Aggressive', UNG: 'Aggressive',
  DBC: 'Aggressive', PDBC: 'Aggressive', CPER: 'Aggressive', URA: 'Aggressive',
  // Aggressive: crypto
  IBIT: 'Aggressive', FBTC: 'Aggressive', BITB: 'Aggressive', ARKB: 'Aggressive',
  GBTC: 'Aggressive', BTCO: 'Aggressive', HODL: 'Aggressive', EZBC: 'Aggressive',
  BRRR: 'Aggressive', ETHA: 'Aggressive', FETH: 'Aggressive', ETHE: 'Aggressive',
  ETHW: 'Aggressive',
  // Aggressive: NAV-decay covered calls + Nasdaq income
  JEPQ: 'Aggressive', QYLD: 'Aggressive', XYLD: 'Aggressive', RYLD: 'Aggressive',
  // Aggressive: thematic
  ARKK: 'Aggressive', ARKG: 'Aggressive', ARKQ: 'Aggressive', ARKW: 'Aggressive',
  ARKF: 'Aggressive', ICLN: 'Aggressive', TAN: 'Aggressive', LIT: 'Aggressive',
  DRIV: 'Aggressive', BOTZ: 'Aggressive', AIQ: 'Aggressive', CLOU: 'Aggressive',
  HACK: 'Aggressive', CIBR: 'Aggressive', BLOK: 'Aggressive', PAVE: 'Aggressive',
  IBUY: 'Aggressive', JETS: 'Aggressive', MOO: 'Aggressive',
};

// "Pick a Coin 101" — primers and use-case picker.
type CoinPrimer = {
  ticker: string;
  name: string;
  oneliner: string;
  goodFor: string;
};

const COIN_PRIMERS: CoinPrimer[] = [
  {
    ticker: 'BTC',
    name: 'Bitcoin',
    oneliner: 'The original cryptocurrency. Hard-capped at 21M coins, ~16-year track record. Most often described as "digital gold."',
    goodFor: 'Long-term holding. Not for spending.',
  },
  {
    ticker: 'ETH',
    name: 'Ethereum',
    oneliner: 'The largest programmable-blockchain platform. Native currency for paying gas and running smart contracts.',
    goodFor: 'DeFi, NFTs, most on-chain apps.',
  },
  {
    ticker: 'USDC',
    name: 'USD Coin',
    oneliner: 'Stablecoin pegged 1:1 to the US dollar. Issued by Circle, audited monthly, redeemable.',
    goodFor: 'Holding "digital cash" without crypto volatility.',
  },
  {
    ticker: 'SOL',
    name: 'Solana',
    oneliner: 'High-throughput layer-1 blockchain. Sub-second blocks, sub-cent fees.',
    goodFor: 'Fast/cheap transactions, gaming, low-cost NFTs.',
  },
  {
    ticker: 'DOGE',
    name: 'Dogecoin',
    oneliner: 'Meme-driven coin that started as a joke and became culturally significant. Endorsed (and pumped) by Elon Musk.',
    goodFor: 'Speculation and entertainment. Not a serious store of value.',
  },
  {
    ticker: 'XMR',
    name: 'Monero',
    oneliner: 'Privacy-by-default cryptocurrency. Sender, recipient, and amount are all obscured on-chain.',
    goodFor: 'Financial privacy — but harder to acquire than the others.',
  },
];

type CoinUseCase = {
  purpose: string;
  scenario: string;
  primary: string;
  alternatives: string;
  why: string;
  watchOut: string;
};

const COIN_USE_CASES: CoinUseCase[] = [
  {
    purpose: 'Long-term store of value',
    scenario: '"I want to put funds away for 5+ years — digital gold."',
    primary: 'Bitcoin (BTC)',
    alternatives: 'A smaller allocation in Ethereum (ETH) for diversification.',
    why: 'Longest track record (since 2009), largest network effect, hard supply cap of 21M coins. The crypto most resistant to going to zero.',
    watchOut: 'Still volatile — 50%+ drawdowns in bear markets are normal. Only buy with money you genuinely won\'t need to touch for years.',
  },
  {
    purpose: 'DeFi, NFTs, and on-chain apps',
    scenario: '"I want to use Uniswap, OpenSea, lending protocols, anything DeFi."',
    primary: 'Ethereum (ETH)',
    alternatives: 'Solana (SOL) if speed and cost matter more than ecosystem size.',
    why: 'Ethereum has by far the most decentralized apps and the deepest liquidity. Almost every major DeFi protocol launched there first.',
    watchOut: 'Gas fees on Ethereum L1 can spike to $5–50 per transaction. Most active users actually transact on L2s (Arbitrum, Base, Optimism) which inherit ETH security at a fraction of the cost.',
  },
  {
    purpose: 'Stable dollar exposure',
    scenario: '"I want crypto that doesn\'t move with the market — keep $1 = $1."',
    primary: 'USDC',
    alternatives: 'DAI (decentralized backing), USDT (largest but less audit transparency).',
    why: 'USDC is fully reserved, audited monthly, and redeemable 1:1 by Circle. The most regulator-friendly stablecoin.',
    watchOut: 'Stablecoins are not FDIC-insured. USDC briefly depegged to $0.87 during the March 2023 Silicon Valley Bank crisis. Treat it as bank-like, not bank-equivalent.',
  },
  {
    purpose: 'Cheap, fast on-chain payments',
    scenario: '"I want to send small amounts without paying $20 in gas."',
    primary: 'Solana (SOL)',
    alternatives: 'Litecoin (LTC), Polygon, Bitcoin Lightning Network.',
    why: 'SOL transactions cost fractions of a cent and confirm in under a second.',
    watchOut: 'Solana has had multiple network outages. The chain recovers, but it\'s younger and less battle-tested than Bitcoin or Ethereum.',
  },
  {
    purpose: 'Earning yield from staking',
    scenario: '"I want passive income from a coin I\'m already holding."',
    primary: 'Ethereum staking (~3–4% APY)',
    alternatives: 'Solana staking (~7%), Cosmos (ATOM).',
    why: 'ETH staking is the safest staking play because the network is huge and slashing risk is low. You lock ETH, validators run, the network pays interest.',
    watchOut: 'Staking ties up funds — ETH has an exit queue that can take days. Validator misbehavior can be slashed (lost stake). Some "yield" products in DeFi pay much higher rates and carry much higher risk; check what you\'re actually staking into.',
  },
  {
    purpose: 'Financial privacy',
    scenario: '"I want transactions that aren\'t publicly traceable."',
    primary: 'Monero (XMR)',
    alternatives: 'Zcash (ZEC) — privacy is opt-in, default transactions are public.',
    why: 'XMR obscures sender, recipient, and amount by default using ring signatures, stealth addresses, and bulletproofs.',
    watchOut: 'Major exchanges (Binance, Kraken in some jurisdictions) have delisted XMR under regulatory pressure. Acquiring it usually means smaller exchanges, peer-to-peer markets, or atomic swaps.',
  },
  {
    purpose: 'Speculation / culture / memes',
    scenario: '"I want to bet on a community or vibe — entertainment money."',
    primary: 'Dogecoin (DOGE)',
    alternatives: 'Whatever has a strong community right now — these come and go.',
    why: 'Cultural value is real even when fundamental value is shaky. DOGE has 12+ years of memes, mainstream recognition, and high-profile endorsements behind it.',
    watchOut: 'Memecoins have NO claim to fundamental value. Treat as gambling money. Only put in what you would be completely fine losing — assume zero.',
  },
];

// "Buy a Coin 101" — where to buy and what order type to use.
type BuyPlatform = {
  type: string;
  examples: string;
  pros: string[];
  cons: string[];
  bestFor: string;
};

const BUY_PLATFORMS: BuyPlatform[] = [
  {
    type: 'Centralized exchange (CEX)',
    examples: 'Coinbase, Kraken, Binance, Gemini, OKX',
    pros: [
      'Easiest fiat → crypto path (bank transfer, debit card)',
      'High liquidity — you can buy real size without moving the price',
      'Hundreds of coins, professional trading UI, fast support',
    ],
    cons: [
      'KYC required (ID, sometimes a selfie + utility bill)',
      'You don\'t actually custody the coins until you withdraw',
      'Counterparty risk — FTX collapsed with billions of customer funds',
      'The "Simple"/"Buy" button is 1–4% more expensive than the Pro/Advanced UI',
    ],
    bestFor: 'First-time fiat purchases, then withdraw to self-custody for the long-term hold.',
  },
  {
    type: 'Decentralized exchange (DEX)',
    examples: 'Uniswap (Ethereum/L2s), Jupiter (Solana), PancakeSwap (BNB), Raydium (Solana)',
    pros: [
      'No KYC, no account — connect a wallet and trade',
      'You stay in self-custody the whole time',
      'Access to thousands of tokens that never list on big exchanges',
    ],
    cons: [
      'You need crypto already (chicken-and-egg — fund it from a CEX or P2P first)',
      'UX is harder — slippage, gas, approvals, network selection',
      'Most "long-tail" tokens are scams or rug-pulls; do real homework',
    ],
    bestFor: 'Trading once you\'re already on-chain. Obscure or pre-CEX altcoins.',
  },
  {
    type: 'Stockbroker / fintech app',
    examples: 'Cash App, PayPal, Venmo, Robinhood',
    pros: [
      'Lowest-friction UX — uses your existing app and bank link',
      'Good for tiny first purchases as a learning exercise',
    ],
    cons: [
      'On many of these, you don\'t own the coin — you own a claim against the platform. You may not be able to withdraw to a real wallet.',
      'Limited coin selection',
      'Wider spreads than crypto-native exchanges',
    ],
    bestFor: 'Trying it out with $20. Not a real long-term setup — verify withdrawal is allowed before buying serious money.',
  },
  {
    type: 'Peer-to-peer (P2P)',
    examples: 'HodlHodl (BTC), Bisq (BTC), Cake Wallet (XMR), LocalCryptos',
    pros: [
      'Privacy — no exchange KYC, no on-chain link to your bank',
      'Access to delisted coins (Monero, etc.)',
      'No centralized platform to collapse',
    ],
    cons: [
      'Slow — escrow, dispute periods, manual matching',
      'Trust required — the counterparty might not deliver',
      'Limited liquidity, especially for altcoins',
    ],
    bestFor: 'Privacy-conscious buyers, hard-to-find coins, very large transactions.',
  },
];

type OrderType = {
  name: string;
  shortDesc: string;
  bestFor: string;
  watchOut: string;
};

const ORDER_TYPES: OrderType[] = [
  {
    name: 'Market order',
    shortDesc: '"Buy right now at whatever the current price is."',
    bestFor: 'Small amounts on liquid coins (BTC, ETH, SOL, USDC). Speed over price.',
    watchOut: 'On illiquid pairs, your buy can move the price — you may pay noticeably more than the quote.',
  },
  {
    name: 'Limit order',
    shortDesc: '"Buy only if the price drops to X or below."',
    bestFor: 'When you\'re not in a rush and you have a target entry price.',
    watchOut: 'The order may never fill if the price doesn\'t reach your target. You can wait days for nothing.',
  },
  {
    name: 'Recurring buy (DCA)',
    shortDesc: '"Buy $X every week/month, automatically, regardless of price."',
    bestFor: 'Long-term position-building. The ultimate "I don\'t want to time the market" answer.',
    watchOut: 'Each transaction pays its own fee. Some platforms charge more for recurring buys than manual ones.',
  },
  {
    name: 'Convert / Instant buy',
    shortDesc: '"One click, the platform quotes a price, you accept."',
    bestFor: 'Absolute beginners on their first $20 purchase. The friendliest UI.',
    watchOut: 'The most expensive way to buy. Spread + fees are bundled into one price — typically 1–4% worse than using the Pro/Advanced UI for the same trade.',
  },
];

type FundingMethod = {
  name: string;
  speed: string;
  fee: string;
  // Fee tier on a 5-step scale: 1 = cheapest (green), 5 = most expensive (red).
  feeTier: 1 | 2 | 3 | 4 | 5;
  cap: string;
  bestFor: string;
  watchOut: string;
};

const FUNDING_METHODS: FundingMethod[] = [
  {
    name: 'ACH bank transfer',
    speed: '1–5 business days',
    fee: 'usually free',
    feeTier: 1,
    cap: '$10k–25k/day (varies)',
    bestFor: 'Cost-conscious deposits of any size — the cheapest path.',
    watchOut: 'First-ever ACH on most exchanges has a 7–10 day hold before withdrawal. Some US banks flag crypto transfers and freeze them until you call.',
  },
  {
    name: 'Crypto deposit (wallet → wallet)',
    speed: 'Minutes (varies by chain)',
    fee: 'Network gas only — pennies on Solana/Polygon, $0.50–$50 on Ethereum L1',
    feeTier: 2,
    cap: 'Effectively unlimited',
    bestFor: 'Moving funds you already hold elsewhere — exchange to self-custody, or between exchanges.',
    watchOut: 'You must select the same network on both sides. Sending USDC over Ethereum to an address only set up for Polygon strands the funds.',
  },
  {
    name: 'Wire transfer',
    speed: 'Same day',
    fee: '$10–30 outgoing + $0–15 incoming',
    feeTier: 3,
    cap: 'Bank-set, often $50k+/day',
    bestFor: 'Larger one-time deposits where speed matters.',
    watchOut: 'Wires are irreversible — typo in account or routing number = funds lost or stuck in a manual recovery process.',
  },
  {
    name: 'Debit card',
    speed: 'Instant',
    fee: '~3–4% (paid to card networks)',
    feeTier: 4,
    cap: '$1k–5k/day on most platforms',
    bestFor: 'Small first purchases when you want it on-chain immediately.',
    watchOut: 'Fee compounds — a 3.5% fee on $1,000 is $35 you don\'t recoup. Use ACH if you\'re not in a rush.',
  },
  {
    name: 'Apple Pay / Google Pay',
    speed: 'Instant',
    fee: '~3–4% (debit-card-equivalent)',
    feeTier: 4,
    cap: '$1k–5k/day',
    bestFor: 'Mobile-first users who already have a card linked.',
    watchOut: 'Same fee structure as debit cards — convenience, not a discount.',
  },
  {
    name: 'Credit card',
    speed: 'Instant',
    fee: '~4% platform fee + cash-advance fee + interest from day 1',
    feeTier: 5,
    cap: 'Card-issuer dependent',
    bestFor: 'Almost nothing. Flagged as a "cash advance" by most banks.',
    watchOut: 'Cash-advance APR is typically 25–30%, accruing daily with no grace period. Never use a credit card if you can avoid it.',
  },
];

type NamingService = {
  name: string;
  suffix: string;
  chain: string;
  example: string;
  url: string;
};

const NAMING_SERVICES: NamingService[] = [
  {
    name: 'ENS',
    suffix: '.eth',
    chain: 'Ethereum + most EVM L2s',
    example: 'vitalik.eth',
    url: 'https://ens.domains',
  },
  {
    name: 'SNS / Bonfida',
    suffix: '.sol',
    chain: 'Solana',
    example: 'phantom.sol',
    url: 'https://www.sns.id',
  },
  {
    name: 'Unstoppable Domains',
    suffix: '.crypto / .x / .nft / .wallet',
    chain: 'Multi-chain (resolves to multiple)',
    example: 'someone.crypto',
    url: 'https://unstoppabledomains.com',
  },
  {
    name: 'Lens Protocol',
    suffix: '.lens',
    chain: 'Polygon',
    example: 'stani.lens',
    url: 'https://lens.xyz',
  },
];

// Editorial — Wallet 101 stats are dated/sourced; verify and update annually.
type WalletEntry = {
  name: string;
  slug: string;     // matches the SVG filename in /static/wallet-logos/<slug>.svg
  kind: 'software' | 'hardware';
  chain: string;
  url: string;
  pros: string[];
  cons: string[];
  stat: string;
  statSource: string;
  platform: 'laptop-first' | 'mobile-first' | 'both';
  hasTutorial?: boolean;  // true → show the radiating-star button that opens the wallet-tutorial page
};

const WALLETS_101: WalletEntry[] = [
  // Software wallets, by user count desc. Trust Wallet's 70M is cumulative;
  // MetaMask / Phantom report MAU — apples-to-oranges but each project's own number.
  {
    name: 'Trust Wallet',
    slug: 'trust-wallet',
    kind: 'software',
    chain: 'Multi-chain (EVM, Solana, BTC, Tron, LTC, +60 more)',
    url: 'https://trustwallet.com',
    pros: [
      'Broadest chain support of any consumer wallet',
      'Mobile-first, very easy onboarding',
      'Backed by Binance (resources, infra)',
    ],
    cons: [
      'Backed by Binance (centralization concerns)',
      'Closed source for the wallet client',
      'Browser extension is less feature-rich than the mobile app',
    ],
    stat: '~70M+ wallets created (cumulative)',
    statSource: 'Trust Wallet / Binance, 2024',
    platform: 'mobile-first',
    hasTutorial: true,
  },
  {
    name: 'MetaMask',
    slug: 'metamask',
    kind: 'software',
    chain: 'EVM',
    url: 'https://metamask.io',
    pros: [
      'Universal — every dApp supports it',
      'Browser extension + mobile app',
      'Open source, long history (since 2016)',
    ],
    cons: [
      'UX has gotten clunkier with each major release',
      'Default RPC routes through Infura, which logs IP addresses',
      'No native multi-chain switching as smooth as Rabby',
    ],
    stat: '~30M monthly active users',
    statSource: 'ConsenSys, mid-2024',
    platform: 'laptop-first',
  },
  {
    name: 'Phantom',
    slug: 'phantom',
    kind: 'software',
    chain: 'Solana + EVM + Bitcoin',
    url: 'https://phantom.app',
    pros: [
      'Best-in-class Solana UX',
      'Hardware wallet integration (Ledger)',
      'Expanded to Ethereum and Bitcoin in 2023–2024',
    ],
    cons: [
      'Closed source',
      'EVM support is newer and less battle-tested than MetaMask/Rabby',
      'Heavy native-token (SOL) ecosystem bias',
    ],
    stat: '~10M monthly active users',
    statSource: 'Phantom announcements, 2024',
    platform: 'both',
  },
  {
    name: 'Coinbase Wallet',
    slug: 'coinbase-wallet',
    kind: 'software',
    chain: 'EVM + Solana',
    url: 'https://wallet.coinbase.com',
    pros: [
      'Built-in fiat on-ramp via Coinbase exchange',
      'Backed by US-public-listed company (Nasdaq: COIN)',
      'Easy to confuse with the Coinbase exchange — but this is a true self-custody wallet',
    ],
    cons: [
      "Easy to confuse with the Coinbase exchange — beginners often don't understand the difference",
      'Less feature-rich for DeFi power use than Rabby/MetaMask',
      'Closed source',
    ],
    stat: '~10M+ wallets created',
    statSource: 'Coinbase disclosures, 2024',
    platform: 'both',
  },
  {
    name: 'Rabby',
    slug: 'rabby',
    kind: 'software',
    chain: 'EVM',
    url: 'https://rabby.io',
    pros: [
      'Best-in-class transaction simulation (shows exactly what will happen before signing)',
      'Auto-detects which chain a dApp is on; no manual switching',
      'Open source, by the DeBank team',
    ],
    cons: [
      'Smaller user base than MetaMask',
      'Mobile app launched late and is less mature',
      'Less "default" status — some dApps still expect MetaMask',
    ],
    stat: '~1–2M monthly active users (rough)',
    statSource: 'self-reported, 2024',
    platform: 'laptop-first',
  },
  {
    name: 'Ledger',
    slug: 'ledger',
    kind: 'hardware',
    chain: 'Multi-chain (EVM, BTC, SOL, +5,500 assets)',
    url: 'https://ledger.com',
    pros: [
      'Most popular hardware wallet — broadest dApp + chain support',
      'Pairs with Rabby/Phantom/MetaMask via plug-in',
      'Nano S Plus is ~$80; Nano X (Bluetooth) ~$150',
    ],
    cons: [
      '2020 customer-data leak still drives phishing attempts',
      '2023 Ledger Recover firmware controversy (key-shard escrow service)',
      'Closed-source firmware',
    ],
    stat: '~6M+ devices sold',
    statSource: 'Ledger disclosures, 2024',
    platform: 'both',
  },
  {
    name: 'Trezor',
    slug: 'trezor',
    kind: 'hardware',
    chain: 'Multi-chain (EVM, BTC, +1,800 assets)',
    url: 'https://trezor.io',
    pros: [
      'Fully open-source firmware',
      'Strong security reputation, no major incidents to date',
      'Safe 3 ~$80; Model T (touchscreen) ~$220',
    ],
    cons: [
      'Slightly fewer chains supported than Ledger',
      'Smaller screen on the budget model',
      'Companion app (Trezor Suite) is less polished than Ledger Live',
    ],
    stat: '~2–3M devices sold (estimate)',
    statSource: 'industry estimates, 2024',
    platform: 'laptop-first',
  },
];
// Crypto pages still exist behind a feature flag (see `showCrypto` on the
// component). Anyone landing on one while the flag is off gets redirected
// to brokerage; the original page id stays in localStorage so flipping the
// flag back on restores it.
const CRYPTO_PAGES = new Set([
  'portfolios', 'resources', 'marketplace', 'platforms', 'wallet',
  'wallet-address', 'fund-account', 'pick-a-coin', 'buy-a-coin',
  'transaction-hash', 'exchange-funds', 'wallet-tutorial', 'starter-portfolio',
  'market-extra',
]);
const SHOW_CRYPTO = false;

const restoredPage = (() => {
  try {
    const v = localStorage.getItem('currentPage');
    // Migrate retired page values silently.
    if (v === 'dashboard' || v === 'market') return SHOW_CRYPTO ? 'portfolios' : 'brokerage';
    if (v === 'lookup') return SHOW_CRYPTO ? 'transaction-hash' : 'brokerage';
    if (v === 'crypto') return SHOW_CRYPTO ? 'marketplace' : 'brokerage';
    if (v === 'traditional') return 'brokerage';
    if (v && VALID_PAGES.includes(v)) {
      if (!SHOW_CRYPTO && CRYPTO_PAGES.has(v)) return 'brokerage';
      return v;
    }
    return SHOW_CRYPTO ? 'portfolios' : 'brokerage';
  } catch { return SHOW_CRYPTO ? 'portfolios' : 'brokerage'; }
})();

window.dashApp = () => ({
  // State
  page: restoredPage,
  // v1 feature flag — crypto section is hidden from the nav. Flipping
  // this to true (here or via localStorage in DevTools) re-exposes the
  // entire crypto product without code changes.
  showCrypto: SHOW_CRYPTO,
  cryptoOpen: ['portfolios', 'resources', 'marketplace', 'platforms', 'wallet', 'wallet-address', 'fund-account', 'pick-a-coin', 'buy-a-coin', 'transaction-hash', 'exchange-funds', 'wallet-tutorial'].includes(restoredPage),
  traditionalOpen: ['brokerage', 'holdings', 'contact-us'].includes(restoredPage),
  currentTutorialWallet: '' as string,
  wallets101: WALLETS_101,
  chainAddressFormats: CHAIN_ADDRESS_FORMATS,
  namingServices: NAMING_SERVICES,
  fundingMethods: FUNDING_METHODS,
  coinPrimers: COIN_PRIMERS,
  coinUseCases: COIN_USE_CASES,
  buyPlatforms: BUY_PLATFORMS,
  orderTypes: ORDER_TYPES,
  portfolios: [] as Portfolio[],
  activePortfolioId: null as number | null,
  portfolioDetail: null as any,
  lastBuyFees: {} as Record<number, any>,
  activeWalletFilter: null as string | null,
  loadingPortfolio: false,
  _refreshTimer: null as ReturnType<typeof setInterval> | null,

  // Alpaca brokerage state. Populated by loadBrokerage() when the user is
  // on the brokerage page. Polled every 30s while the page is active.
  alpacaAccount: null as any,
  alpacaPositions: [] as any[],
  alpacaOrders: [] as any[],
  alpacaQuote: null as any,
  loadingBrokerage: false,
  brokerageError: null as string | null,
  orderError: null as string | null,
  orderSubmitting: false,
  orderForm: {
    symbol: '',
    side: 'buy' as 'buy' | 'sell',
    qty: '1',
    limit_price: '',
    // Stop-price for stop + stop_limit; trail_price OR trail_percent
    // (mutually exclusive) for trailing_stop. All empty unless the user
    // picks a type that needs them.
    stop_price: '',
    trail_price: '',
    trail_percent: '',
    type: 'limit' as 'limit' | 'market' | 'stop' | 'stop_limit' | 'trailing_stop',
    // Trailing stops require GTC because they can't fit in a single
    // trading day's session predictably. We auto-flip TIF when the
    // type changes; user can still override.
    time_in_force: 'day' as 'gtc' | 'day' | 'ioc' | 'fok',
  },
  // Help-modal toggle for the "what are these order types?" popover.
  orderTypesHelpOpen: false,
  // Tracks the last auto-filled limit price so we can keep refreshing it
  // as the live quote moves — but stop the moment the user manually edits
  // the field (so we don't overwrite their target).
  _lastAutoLimitPrice: '' as string,
  _quoteRefreshTimer: null as number | null,
  orderConfirmOpen: false,
  // Add Funds modal — payment provider hookup is a TODO; modal currently
  // shows a placeholder.
  addFundsOpen: false,
  addFundsAmount: '',
  addFundsMethod: 'ach' as 'ach' | 'instant' | 'wire',
  addFundsBankLabel: 'Chase ••••1234',
  addFundsSubmitting: false,
  addFundsError: '' as string,
  brokerDeposits: [] as Array<{ id: number; amount: string; method: string; bank_label: string; reference: string; status: string; created_at: string; direction?: string }>,
  // Withdraw modal — same flow as Add Funds but OUTGOING direction.
  withdrawOpen: false,
  withdrawAmount: '',
  withdrawMethod: 'ach' as 'ach' | 'instant' | 'wire',
  withdrawBankLabel: 'Chase ••••1234',
  withdrawSubmitting: false,
  withdrawError: '' as string,
  brokerWithdrawals: [] as Array<{ id: number; amount: string; method: string; bank_label: string; reference: string; status: string; created_at: string; direction?: string }>,
  // Recurring-investment management — list + form state for the new
  // "set and forget" section on the brokerage page.
  recurringInvestments: [] as any[],
  loadingRecurring: false,
  recurringForm: {
    symbol: '',
    qty: '1',
    frequency: 'weekly' as 'daily' | 'weekly' | 'biweekly' | 'monthly',
    side: 'buy' as 'buy' | 'sell',
    order_type: 'market' as 'market' | 'limit',
    limit_price: '',
    starts_at: '' as string,
  },
  recurringSubmitting: false,
  recurringError: '' as string,
  // Recent-orders status filter — 'active' (open / working orders), 'filled', 'expired'.
  recentOrdersTab: 'active' as 'active' | 'filled' | 'expired',
  // Brokerage account (KYC) — null when the user hasn't onboarded yet.
  brokerageAccount: null as null | {
    id: number;
    alpaca_account_id: string;
    alpaca_account_number: string | null;
    status: string | null;
    kyc_state: string;
    last_synced_at: string | null;
  },
  // KYC form state — collected on the account-setup page, POSTed to
  // /api/brokerage/account. Nothing is persisted client-side beyond
  // form lifetime (security — SSN especially).
  kycForm: {
    given_name: '',
    middle_name: '',
    family_name: '',
    date_of_birth: '',
    tax_id: '',
    phone_number: '',
    street_address: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'USA',
    country_of_citizenship: 'USA',
    country_of_birth: 'USA',
    country_of_tax_residence: 'USA',
    funding_source: 'employment_income',
    is_control_person: false,
    is_affiliated_exchange_or_finra: false,
    is_politically_exposed: false,
    immediate_family_exposed: false,
    agreement_margin: false,
    agreement_account: false,
    agreement_customer: false,
  },
  kycSubmitting: false,
  kycError: '' as string,
  kycFieldErrors: [] as string[],
  // Contact Us form
  contactForm: { name: '', email: '', subject: '', message: '' },
  contactSubmitting: false,
  contactError: null as string | null,
  contactSent: false,
  // ── Brokerage portfolios ──────────────────────────────────────────────
  // User-defined buckets for grouping stock positions ("Retirement",
  // "Travel Fund"). DB-backed via /api/brokerage/portfolios — each
  // user's list is fetched on init and re-fetched after create/delete.
  // The user's main portfolio (`is_main: true`) is auto-created on
  // first GET and is the destination for external Add-Funds deposits.
  // The cash/allocation bookkeeping (positionAllocation, portfolioCash,
  // ...) still lives in per-user localStorage for Phase 1; that moves
  // to the DB in Phase 2.
  brokeragePortfolios: [] as Array<{ id: number; name: string; color: string; is_main: boolean }>,
  // Active chip — number for a real portfolio, 'all' for the aggregate view.
  // Hydrated from localStorage (UI preference) after the portfolio list loads.
  activeBrokeragePortfolioId: 'all' as number | 'all',
  // New-portfolio modal (brokerage-side).
  newBrokeragePortfolioOpen: false,
  newBrokeragePortfolioName: '',
  newBrokeragePortfolioColor: '#b44dff',
  // symbol → { portfolioId → qty } — source of truth for per-portfolio
  // share counts. DB-backed via /api/brokerage/positions; updated by
  // order placement and the allocation editor. The legacy 1:1
  // positionPortfolioMap is now derived on demand via primaryPortfolioFor.
  positionAllocation: {} as Record<string, Record<string, number>>,
  // Per-row allocation editor modal.
  allocationEditOpen: false,
  allocationEditSymbol: '',
  allocationEditValues: {} as Record<string, string>,
  // Per-portfolio reward deposits (persisted). Newly-created portfolios
  // start at $0 until rewards are explicitly routed into them.
  brokerageRewardsByPortfolio: {} as Record<string, number>,
  // Cumulative deposits into the brokerage (only goes up — internal
  // transfers don't change it). Persisted.
  totalDeposited: 0,
  // Cash available per portfolio. Empty until the user makes a deposit.
  portfolioCash: {} as Record<string, number>,
  // Per-portfolio cumulative deposits (inflows only — Main gets external
  // Add Funds, others get internal transfers from Main).
  portfolioDeposited: {} as Record<string, number>,
  transferModalOpen: false,
  transferAmount: '',

  // Holdings table sort — column + direction. '' = no sort (Alpaca order).
  holdingsSortBy: '' as '' | 'symbol' | 'name' | 'industry' | 'side' | 'qty' | 'avg' | 'current' | 'mv' | 'pl' | 'div',
  holdingsSortDir: 'asc' as 'asc' | 'desc',
  // Lifetime DIV-activity total, pulled from Alpaca on Holdings entry.
  holdingsTotalDividendsPaid: 0,
  // Per-symbol Alpaca asset metadata (status + tradable flags). Used to
  // surface a "delisting risk" badge on holdings the broker has flagged
  // inactive or non-tradable.
  alpacaAssetStatus: {} as Record<string, { status: string; tradable: boolean; marginable: boolean; shortable: boolean } | null>,
  // Per-symbol SEC EDGAR 8-K findings within the trailing 90 days. Empty
  // array means "checked, nothing to flag"; a populated array means there
  // was at least one risk-tagged filing (bankruptcy, delisting warning,
  // debt default, audit non-reliance).
  edgarRisk: {} as Record<string, Array<{ item: string; severity: 'severe' | 'warn' | 'info'; form: string; filed_at: string; accession: string | null; url: string | null; label: string }> | null>,
  // Curated 60-ticker showcase that animates across the Brokerage page
  // header. Order is hand-grouped to read left-to-right as logical
  // clusters (mega-caps → ETFs → dividends → sectors → themes).
  brokerageHeroStack: BROKERAGE_HERO_STACK,
  // Chart instances for the three Holdings doughnut breakdowns.
  // Holdings doughnut palette toggle. 'logo' samples each holding's
  // brand color from its Logo.dev image and slices by symbol. 'chip'
  // uses the curated screener-chip palette and buckets by industry.
  holdingsPaletteMode: 'logo' as 'logo' | 'chip' | 'projection',
  holdingsProjectionChart: null as Chart | null,
  // Stocks the user wants to buy later — persisted in localStorage so
  // the list survives reloads. Modal opens from the "Wish List" button
  // under the Rewards Deposited tile.
  // Wishlist is DB-backed (per-user, multi-device). Templates still read
  // `wishList` (symbols) and `wishListQty` (qty map); we keep both in
  // sync from the canonical `_wishlistItems` array after each API
  // response so the existing templates keep working unchanged.
  wishList: [] as string[],
  _wishlistItems: [] as Array<{
    id: number;
    symbol: string;
    qty: string;
    side: string;
    order_type: string;
    limit_price: string | null;
    time_in_force: string;
    position: number;
    status: string;
  }>,
  wishListOpen: false,
  wishListInput: '',
  // ── Personas — customer-persona authoring tool ───────────────────────
  // Each persona captures who we're building for so the team can rally
  // around concrete archetypes (Gen Z first-time investor, etc.).
  personas: ((): any[] => {
    try {
      const raw = localStorage.getItem('personas');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  })(),
  personaForm: {
    // Profile / demographics
    name: '',
    age: '',
    // Behavior — drives the projection formula
    monthly_spend: 1500,
    revolve_rate: 40,            // % of monthly statement carried
    apr: 24,                     // APR on carried balance (%)
    // Program levers — sliders the team uses to tune the offer
    reward_rate: 1.5,            // % of spend deposited to brokerage
    interchange_take: 1.55,      // % of spend kept as our interchange share
    interest_share: 30,          // % of revolver interest that flows to us
    market_return: 5,            // assumed annualized price return (%)
    dividend_yield: 2,           // annualized dividend yield on portfolio (%)
    horizon_years: 10,           // years to project
  },
  personaEditingId: null as string | null,
  // When set, the main projection panel previews this saved persona's
  // numbers / chart instead of the live form. Click a card body to view;
  // typing in the form or starting an edit clears the selection.
  personaViewingId: null as string | null,
  _savePersonas(this: any) {
    try { localStorage.setItem('personas', JSON.stringify(this.personas)); } catch {}
  },
  resetPersonaForm(this: any) {
    this.personaForm = {
      name: '', age: '',
      monthly_spend: 1500, revolve_rate: 40, apr: 24,
      reward_rate: 1.5, interchange_take: 1.55, interest_share: 30,
      market_return: 5, dividend_yield: 2, horizon_years: 10,
    };
    this.personaEditingId = null;
  },
  savePersona(this: any) {
    const name = (this.personaForm.name || '').trim();
    if (!name) return;
    const data = { ...this.personaForm, name };
    if (this.personaEditingId) {
      this.personas = this.personas.map((p: any) =>
        p.id === this.personaEditingId ? { ...p, ...data, updated_at: new Date().toISOString() } : p
      );
    } else {
      this.personas = [
        ...this.personas,
        {
          id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    }
    this._savePersonas();
    this.resetPersonaForm();
  },
  // Returns the persona object driving the projection panel — either the
  // viewed saved persona, or the live form when no card is selected.
  activeProjectionPersona(this: any) {
    if (this.personaViewingId) {
      const p = this.personas.find((x: any) => x.id === this.personaViewingId);
      if (p) return p;
    }
    return this.personaForm;
  },

  viewPersona(this: any, id: string) {
    this.personaViewingId = id;
    // Cancel any in-progress edit so the form doesn't fight the view.
    this.personaEditingId = null;
  },

  clearPersonaView(this: any) {
    this.personaViewingId = null;
  },

  editPersona(this: any, id: string) {
    const p = this.personas.find((x: any) => x.id === id);
    if (!p) return;
    const num = (v: any, dflt: number) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : dflt;
    };
    this.personaForm = {
      name: p.name || '', age: p.age || '',
      monthly_spend: num(p.monthly_spend, 1500),
      revolve_rate: num(p.revolve_rate, 40),
      apr: num(p.apr, 24),
      reward_rate: num(p.reward_rate, 1.5),
      interchange_take: num(p.interchange_take, 1.55),
      interest_share: num(p.interest_share, 30),
      market_return: num(p.market_return, 5),
      dividend_yield: num(p.dividend_yield, 2),
      horizon_years: num(p.horizon_years, 10),
    };
    this.personaEditingId = id;
    this.personaViewingId = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  // ── Persona projection model ─────────────────────────────────────────
  // Inputs come from `personaForm` (or any persona-shaped object); model
  // is intentionally additive — to add a new revenue line or new lever,
  // append it to `byYear[i]` and the chart picks it up via the sliders.
  //
  // Customer balance: instant vesting. Each month's reward is deposited
  // immediately and earns the assumed monthly market return for the rest
  // of the horizon. Balance at year y = future-value-of-annuity formula
  // with monthly contributions.
  //
  // Revenue lines (your cut, per year):
  //  - Net interchange — interchange_take% × spend MINUS reward_rate% × spend
  //  - Interest revenue — revolved-balance interest × interest_share%
  //
  // Returns { byYear: [{year, balance, netInterchange, interest, total,
  // cumulative}], summary: {balanceAtHorizon, totalRevenueAtHorizon,
  // avgAnnualRevenue, programMargin}}.
  computePersonaProjection(this: any, p: any) {
    const num = (v: any, dflt: number) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= 0 ? n : dflt;
    };
    const monthlySpend = num(p.monthly_spend, 0);
    const revolveRate = num(p.revolve_rate, 0) / 100;
    const apr = num(p.apr, 0) / 100;
    const rewardRate = num(p.reward_rate, 0) / 100;
    const interchangeTake = num(p.interchange_take, 0) / 100;
    const interestShare = num(p.interest_share, 0) / 100;
    const marketReturn = num(p.market_return, 0) / 100;
    const dividendYield = num(p.dividend_yield, 0) / 100;
    const horizonYears = Math.max(1, Math.floor(num(p.horizon_years, 10)));

    const monthlyReward = monthlySpend * rewardRate;
    // Total annual return = price appreciation + reinvested dividend yield.
    // Compounded to a monthly rate for the FV-of-annuity formula.
    const totalAnnualReturn = marketReturn + dividendYield;
    const monthlyMarket = totalAnnualReturn > 0 ? Math.pow(1 + totalAnnualReturn, 1 / 12) - 1 : 0;

    // Annual revenue per year is constant in this v1 (assumes flat spend).
    const annualSpend = monthlySpend * 12;
    const annualNetInterchange = annualSpend * (interchangeTake - rewardRate);
    // Crude revolver interest model: revolveRate × spend carries for ~half
    // a year on average and accrues APR over that period. Multiply by our
    // interest share to get our cut.
    const annualInterest = annualSpend * revolveRate * apr * 0.5 * interestShare;
    const annualRevenue = annualNetInterchange + annualInterest;

    const byYear: Array<{
      year: number;
      balance: number;
      netInterchange: number;
      interest: number;
      annualRevenue: number;
      cumulativeRevenue: number;
    }> = [];

    let cumulative = 0;
    for (let y = 1; y <= horizonYears; y++) {
      const months = y * 12;
      let balance: number;
      if (monthlyMarket > 0 && monthlyReward > 0) {
        balance = monthlyReward * (Math.pow(1 + monthlyMarket, months) - 1) / monthlyMarket;
      } else {
        balance = monthlyReward * months;
      }
      cumulative += annualRevenue;
      byYear.push({
        year: y,
        balance,
        netInterchange: annualNetInterchange,
        interest: annualInterest,
        annualRevenue,
        cumulativeRevenue: cumulative,
      });
    }

    const last = byYear[byYear.length - 1];
    const balanceAtHorizon = last?.balance || 0;
    const totalRevenueAtHorizon = last?.cumulativeRevenue || 0;
    const avgAnnualRevenue = horizonYears > 0 ? totalRevenueAtHorizon / horizonYears : 0;
    // Program margin = our net rev / what customer earned via rewards.
    // Higher = we keep more relative to what we give. Useful for the
    // "tune the offer" intuition slider.
    const totalRewardsDeployed = annualSpend * rewardRate * horizonYears;
    const programMargin = totalRewardsDeployed > 0 ? totalRevenueAtHorizon / totalRewardsDeployed : 0;

    return {
      byYear,
      summary: {
        balanceAtHorizon,
        totalRevenueAtHorizon,
        avgAnnualRevenue,
        programMargin,
        annualNetInterchange,
        annualInterest,
        annualRevenue,
        monthlyReward,
        annualSpend,
        horizonYears,
      },
    };
  },

  personaProjectionChart: null as Chart | null,
  personaCardCharts: {} as Record<string, Chart | null>,

  // Render a compact projection chart inside a saved-persona card. Same
  // gold (customer) + purple (company) palette as the live preview, but
  // sized smaller and with no axis labels so it reads as a sparkline.
  renderPersonaCardChart(this: any, persona: any) {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-persona-card="${persona.id}"]`);
    if (!canvas) return;
    const proj = this.computePersonaProjection(persona);
    const labels = ['0', ...proj.byYear.map((r: any) => 'Y' + r.year)];
    const balanceData = [0, ...proj.byYear.map((r: any) => Math.round(r.balance))];
    const revenueData = [0, ...proj.byYear.map((r: any) => Math.round(r.cumulativeRevenue))];

    if (this.personaCardCharts[persona.id]) {
      this.personaCardCharts[persona.id]!.destroy();
    }
    this.personaCardCharts[persona.id] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Customer balance',
            data: balanceData,
            borderColor: '#d2a84a',
            backgroundColor: 'rgba(210, 168, 74, 0.14)',
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'Company revenue',
            data: revenueData,
            borderColor: '#b44dff',
            backgroundColor: 'rgba(180, 77, 255, 0.12)',
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d0a1e',
            borderColor: '#261d4a',
            borderWidth: 1,
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: 'rgba(232, 224, 255, 0.55)',
              font: { size: 10 },
              callback: (v: any) => '$' + (Math.abs(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : Number(v).toFixed(0)),
              maxTicksLimit: 4,
            },
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
          },
          x: {
            ticks: { color: 'rgba(232, 224, 255, 0.55)', font: { size: 10 }, maxTicksLimit: 6 },
            grid: { display: false },
          },
        },
      },
    });
  },

  renderAllPersonaCardCharts(this: any) {
    for (const p of this.personas) {
      this.$nextTick(() => this.renderPersonaCardChart(p));
    }
  },
  renderPersonaProjectionChart(this: any) {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-persona-projection]');
    if (!canvas) return;
    const proj = this.computePersonaProjection(this.activeProjectionPersona());
    const labels = ['0', ...proj.byYear.map((r: any) => 'Y' + r.year)];
    const balanceData = [0, ...proj.byYear.map((r: any) => Math.round(r.balance))];
    const revenueData = [0, ...proj.byYear.map((r: any) => Math.round(r.cumulativeRevenue))];

    if (this.personaProjectionChart) this.personaProjectionChart.destroy();
    this.personaProjectionChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Customer portfolio balance',
            data: balanceData,
            borderColor: '#d2a84a',
            backgroundColor: 'rgba(210, 168, 74, 0.12)',
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            yAxisID: 'y',
          },
          {
            label: 'Cumulative fintech revenue',
            data: revenueData,
            borderColor: '#b44dff',
            backgroundColor: 'rgba(180, 77, 255, 0.10)',
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            yAxisID: 'y',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          // Custom legend lives below the chart so the "Customer" and
          // "Company" tags can carry the same visual weight as the
          // stat sections — the built-in Chart.js legend is too plain.
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d0a1e',
            borderColor: '#261d4a',
            borderWidth: 1,
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: 'rgba(232, 224, 255, 0.7)',
              callback: (v: any) => '$' + Number(v).toLocaleString('en-US'),
            },
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
          },
          x: {
            ticks: { color: 'rgba(232, 224, 255, 0.7)' },
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
          },
        },
      },
    });
  },
  deletePersona(this: any, id: string) {
    if (!confirm('Delete this persona? This cannot be undone.')) return;
    this.personas = this.personas.filter((p: any) => p.id !== id);
    this._savePersonas();
    if (this.personaEditingId === id) this.resetPersonaForm();
  },

  // Investor memorandum: which slide of the deck the user is on. 0 = cover.
  memoSlide: 0,
  memoSlideCount: 6,
  memoCharts: {} as Record<string, Chart | null>,
  memoNext(this: any) { if (this.memoSlide < this.memoSlideCount - 1) this.memoSlide += 1; },
  memoPrev(this: any) { if (this.memoSlide > 0) this.memoSlide -= 1; },

  // Render the Janus Henderson "barriers to investing" bar chart on slide 4.
  renderMemoBarriersChart(this: any) {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-memo-barriers]');
    if (!canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    // Inline plugin — draws a large red down-arrow in front of each
    // y-axis label. Arrows are placed at the far-left edge of the
    // y-axis area; reserved space is added via `afterFit` so the
    // arrows don't collide with the label text.
    const redArrowsPlugin = {
      id: 'memoRedYArrows',
      afterDatasetsDraw(chart: any) {
        const yAxis = chart.scales?.y;
        if (!yAxis) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = '#dc2626';
        ctx.font = '700 24px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < yAxis.ticks.length; i++) {
          const y = yAxis.getPixelForTick(i);
          // yAxis.left is the leftmost edge of the y-axis area; the
          // afterFit hook reserved 32px there for the arrow.
          ctx.fillText('▼', yAxis.left + 4, y);
        }
        ctx.restore();
      },
    };

    // Inline plugin — draws each bar's percentage value just past the
    // end of the bar so the magnitudes can be read at a glance.
    const barriersDataLabels = {
      id: 'memoBarriersDataLabels',
      afterDatasetsDraw(chart: any) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        const data = chart.data.datasets[0].data as number[];
        ctx.save();
        ctx.font = '700 14px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        meta.data.forEach((bar: any, i: number) => {
          // Highlight the gold (lack-of-understanding) bar's label in
          // gold; everything else gets the standard cream tone.
          ctx.fillStyle = i === 1 ? '#d2a84a' : '#f8f5ee';
          ctx.fillText(data[i] + '%', bar.x + 8, bar.y);
        });
        ctx.restore();
      },
    };

    this.memoCharts.barriers = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: [
          'Prefer easily accessible savings',
          'Lack of understanding of investing',
          'Existing debts / obligations',
          'Lack of means to get started',
        ],
        datasets: [{
          data: [38, 30, 30, 28],
          backgroundColor: [
            'rgba(180, 77, 255, 0.30)',
            '#d2a84a',
            'rgba(180, 77, 255, 0.30)',
            'rgba(180, 77, 255, 0.30)',
          ],
          borderColor: [
            'rgba(180, 77, 255, 0.55)',
            '#b78b3a',
            'rgba(180, 77, 255, 0.55)',
            'rgba(180, 77, 255, 0.55)',
          ],
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx: any) => `${ctx.parsed.x}%` },
            backgroundColor: '#0d0a1e', borderColor: '#261d4a', borderWidth: 1,
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 60,
            ticks: { color: 'rgba(248, 245, 238, 0.65)', callback: (v: any) => v + '%', stepSize: 5 },
            grid: { color: 'rgba(248, 245, 238, 0.06)' },
          },
          y: {
            // Reserve room on the left of the axis for the red arrows
            // drawn by the redArrowsPlugin so they sit before each label.
            afterFit(scale: any) { scale.paddingLeft = (scale.paddingLeft || 0) + 24; scale.width += 24; },
            ticks: { color: 'rgba(248, 245, 238, 0.85)', font: { size: 12 }, padding: 12 },
            grid: { display: false },
          },
        },
      },
      plugins: [redArrowsPlugin, barriersDataLabels],
    });
  },

  // Render the McKinsey transactor vs revolver comparison on slide 5.
  renderMemoPnlChart(this: any) {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-memo-pnl]');
    if (!canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    this.memoCharts.pnl = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Transactors', 'Revolvers'],
        datasets: [{
          data: [25, 240],
          // Brand-aligned palette — gold for the small/healthy cohort,
          // accent purple for the large/profit-driving revolver cohort.
          backgroundColor: ['rgba(210, 168, 74, 0.55)', 'rgba(180, 77, 255, 0.55)'],
          borderColor: ['#d2a84a', '#b44dff'],
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx: any) => `$${ctx.parsed.x} profit / account / yr` },
            backgroundColor: '#0d0a1e', borderColor: '#261d4a', borderWidth: 1,
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 280,
            ticks: { color: 'rgba(248, 245, 238, 0.65)', callback: (v: any) => '$' + v },
            grid: { color: 'rgba(248, 245, 238, 0.06)' },
          },
          y: {
            ticks: { color: 'rgba(248, 245, 238, 0.85)', font: { size: 13 } },
            grid: { display: false },
          },
        },
      },
    });
  },

  // Render the Experian generational credit-card balance chart on slide 5.
  renderMemoGenerationsChart(this: any) {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-memo-generations]');
    if (!canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    // Data-label plugin: render the dollar amount above each bar so the
    // chart reads at a glance without forcing the eye to the y-axis.
    const dataLabelPlugin = {
      id: 'memoGenDataLabels',
      afterDatasetsDraw(chart: any) {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        const data = chart.data.datasets[0].data as number[];
        ctx.save();
        ctx.fillStyle = '#f8f5ee';
        ctx.font = '700 14px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        meta.data.forEach((bar: any, i: number) => {
          const v = data[i];
          ctx.fillText('$' + v.toLocaleString('en-US'), bar.x, bar.y - 6);
        });
        ctx.restore();
      },
    };

    this.memoCharts.generations = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: [
          ['Gen Z', '(11–28)'],
          ['Millennials', '(29–44)'],
          ['Gen X', '(45–60)'],
          ['Boomers', '(61–79)'],
          ['Silent Gen', '(80+)'],
        ],
        datasets: [{
          data: [3493, 6961, 9600, 6795, 3445],
          // Brand-aligned palette: lavender for the rising cohort (Gen Z),
          // muted purple for Millennials, bright accent purple for the
          // peak-debt cohort (Gen X), gold for Boomers, cream for the
          // low-debt Silent Gen baseline.
          backgroundColor: [
            '#c4b5fd',                  // Gen Z — lavender
            'rgba(180, 77, 255, 0.55)', // Millennials — muted purple
            '#b44dff',                  // Gen X — full accent purple (peak)
            '#d2a84a',                  // Boomers — gold
            'rgba(248, 245, 238, 0.55)', // Silent Gen — cream
          ],
          borderColor: [
            '#a78bfa',
            'rgba(180, 77, 255, 0.85)',
            '#9333ea',
            '#b78b3a',
            'rgba(248, 245, 238, 0.85)',
          ],
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 78,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx: any) => '$' + ctx.parsed.y.toLocaleString('en-US') },
            backgroundColor: '#0d0a1e', borderColor: '#261d4a', borderWidth: 1,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 10500,
            ticks: {
              color: 'rgba(248, 245, 238, 0.65)',
              stepSize: 2000,
              callback: (v: any) => '$' + Number(v).toLocaleString('en-US'),
            },
            grid: { color: 'rgba(248, 245, 238, 0.06)' },
            title: {
              display: true,
              text: 'Average credit-card balance (USD)',
              color: 'rgba(248, 245, 238, 0.55)',
              font: { size: 11, style: 'italic' },
            },
          },
          x: {
            ticks: { color: 'rgba(248, 245, 238, 0.85)', font: { size: 12 } },
            grid: { display: false },
          },
        },
      },
      plugins: [dataLabelPlugin],
    });
  },

  renderMemoCharts(this: any) {
    if (this.memoSlide === 3) this.$nextTick(() => this.renderMemoBarriersChart());
    if (this.memoSlide === 4) this.$nextTick(() => {
      this.renderMemoPnlChart();
      this.renderMemoGenerationsChart();
    });
  },
  // Per-symbol planned purchase quantity. Derived from `_wishlistItems`
  // after each API response; kept as a flat record for the existing
  // template lookups (`wishListQty[symbol]`).
  wishListQty: {} as Record<string, string>,
  // Drag-and-drop reorder state — index of the row currently being
  // dragged. Drop handler swaps it into the target slot.
  wishListDragIndex: null as number | null,
  holdingsChart: null as Chart | null,
  holdingsDividendChart: null as Chart | null,
  holdingsPriceChart: null as Chart | null,
  stockScreener: STOCK_SCREENER,
  screenerOpen: false,
  // 'stocks' shows the curated stock categories; 'etfs' shows ETF baskets.
  screenerView: 'stocks' as 'stocks' | 'etfs',
  // Articles keyed to the symbol they were fetched for, so toggling
  // between symbols doesn't show stale headlines from the prior one.
  // The news panel sits under the order form (Alpaca News API).
  alpacaNews: { symbol: '', articles: [] as any[] },
  loadingAlpacaNews: false,
  alpacaNewsError: null as string | null,
  // Company-profile card (headquarters, industry, IPO age, etc.).
  // Symbol-keyed like the news so we don't show stale data on toggle.
  // Backed by /api/alpaca/profile/:symbol → Finnhub /stock/profile2.
  companyProfile: { symbol: '', data: null as any },
  loadingCompanyProfile: false,

  // Account ledger from Alpaca — fills, dividends, transfers, fees. Loaded
  // alongside the trading account in loadBrokerage so the activity card
  // refreshes whenever the user pulls the brokerage page.
  alpacaActivities: [] as any[],
  loadingAlpacaActivities: false,
  // Equity / P&L curve for the performance chart. Shape mirrors Alpaca's
  // response: parallel arrays keyed by timestamp index.
  alpacaPortfolioHistory: {
    timestamp: [] as number[],
    equity: [] as number[],
    profit_loss: [] as number[],
    profit_loss_pct: [] as number[],
    base_value: 0,
    timeframe: '',
  } as any,
  loadingAlpacaPortfolioHistory: false,
  screenerCategory: 'mag-7' as string,
  screenerSearch: '',
  filterSearchText: '',
  // Sub-filter (tier-2). Set when user clicks a sub-chip after selecting
  // a primary chip with sub-filters defined in FILTER_SUBCHIPS.
  filterSubText: '',
  filterSubChips: FILTER_SUBCHIPS,
  filterChipOrder: FILTER_CHIP_ORDER,
  chipColors: CHIP_COLORS,
  // Sub-filters for the Under $20 + dividend tab.
  // lowPriceRange = annual-dividend amount bucket.
  // lowSharePrice = stock-price bucket (within the $20 cap).
  // lowDivYield = dividend-yield bucket (annual_rate / price * 100).
  lowPriceRange: '' as '' | 'under1' | '1to5' | '5to10',
  lowSharePrice: '' as '' | '1to5' | '5to10' | '10to15',
  lowDivYield: '' as '' | '1to10' | '10to20' | '20to30' | '30plus',
  screenerQuotes: {} as Record<string, { price: number | null; change_pct: number | null }>,
  loadingScreenerQuotes: false,
  screenerDividends: {} as Record<string, { annual_rate: number; latest_rate: number | null; latest_ex_date: string | null; payment_count: number }>,
  loadingScreenerDividends: false,
  // Matched-window total return per symbol vs. its category benchmark.
  // `days` is the number of trading days actually used (capped at 1460);
  // for newly-IPO'd names it can be much smaller than the requested
  // window so the comparison stays fair. `null` placeholder = in-flight
  // or known-missing, prevents retry storms.
  screenerChanges: {} as Record<string, { stock_pct: number | null; bench_pct: number | null; days: number } | null>,
  expandedScreenerRow: null as string | null,
  screenerBars: {} as Record<string, { loading?: boolean; error?: string; bars?: Array<{ t: string; c: number }>; chart?: Chart | null }>,
  _brokeragePollTimer: null as ReturnType<typeof setInterval> | null,
  _quoteFetchTimer: null as ReturnType<typeof setTimeout> | null,

  // Market — topCoins is shared by portfolios dashboard & marketplace.
  topCoins: [] as any[],
  // Bottom-strip ticker — populated on app init from Alpaca for a curated
  // list of broad-market ETFs and well-known large caps. Each entry is
  // shaped like topCoins so the template doesn't need a parallel block.
  tickerStocks: [] as Array<{ symbol: string; current_price_usd: number | null; price_change_1y: number | null }>,
  priceChart: null as Chart | null,
  selectedChartCoin: null as string | null,
  // /coins/:id/history cache keyed by `${coin}:${days}`, 5-min TTL.
  priceChartCache: new Map<string, { ts: number; prices: Array<{ timestamp: number; price: number }> }>(),

  // Add portfolio modal
  showAddPortfolio: false,
  newPortfolioName: '',

  // Add holding modal
  showAddHolding: false,
  holdingModalTab: 'search',
  holdingDropdownOpen: false,
  holdingSearch: '',
  holdingSearchResults: [] as any[],
  holdingDisplayCoins: [] as any[],
  holdingSearchLoading: false,
  selectedCoin: null as any,
  holdingAmount: '',
  holdingAvgPrice: '',
  addingHolding: false,

  // Wallet import
  walletAddress: '',
  txHash: '',
  txResolving: false,
  txResolveInfo: '',
  txResolveError: '',
  walletTokens: [] as any[],
  walletLoading: false,
  walletError: '',
  walletImporting: false,

  // Charts
  pieChart: null as Chart | null,
  lineChart: null as Chart | null,

  // Lookup
  lookupQuery: '',
  lookupLoading: false,
  lookupResult: null as any,
  // Native-asset USD per chain for the looked-up address. null = pending.
  lookupValues: {} as Record<string, number | null>,
  lookupError: '',

  // Marketplace
  marketplaceCoins: [] as any[],
  marketplaceLoading: false,
  marketplaceError: '',
  _marketplaceCache: {} as Record<string, any>,
  mkPage: 1,
  mkPerPage: 50,
  mkSearch: '',
  mkSort: 'price_desc',
  mkPinned: null as string | null,

  // Format helpers exposed on component for template binding
  fmtUSD, fmtPct, fmtAmount, fmtMktCap,

  async init(this: any) {
    await (Alpine.store('auth') as AuthStore).init();
    if (!(Alpine.store('auth') as AuthStore).isLoggedIn) return;
    await this._loadBrokerageState();
    // Await account load so we can redirect new users to onboarding
    // before the brokerage UI renders any deposit-gated controls.
    await this.loadBrokerageAccount();
    if (!this.brokerageAccount && this.page !== 'account-setup') {
      // First-time login with no Alpaca account yet — route to KYC.
      // Keeps the user from staring at an "empty" brokerage page with
      // a Deposit button that just bounces them here.
      this.page = 'account-setup';
    }
    this.loadWishlist();

    await this.loadPortfolios();
    if (this.portfolios.length) {
      this.activePortfolioId = this.portfolios[0].id;
      await this.loadPortfolioDetail();
    }
    this.$watch('page', (p: string) => {
      try { localStorage.setItem('currentPage', p); } catch {}
      if (p === 'marketplace') this.loadMarketplace();
      if (p === 'brokerage') {
        this.loadBrokerage();
        this.loadScreenerQuotes();
        this.loadScreenerDividends();
        this.loadScreenerPerformance();
        this.loadScreenerEdgarRisk();
        this._startBrokeragePoll();
      } else if (p === 'holdings') {
        this.loadBrokerage().then(() => this.loadHoldingsDividends());
        this._startBrokeragePoll();
      } else {
        this._stopBrokeragePoll();
      }
    });

    this.$watch('screenerCategory', (catId: string) => {
      // Reset tab-scoped sub-filters so they don't leak across tabs.
      if (catId !== 'low-price-dividend') {
        this.lowPriceRange = '';
        this.lowSharePrice = '';
        this.lowDivYield = '';
      }
      if (this.page === 'brokerage') {
        if (catId === 'filters') {
          this.loadFiltersData().then(() => this.loadFilterBars());
        } else {
          this.loadScreenerQuotes(catId);
          this.loadScreenerDividends(catId);
          this.loadScreenerPerformance(catId);
          this.loadScreenerEdgarRisk(catId);
        }
      }
    });

    this.$watch('wishListOpen', (open: boolean) => {
      if (open) this.loadWishListQuotes();
    });

    this.$watch('memoSlide', () => {
      if (this.page === 'investor-memo') this.renderMemoCharts();
    });
    this.$watch('page', (p: string) => {
      if (p === 'investor-memo') this.$nextTick(() => this.renderMemoCharts());
      if (p === 'personas') this.$nextTick(() => this.renderPersonaProjectionChart());
    });
    // Form-input changes re-render the projection (when nothing is being viewed).
    this.$watch('personaForm', () => {
      if (this.page === 'personas' && !this.personaViewingId) {
        this.$nextTick(() => this.renderPersonaProjectionChart());
      }
    });
    // Selecting a saved persona re-renders the projection with that persona's data.
    this.$watch('personaViewingId', () => {
      if (this.page === 'personas') this.$nextTick(() => this.renderPersonaProjectionChart());
    });
    // List change (save / edit / delete) keeps the viewed projection fresh.
    this.$watch('personas', () => {
      if (this.page === 'personas') this.$nextTick(() => this.renderPersonaProjectionChart());
    });

    this.$watch('holdingsPaletteMode', () => {
      if (this.page === 'holdings') {
        this.$nextTick(() => {
          if (this.holdingsPaletteMode === 'projection') {
            this.renderHoldingsProjection();
          } else {
            this.renderHoldingsChart();
            this.renderHoldingsDividendChart();
            this.renderHoldingsPriceChart();
          }
        });
      }
    });
    // Theme flip — legend label color is picked at chart-build time from
    // data-theme, so re-render any visible donut so it matches the new theme.
    window.addEventListener('themechange', () => {
      if (this.page === 'holdings' && this.holdingsPaletteMode !== 'projection') {
        this.$nextTick(() => {
          this.renderHoldingsChart();
          this.renderHoldingsDividendChart();
          this.renderHoldingsPriceChart();
        });
      }
    });
    // Re-render projection whenever underlying portfolio data shifts so the
    // chart stays in sync with live Alpaca polls and dividend resolution.
    this.$watch('alpacaPositions', () => {
      if (this.page === 'holdings' && this.holdingsPaletteMode === 'projection') {
        this.$nextTick(() => this.renderHoldingsProjection());
      }
    });
    this.$watch('screenerDividends', () => {
      if (this.page === 'holdings' && this.holdingsPaletteMode === 'projection') {
        this.$nextTick(() => this.renderHoldingsProjection());
      }
    });

    this.$watch('screenerView', (view: string) => {
      // Reset to first category in the new view so the tab list matches
      // the active selection.
      const cats = this.stockScreener.filter((c: any) =>
        view === 'etfs' ? c.view === 'etfs' : c.view !== 'etfs'
      );
      if (cats.length > 0) this.screenerCategory = cats[0].id;
    });

    // News panel under the order form follows the symbol field. The
    // panel is always rendered (just empty when there's no symbol),
    // so we fetch unconditionally on every symbol change. loadAlpacaNews
    // debounces 250ms and short-circuits when the symbol is identical
    // to the one already loaded.
    this.$watch('orderForm.symbol', (sym: string) => {
      this.loadAlpacaNews(sym);
      this.loadCompanyProfile(sym);
    });

    // Filter chip changes need to fetch quotes + performance pairs for
    // whatever the chip resolves to. Without this, stocks living in
    // categories the user hasn't visited (e.g. biotech rows in the
    // Dividend category) render without prices and without the
    // green/red performance-vs-benchmark arrow on the Filters tab.
    this.$watch('filterSearchText', () => {
      if (this.screenerCategory !== 'filters') return;
      this._hydrateFilterCandidates();
    });

    // Same pattern when the user toggles into the Filters tab itself —
    // make sure the currently-active chip's stocks have quotes loaded.
    this.$watch('screenerCategory', (catId: string) => {
      if (catId !== 'filters') return;
      this._hydrateFilterCandidates();
    });

    // Screener search auto-pivot: the filter is per-category, so a
    // ticker that lives under a different tab (e.g. NVDY in Dividend
    // ETFs while the user is on Mag 7) would silently return nothing.
    // If the query has no matches in the current category but does in
    // another, switch to the first tab that contains it.
    this.$watch('screenerSearch', (q: string) => {
      const query = (q || '').trim().toLowerCase();
      if (!query) return;
      const matches = (cat: any) =>
        (cat.stocks || []).some(
          (s: any) =>
            (s.symbol || '').toLowerCase().includes(query) ||
            (s.name || '').toLowerCase().includes(query),
        );
      const current = this.stockScreener.find((c: any) => c.id === this.screenerCategory);
      if (current && matches(current)) return;
      const target = this.stockScreener.find(matches);
      if (target) {
        this.screenerView = target.view === 'etfs' ? 'etfs' : 'stocks';
        this.screenerCategory = target.id;
      }
    });

    // When the filter chip / query changes, reset the tier-2 sub-filter
    // and preload bars for just the matched rows so arrows appear without
    // firing 245+ requests.
    this.$watch('filterSearchText', () => {
      this.filterSubText = '';
      if (this.page === 'brokerage' && this.screenerCategory === 'filters') {
        this.loadFilterBars();
      }
    });

    // Sub-filter changes don't expand the candidate set, but trigger a
    // bars preload so arrows are correct for the narrowed view.
    this.$watch('filterSubText', () => {
      if (this.page === 'brokerage' && this.screenerCategory === 'filters') {
        this.loadFilterBars();
      }
    });

    // If the restored page is marketplace/brokerage, kick off its data load
    // now — the $watch above only fires on future changes, not initial value.
    if (this.page === 'marketplace') this.loadMarketplace();
    if (this.page === 'brokerage') {
      this.loadBrokerage();
      this.loadScreenerQuotes();
      this.loadScreenerDividends();
      this.loadScreenerPerformance();
      this.loadScreenerEdgarRisk();
      this._startBrokeragePoll();
    }
    if (this.page === 'holdings') {
      this.loadBrokerage().then(() => this.loadHoldingsDividends());
      this._startBrokeragePoll();
    }

    this._refreshTimer = setInterval(async () => {
      if (this.activePortfolioId && !this.loadingPortfolio) {
        try {
          const res = await apiFetch<{ portfolio: any }>(`/portfolios/${this.activePortfolioId}`);
          this.portfolioDetail = res.portfolio;
          this.renderPieChart();
        } catch { /* ignore */ }
      }
    }, 90_000);

    setTimeout(() => {
      if (this.topCoins.length < 200) {
        apiFetch<{ coins: any[] }>('/coins/top?limit=200')
          .then((r) => { if (r) this.topCoins = r.coins; })
          .catch(() => {});
      }
      this.loadTickerStocks();
    }, 2000);

    this.$watch('holdingSearch', () => this._rebuildHoldingCoins());
    this.$watch('holdingSearchResults', () => this._rebuildHoldingCoins());
    this.$watch('topCoins', () => this._rebuildHoldingCoins());
  },

  // ── Portfolios ────────────────────────────────────────────────────────────

  async loadPortfolios(this: any) {
    const res = await apiFetch<{ portfolios: Portfolio[] }>('/portfolios');
    this.portfolios = res.portfolios;
  },

  async selectPortfolio(this: any, id: number) {
    this.activePortfolioId = id;
    await this.loadPortfolioDetail();
  },

  async loadPortfolioDetail(this: any) {
    if (!this.activePortfolioId) return;
    this.loadingPortfolio = true;
    this.activeWalletFilter = null;
    try {
      const res = await apiFetch<{ portfolio: any }>(`/portfolios/${this.activePortfolioId}`);
      this.portfolioDetail = res.portfolio;
      await this.$nextTick();
      this.renderPieChart();
      this.loadLastBuyFees();
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    } finally {
      this.loadingPortfolio = false;
    }
  },

  async loadLastBuyFees(this: any) {
    const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
    const EVM_CHAINS = new Set(['eth', 'bsc', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base', 'linea', 'zksync', 'scroll', 'blast']);
    // 24h cache — tx hashes are immutable; avoids Etherscan rate limits on refresh.
    const CACHE_TTL_S = 24 * 60 * 60;
    const cacheKey = (id: number) => `lbf:${id}`;

    const holdings = this.portfolioDetail?.holdings ?? [];
    const nextState: Record<number, any> = {};
    const jobs: Array<{ id: number; url: string }> = [];
    for (const h of holdings) {
      // Cache hit — use stored response, skip network entirely.
      const cached = lsGet<any>(cacheKey(h.id));
      if (cached && typeof cached === 'object') {
        nextState[h.id] = cached;
        continue;
      }

      const addr = h.wallet_address ?? '';
      // Prefer stored chain; fall back to address-shape detection for legacy rows.
      const storedChain = typeof h.chain === 'string' ? h.chain : null;
      let url: string | null = null;
      if (storedChain && EVM_CHAINS.has(storedChain)) {
        url = `/wallet/${storedChain}/${encodeURIComponent(addr)}/last-buy-fees?coingecko_id=${encodeURIComponent(h.coin.coingecko_id)}`;
      } else if (storedChain === 'solana') {
        url = `/wallet/solana/${encodeURIComponent(addr)}/last-buy-fees?coingecko_id=${encodeURIComponent(h.coin.coingecko_id)}`;
      } else if (EVM_RE.test(addr)) {
        url = `/wallet/eth/${encodeURIComponent(addr)}/last-buy-fees?coingecko_id=${encodeURIComponent(h.coin.coingecko_id)}`;
      } else if (SOL_RE.test(addr)) {
        url = `/wallet/solana/${encodeURIComponent(addr)}/last-buy-fees?coingecko_id=${encodeURIComponent(h.coin.coingecko_id)}`;
      }
      if (url) {
        nextState[h.id] = 'loading';
        jobs.push({ id: h.id, url });
      } else {
        nextState[h.id] = 'unavailable';
      }
    }
    this.lastBuyFees = nextState;

    for (const job of jobs) {
      try {
        const res = await apiFetch<{ fees: any }>(job.url);
        this.lastBuyFees = { ...this.lastBuyFees, [job.id]: res.fees };
        // Cache only success — null/unavailable would poison the 24h cache.
        if (res.fees && typeof res.fees === 'object') {
          lsSet(cacheKey(job.id), res.fees, CACHE_TTL_S);
        }
      } catch {
        this.lastBuyFees = { ...this.lastBuyFees, [job.id]: 'unavailable' };
      }
    }
  },

  async createPortfolio(this: any) {
    if (!this.newPortfolioName.trim()) return;
    try {
      const res = await apiFetch<{ portfolio: Portfolio }>('/portfolios', {
        method: 'POST',
        body: JSON.stringify({ name: this.newPortfolioName }),
      });
      this.portfolios.push(res.portfolio);
      this.activePortfolioId = res.portfolio.id;
      await this.loadPortfolioDetail();
      this.showAddPortfolio = false;
      this.newPortfolioName = '';
      (Alpine.store('toast') as ToastStore).show('Portfolio created');
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    }
  },

  async deletePortfolio(this: any, id: number) {
    if (!confirm('Delete this portfolio and all its holdings?')) return;
    try {
      await apiFetch(`/portfolios/${id}`, { method: 'DELETE' });
      this.portfolios = this.portfolios.filter((p: Portfolio) => p.id !== id);
      if (this.activePortfolioId === id) {
        this.activePortfolioId = this.portfolios[0]?.id || null;
        this.portfolioDetail = null;
        if (this.activePortfolioId) await this.loadPortfolioDetail();
      }
      (Alpine.store('toast') as ToastStore).show('Portfolio deleted');
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    }
  },

  // ── Holdings ──────────────────────────────────────────────────────────────

  async openAddHolding(this: any) {
    this._resetHoldingModal();
    this.showAddHolding = true;
    if (this.topCoins.length < 200) {
      try {
        const r = await apiFetch<{ coins: any[] }>('/coins/top?limit=200');
        this.topCoins = r.coins;
      } catch { /* ignore */ }
    }
    this._rebuildHoldingCoins();
  },

  closeAddHolding(this: any) {
    this.showAddHolding = false;
    this._resetHoldingModal();
  },

  _resetHoldingModal(this: any) {
    this.holdingModalTab = 'search';
    this.holdingSearch = '';
    this.holdingSearchResults = [];
    this.selectedCoin = null;
    this.holdingAmount = '';
    this.holdingAvgPrice = '';
    this.holdingDropdownOpen = false;
    this.walletAddress = '';
    this.walletTokens = [];
    this.walletError = '';
    this.txHash = '';
    this.txResolveInfo = '';
    this.txResolveError = '';
  },

  async resolveWalletFromTx(this: any) {
    const hash = this.txHash.trim();
    if (!hash) return;
    this.txResolving = true;
    this.txResolveInfo = '';
    this.txResolveError = '';
    try {
      const info = await apiFetch<{ address: string; chain: string; chain_name: string }>(
        `/wallet/from-tx/${encodeURIComponent(hash)}`,
      );
      this.walletAddress = info.address;
      this.txResolveInfo = `Found wallet on ${info.chain_name} — ready to fetch below.`;
    } catch (e) {
      this.txResolveError = (e as Error).message;
    } finally {
      this.txResolving = false;
    }
  },

  async fetchWalletTokens(this: any) {
    const addr = this.walletAddress.trim();
    if (!addr) return;
    this.walletLoading = true;
    this.walletError = '';
    this.walletTokens = [];
    try {
      const r = await apiFetch<{ balances: any[] }>(`/wallet/all/${encodeURIComponent(addr)}`);
      this.walletTokens = r.balances.map((t: any) => ({ ...t, selected: t.matched }));
      if (this.walletTokens.length === 0) {
        const placeholder = this.emptyWalletPlaceholder(addr);
        if (placeholder) this.walletTokens = [placeholder];
      }
    } catch (e) {
      this.walletError = (e as Error).message;
    } finally {
      this.walletLoading = false;
    }
  },

  emptyWalletPlaceholder(this: any, addr: string) {
    const chain = this.walletChain(addr);
    if (!chain) return null;
    const NATIVE: Record<string, { coingecko_id: string; symbol: string; name: string; chain_name: string }> = {
      evm:      { coingecko_id: 'ethereum', symbol: 'eth', name: 'Ethereum', chain_name: 'Ethereum' },
      solana:   { coingecko_id: 'solana',   symbol: 'sol', name: 'Solana',   chain_name: 'Solana' },
      tron:     { coingecko_id: 'tron',     symbol: 'trx', name: 'Tron',     chain_name: 'Tron' },
      bitcoin:  { coingecko_id: 'bitcoin',  symbol: 'btc', name: 'Bitcoin',  chain_name: 'Bitcoin' },
      litecoin: { coingecko_id: 'litecoin', symbol: 'ltc', name: 'Litecoin', chain_name: 'Litecoin' },
    };
    const n = NATIVE[chain.slug];
    if (!n) return null;
    return {
      ...n,
      amount: '0',
      contract_address: null,
      current_price_usd: null,
      image_url: null,
      matched: true,
      selected: true,
      placeholder: true,
    };
  },

  async importSelectedWalletTokens(this: any) {
    const toImport = this.walletTokens.filter((t: any) => t.selected);
    if (!toImport.length) return;
    this.walletImporting = true;
    const raw = this.walletAddress.trim();
    const walletAddr = /^0x[0-9a-fA-F]+$/.test(raw) ? raw.toLowerCase() : raw;
    let successCount = 0;
    let dupCount = 0;
    for (const token of toImport) {
      const coingeckoId = token.matched ? token.coingecko_id : token.contract_address;
      const body: any = {
        coingecko_id: coingeckoId,
        amount: token.amount,
        avg_buy_price: null,
        wallet_address: walletAddr,
        chain: token.chain ?? null,
        contract_address: token.contract_address,
      };
      if (!token.matched) {
        body.symbol = token.symbol;
        body.name = token.name;
        body.image_url = token.image_url;
      }
      try {
        await apiFetch(`/portfolios/${this.activePortfolioId}/holdings`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        successCount++;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('already') || msg.includes('taken')) {
          dupCount++;
        } else {
          (Alpine.store('toast') as ToastStore).show(`Skipped ${token.symbol}: ${msg}`, 'error');
        }
      }
    }
    this.walletImporting = false;
    if (successCount > 0) {
      await this.loadPortfolioDetail();
      this.closeAddHolding();
      const msg = dupCount > 0
        ? `Imported ${successCount} new holding${successCount > 1 ? 's' : ''} — skipped ${dupCount} already in portfolio`
        : `Imported ${successCount} holding${successCount > 1 ? 's' : ''}`;
      (Alpine.store('toast') as ToastStore).show(msg);
    } else if (dupCount > 0) {
      this.closeAddHolding();
      (Alpine.store('toast') as ToastStore).show('This wallet is already in your portfolio', 'error');
    }
  },

  _rebuildHoldingCoins(this: any) {
    const q = this.holdingSearch.toLowerCase().trim();
    const top = this.topCoins.map((c: any) => ({
      id: c.coingecko_id, name: c.name, symbol: c.symbol, thumb: c.image_url,
    }));
    const filtered = q
      ? top.filter((c: any) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
      : top;
    const ids = new Set(filtered.map((c: any) => c.id));
    const extra = this.holdingSearchResults.filter((c: any) => !ids.has(c.id));
    this.holdingDisplayCoins = [...filtered, ...extra];
  },

  searchHoldingCoins: debounce(async function (this: any, q: string) {
    if (this.selectedCoin && q !== this.selectedCoin.name) this.selectedCoin = null;
    if (q.length < 2) { this.holdingSearchResults = []; return; }
    this.holdingSearchLoading = true;
    try {
      const r = await apiFetch<{ results: any[] }>(`/coins/search?q=${encodeURIComponent(q)}`);
      this.holdingSearchResults = r.results;
    } finally {
      this.holdingSearchLoading = false;
    }
  }),

  selectHoldingCoin(this: any, coin: any) {
    this.selectedCoin = coin;
    this.holdingSearch = coin.name;
    this.holdingSearchResults = [];
    this.holdingDropdownOpen = false;
  },

  async addHolding(this: any) {
    if (!this.selectedCoin || !this.holdingAmount) return;
    this.addingHolding = true;
    try {
      await apiFetch(`/portfolios/${this.activePortfolioId}/holdings`, {
        method: 'POST',
        body: JSON.stringify({
          coingecko_id: this.selectedCoin.id,
          amount: parseFloat(this.holdingAmount),
          avg_buy_price: this.holdingAvgPrice ? parseFloat(this.holdingAvgPrice) : null,
        }),
      });
      await this.loadPortfolioDetail();
      this.closeAddHolding();
      (Alpine.store('toast') as ToastStore).show('Holding added');
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    } finally {
      this.addingHolding = false;
    }
  },

  async removeHolding(this: any, holdingId: number) {
    if (!confirm('Remove this holding?')) return;
    try {
      await apiFetch(`/portfolios/${this.activePortfolioId}/holdings/${holdingId}`, { method: 'DELETE' });
      await this.loadPortfolioDetail();
      (Alpine.store('toast') as ToastStore).show('Holding removed');
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    }
  },

  // ── Charts ────────────────────────────────────────────────────────────────

  renderPieChart(this: any) {
    const canvas = document.getElementById('pieChart') as HTMLCanvasElement | null;
    if (!canvas) return;
    if (getComputedStyle(canvas).display === 'none') return;

    // Drop holdings missing a positive numeric value (decimals-as-strings can leave nulls).
    const holdings = (this.portfolioDetail?.holdings ?? []).filter((h: any) => {
      const v = Number(h.current_value_usd);
      return Number.isFinite(v) && v > 0;
    });

    // Reconcile our ref with Chart.js's bound instance after page flips / DOM swaps.
    const bound = Chart.getChart(canvas);
    if (bound && bound !== this.pieChart) this.pieChart = bound;

    if (holdings.length === 0) {
      if (this.pieChart) {
        this.pieChart.destroy();
        this.pieChart = null;
      }
      return;
    }

    const labels = holdings.map((h: any) => h.coin.name);
    const data = holdings.map((h: any) => Number(h.current_value_usd));
    const colors = [
      '#b44dff', '#00e676', '#ff3366', '#cc77ff', '#00bcd4',
      '#7c3aed', '#39ff14', '#ff6ec7', '#a78bfa', '#0ff',
    ];
    const bgColors = colors.slice(0, data.length).map((c) => c + 'cc');
    const borderColors = colors.slice(0, data.length);

    // In-place update avoids flicker on 90s auto-refresh. try/catch handles
    // Chart.js's "Cannot set 'fullSize'" stale-layout throw — rebuild on fail.
    if (this.pieChart) {
      try {
        this.pieChart.data.labels = labels;
        this.pieChart.data.datasets[0].data = data;
        this.pieChart.data.datasets[0].backgroundColor = bgColors;
        this.pieChart.data.datasets[0].borderColor = borderColors;
        this.pieChart.update('none');
        return;
      } catch {
        this.pieChart.destroy();
        this.pieChart = null;
      }
    }

    const cfg: ChartConfiguration = {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 2,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#5c5280', boxWidth: 10, padding: 14, font: { size: 11, family: "'JetBrains Mono', monospace" } },
          },
          tooltip: {
            backgroundColor: '#0d0a1e',
            borderColor: '#261d4a',
            borderWidth: 1,
            titleColor: '#e8e0ff',
            bodyColor: '#b44dff',
            callbacks: {
              label: (ctx: any) => ` ${fmtUSD(ctx.raw)} (${(ctx.raw / ctx.dataset.data.reduce((a: number, b: number) => a + b, 0) * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    };
    this.pieChart = new Chart(canvas, cfg);
  },

  async renderPriceChart(this: any, coingeckoId: string, days = 30) {
    this.selectedChartCoin = coingeckoId;
    const canvas = document.getElementById('lineChart') as HTMLCanvasElement | null;
    if (!canvas) return;
    if (this.lineChart) this.lineChart.destroy();

    const cacheKey = `${coingeckoId}:${days}`;
    const cached = this.priceChartCache.get(cacheKey);
    const TTL_MS = 5 * 60 * 1000;

    try {
      let data: { prices: Array<{ timestamp: number; price: number }> };
      if (cached && Date.now() - cached.ts < TTL_MS) {
        data = { prices: cached.prices };
      } else {
        data = await apiFetch<{ prices: Array<{ timestamp: number; price: number }> }>(
          `/coins/${coingeckoId}/history?days=${days}`,
        );
        this.priceChartCache.set(cacheKey, { ts: Date.now(), prices: data.prices });
      }
      const labels = data.prices.map((p) => new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const prices = data.prices.map((p) => p.price);

      const cfg: ChartConfiguration = {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: coingeckoId.toUpperCase(),
            data: prices,
            borderColor: '#b44dff',
            backgroundColor: 'rgba(180,77,255,0.08)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { ticks: { color: '#5c5280', maxTicksLimit: 8, font: { size: 11 } }, grid: { color: '#261d4a' } },
            y: {
              ticks: { color: '#5c5280', font: { size: 11 }, callback: (v: any) => fmtUSD(v) },
              grid: { color: '#261d4a' },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx: any) => ` ${fmtUSD(ctx.raw)}` } },
          },
        },
      };
      this.lineChart = new Chart(canvas, cfg);
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message || 'Failed to load price chart', 'error');
    }
  },

  async loadBrokerage(this: any) {
    if (this.loadingBrokerage) return;
    this.loadingBrokerage = true;
    this.brokerageError = null;
    try {
      const [account, positions, orders] = await Promise.all([
        apiFetch<any>('/alpaca/account'),
        apiFetch<any[]>('/alpaca/positions'),
        apiFetch<any[]>('/alpaca/orders?status=all&limit=100'),
      ]);
      this.alpacaAccount = account;
      this.alpacaPositions = Array.isArray(positions) ? positions : [];
      this.alpacaOrders = Array.isArray(orders) ? orders : [];
      // Fire these in parallel but don't block the rest of loadBrokerage
      // on them — failure here is non-fatal (just leaves the cards
      // empty), and we don't want a slow activities response to delay
      // the account stats from rendering.
      this.loadAlpacaActivities();
      this.loadAlpacaPortfolioHistory();
      this.loadBrokerWithdrawals();
      this.loadRecurringInvestments();
      if (this.page === 'holdings') {
        // Pick up dividend data for any symbol that doesn't have it yet
        // (handles new buys mid-session — symbols absent from
        // screenerDividends are skipped by the helper, so this is cheap).
        this.loadHoldingsDividends();
        this.$nextTick(() => {
          this.renderHoldingsChart();
          this.renderHoldingsDividendChart();
          this.renderHoldingsPriceChart();
        });
      }
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load brokerage';
      this.brokerageError = msg === 'alpaca_not_configured'
        ? 'Alpaca credentials not configured on the server.'
        : msg;
    } finally {
      this.loadingBrokerage = false;
    }
  },

  // Fills, dividends, transfers, fees — the per-account ledger Alpaca
  // exposes. Sorted newest-first; we cap at 50 rows in the UI so the
  // activity card stays scannable.
  async loadAlpacaActivities(this: any) {
    if (this.loadingAlpacaActivities) return;
    this.loadingAlpacaActivities = true;
    try {
      const list = await apiFetch<any[]>('/alpaca/activities?page_size=50');
      this.alpacaActivities = Array.isArray(list) ? list : [];
    } catch {
      // Non-fatal — leave the prior list in place (or empty on first load).
      this.alpacaActivities = [];
    } finally {
      this.loadingAlpacaActivities = false;
    }
  },

  async loadAlpacaPortfolioHistory(this: any) {
    if (this.loadingAlpacaPortfolioHistory) return;
    this.loadingAlpacaPortfolioHistory = true;
    try {
      // Default: 1-month window with daily resolution. Tighten or widen
      // via query params later if we add period/timeframe controls.
      const h = await apiFetch<any>('/alpaca/portfolio-history?period=1M&timeframe=1D');
      this.alpacaPortfolioHistory = h || this.alpacaPortfolioHistory;
      this.$nextTick(() => this.renderPortfolioHistoryChart());
    } catch {
      // Leave the prior history in place — chart just won't re-render.
    } finally {
      this.loadingAlpacaPortfolioHistory = false;
    }
  },

  // Chart.js line for the equity series. Re-renders on every
  // loadAlpacaPortfolioHistory call so refreshes look immediate.
  _portfolioHistoryChart: null as any,
  renderPortfolioHistoryChart(this: any) {
    const canvas = document.getElementById('portfolio-history-chart') as HTMLCanvasElement | null;
    if (!canvas) return;
    const h = this.alpacaPortfolioHistory || {};
    const stamps: number[] = Array.isArray(h.timestamp) ? h.timestamp : [];
    const equity: number[] = Array.isArray(h.equity) ? h.equity : [];
    if (stamps.length === 0 || equity.length === 0) {
      if (this._portfolioHistoryChart) {
        this._portfolioHistoryChart.destroy();
        this._portfolioHistoryChart = null;
      }
      return;
    }
    const labels = stamps.map((t) =>
      new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
    if (this._portfolioHistoryChart) this._portfolioHistoryChart.destroy();
    // @ts-ignore — Chart is loaded globally via chart.js
    this._portfolioHistoryChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Equity',
            data: equity,
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168, 85, 247, 0.10)',
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => ' ' + fmtUSD(ctx.raw),
            },
          },
        },
        scales: {
          x: { ticks: { color: '#5c5280', maxTicksLimit: 6 }, grid: { display: false } },
          y: {
            ticks: { color: '#5c5280', callback: (v: any) => fmtUSD(v) },
            grid: { color: 'rgba(255,255,255,0.04)' },
          },
        },
      },
    });
  },

  async loadAlpacaQuote(this: any, symbol: string) {
    if (this._quoteFetchTimer) clearTimeout(this._quoteFetchTimer);
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) {
      this.alpacaQuote = null;
      this._stopLimitPriceRefresh();
      return;
    }
    this._quoteFetchTimer = setTimeout(async () => {
      await this._fetchAndApplyQuote(sym);
      this._startLimitPriceRefresh();
    }, 250);
  },

  // Company-profile fetcher — same debounce strategy as the news
  // loader. Backend caches 24h server-side so multi-user traffic is
  // a single Finnhub hit per ticker per day.
  _profileFetchTimer: null as number | null,
  async loadCompanyProfile(this: any, symbol: string) {
    if (this._profileFetchTimer) clearTimeout(this._profileFetchTimer);
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) {
      this.companyProfile = { symbol: '', data: null };
      return;
    }
    if (this.companyProfile.symbol === sym && this.companyProfile.data) return;

    this._profileFetchTimer = window.setTimeout(async () => {
      this.loadingCompanyProfile = true;
      try {
        const data = await apiFetch<any>(`/alpaca/profile/${encodeURIComponent(sym)}`);
        this.companyProfile = { symbol: sym, data };
      } catch {
        this.companyProfile = { symbol: sym, data: null };
      } finally {
        this.loadingCompanyProfile = false;
      }
    }, 250);
  },

  // Debounced news fetch — typing a ticker fires this on every input
  // event, so we wait for the keystrokes to settle before hitting
  // Alpaca. Same symbol back-to-back is a no-op (state already holds
  // the prior result).
  _newsFetchTimer: null as number | null,
  async loadAlpacaNews(this: any, symbol: string) {
    if (this._newsFetchTimer) clearTimeout(this._newsFetchTimer);
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) {
      this.alpacaNews = { symbol: '', articles: [] };
      this.alpacaNewsError = null;
      return;
    }
    // Cheap memo — clicking the same symbol that we're already showing
    // doesn't refetch.
    if (this.alpacaNews.symbol === sym && this.alpacaNews.articles.length > 0) return;

    this._newsFetchTimer = window.setTimeout(async () => {
      this.loadingAlpacaNews = true;
      this.alpacaNewsError = null;
      try {
        const resp = await apiFetch<any>(`/alpaca/news/${encodeURIComponent(sym)}`);
        // Alpaca wraps articles under `news`; absent on error/empty.
        const articles = Array.isArray(resp?.news) ? resp.news : [];
        this.alpacaNews = { symbol: sym, articles };
      } catch (e: any) {
        this.alpacaNews = { symbol: sym, articles: [] };
        this.alpacaNewsError = e?.message || 'Could not load news';
      } finally {
        this.loadingAlpacaNews = false;
      }
    }, 250);
  },

  // One-shot quote fetch + limit-price auto-fill. Field updates only when
  // empty or still matching the previous auto-fill (user hasn't customized).
  async _fetchAndApplyQuote(this: any, sym: string) {
    try {
      const q = await apiFetch<any>(`/alpaca/quote/${encodeURIComponent(sym)}`);
      if ((this.orderForm.symbol || '').trim().toUpperCase() !== sym) return;
      this.alpacaQuote = { symbol: sym, ...q };
      const price = Number(q?.price);
      if (!Number.isFinite(price) || price <= 0) return;
      const formatted = price.toFixed(2);
      const current = (this.orderForm.limit_price || '').trim();
      if (current === '' || current === this._lastAutoLimitPrice) {
        this.orderForm.limit_price = formatted;
        this._lastAutoLimitPrice = formatted;
      }
    } catch {
      this.alpacaQuote = null;
    }
  },

  // Re-fetches the quote every 15s while a symbol is selected. Once the
  // user types in the limit field, _lastAutoLimitPrice no longer matches
  // and subsequent polls leave their value alone.
  _startLimitPriceRefresh(this: any) {
    this._stopLimitPriceRefresh();
    this._quoteRefreshTimer = window.setInterval(() => {
      const sym = (this.orderForm.symbol || '').trim().toUpperCase();
      if (!sym) {
        this._stopLimitPriceRefresh();
        return;
      }
      this._fetchAndApplyQuote(sym);
    }, 15000);
  },

  _stopLimitPriceRefresh(this: any) {
    if (this._quoteRefreshTimer) {
      clearInterval(this._quoteRefreshTimer);
      this._quoteRefreshTimer = null;
    }
  },

  // Per-user localStorage key. Returns null until auth resolves so callers
  // can short-circuit instead of writing under a stale namespace.
  _lsKey(this: any, base: string): string | null {
    const uid = (Alpine.store('auth') as AuthStore).user?.id;
    return uid == null ? null : `${base}:${uid}`;
  },

  // Numeric id of the user's main / starter portfolio, or null while
  // the list is still loading. The destination for external Add-Funds
  // deposits and the source for internal transfers; replaces the legacy
  // 'main' string literal.
  mainPortfolioId(this: any): number | null {
    return this.brokeragePortfolios.find((p: any) => p.is_main)?.id ?? null;
  },

  // Hydrate brokerage state. Portfolios + allocations come from the API
  // (DB-backed, scoped to user_id). Cash/deposit bookkeeping still reads
  // per-user localStorage for now (Phase 3 territory). Active selection
  // is a UI preference; defaults to the main portfolio's id.
  async _loadBrokerageState(this: any) {
    const uid = (Alpine.store('auth') as AuthStore).user?.id;
    if (uid == null) return;
    const get = (k: string) => localStorage.getItem(`${k}:${uid}`);
    try {
      const [portsRes, allocsRes] = await Promise.all([
        apiFetch<{ portfolios: any[] }>('/brokerage/portfolios'),
        apiFetch<{ allocations: any[] }>('/brokerage/positions'),
      ]);
      this.brokeragePortfolios = portsRes.portfolios || [];
      this.positionAllocation = allocationsToMap(allocsRes.allocations || []);
    } catch {
      this.brokeragePortfolios = [];
      this.positionAllocation = {};
    }
    try {
      const savedActive = get('activeBrokeragePortfolioId');
      const mainId = this.mainPortfolioId();
      if (savedActive === 'all') {
        this.activeBrokeragePortfolioId = 'all';
      } else if (savedActive != null) {
        const n = parseInt(savedActive, 10);
        const stillExists = this.brokeragePortfolios.some((p: any) => p.id === n);
        this.activeBrokeragePortfolioId = stillExists ? n : (mainId ?? 'all');
      } else {
        this.activeBrokeragePortfolioId = mainId ?? 'all';
      }
      this.brokerageRewardsByPortfolio = JSON.parse(get('brokerageRewardsByPortfolio') || '{}');
      this.totalDeposited = parseFloat(get('totalDeposited') || '0') || 0;
      this.portfolioCash = JSON.parse(get('portfolioCash') || '{}');
      this.portfolioDeposited = JSON.parse(get('portfolioDeposited') || '{}');
    } catch {}
  },

  // PUT the new allocation map for a symbol and reflect the response in
  // local state. Used by both the allocation editor and the order-place
  // flow — both replace the full per-symbol map atomically.
  async _saveSymbolAllocation(
    this: any,
    symbol: string,
    allocations: Record<string, number>,
  ) {
    const sym = symbol.toUpperCase();
    const body: Record<string, string> = {};
    for (const [pid, qty] of Object.entries(allocations)) {
      if (qty > 0) body[pid] = String(qty);
    }
    const res = await apiFetch<{ symbol: string; allocations: any[] }>(
      `/brokerage/positions/${encodeURIComponent(sym)}`,
      { method: 'PUT', body: JSON.stringify({ allocations: body }) },
    );
    const next = { ...this.positionAllocation };
    if (res.allocations.length === 0) {
      delete next[sym];
    } else {
      const map: Record<string, number> = {};
      for (const a of res.allocations) {
        map[String(a.portfolio_id)] = parseFloat(a.qty) || 0;
      }
      next[sym] = map;
    }
    this.positionAllocation = next;
  },

  // Persist active portfolio selection (UI preference). The list itself
  // is server-managed — no localStorage writes for it anymore.
  _saveBrokeragePortfolios(this: any) {
    const k = this._lsKey('activeBrokeragePortfolioId');
    if (!k) return;
    try {
      localStorage.setItem(k, String(this.activeBrokeragePortfolioId));
    } catch {}
  },

  // Total allocated qty across all portfolios for a symbol.
  _totalAllocated(this: any, symbol: string): number {
    const m = this.positionAllocation[symbol] || {};
    return Object.values(m).reduce((s: number, v: any) => s + (parseFloat(v) || 0), 0);
  },

  // Primary portfolio (id) for a symbol — the first entry in the
  // allocation map with positive qty. Used by the Recent Orders column
  // for the per-row portfolio tag. Replaces the old `positionPortfolioMap`
  // localStorage state (now derived).
  primaryPortfolioFor(this: any, symbol: string): any {
    const allocs = this.positionAllocation[symbol] || {};
    for (const [pid, qty] of Object.entries(allocs)) {
      if ((qty as number) > 0) {
        return this.brokeragePortfolios.find((p: any) => p.id === parseInt(pid, 10)) || null;
      }
    }
    return null;
  },

  setActiveBrokeragePortfolio(this: any, id: number | string) {
    // Templates pass either a numeric portfolio id or the literal 'all'.
    // The select element passes a string; coerce numeric strings to numbers.
    if (id === 'all') {
      this.activeBrokeragePortfolioId = 'all';
    } else if (typeof id === 'string') {
      const n = parseInt(id, 10);
      this.activeBrokeragePortfolioId = Number.isFinite(n) ? n : 'all';
    } else {
      this.activeBrokeragePortfolioId = id;
    }
    this._saveBrokeragePortfolios();
    if (this.page === 'holdings') {
      this.$nextTick(() => {
        this.renderHoldingsChart();
        this.renderHoldingsDividendChart();
        this.renderHoldingsPriceChart();
      });
    }
  },

  _savePortfolioCash(this: any) {
    const k1 = this._lsKey('totalDeposited');
    const k2 = this._lsKey('portfolioCash');
    const k3 = this._lsKey('portfolioDeposited');
    if (!k1 || !k2 || !k3) return;
    try {
      localStorage.setItem(k1, String(this.totalDeposited));
      localStorage.setItem(k2, JSON.stringify(this.portfolioCash));
      localStorage.setItem(k3, JSON.stringify(this.portfolioDeposited));
    } catch {}
  },

  // Total deposited shown for the active portfolio. 'all' shows the
  // global lifetime number; specific portfolios show only their own
  // inflows (Main = external deposits, others = transfers in).
  depositedForActivePortfolio(this: any) {
    const id = this.activeBrokeragePortfolioId;
    if (id === 'all') return this.totalDeposited;
    return parseFloat(this.portfolioDeposited[id]) || 0;
  },

  // Cash for the active portfolio. 'all' sums across every portfolio.
  cashForActivePortfolio(this: any) {
    const id = this.activeBrokeragePortfolioId;
    if (id === 'all') {
      return Object.values(this.portfolioCash).reduce(
        (s: number, v: any) => s + (parseFloat(v) || 0),
        0
      );
    }
    return parseFloat(this.portfolioCash[id]) || 0;
  },

  // Add Funds — POSTs the deposit intent to /api/broker/funding/deposits
  // (stub Broker API endpoint). On success: bumps local Main cash + total
  // deposited so the UI reflects the pending balance, and records the
  // returned deposit row in `brokerDeposits` for the pending-deposits list.
  // When the real Alpaca Broker call lands server-side, this same flow
  // will move actual money — only the backend changes.
  async submitAddFunds(this: any) {
    if (this.addFundsSubmitting) return;
    const amt = parseFloat(this.addFundsAmount);
    if (!amt || amt <= 0) return;

    this.addFundsSubmitting = true;
    this.addFundsError = '';
    try {
      const deposit = await apiFetch<any>('/broker/funding/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt.toFixed(2),
          method: this.addFundsMethod,
          bank_label: this.addFundsBankLabel,
        }),
      });
      this.brokerDeposits = [deposit, ...this.brokerDeposits];

      // Alpaca rejected the transfer — show the error inline; don't
      // credit cash, don't close the modal.
      if (deposit.status === 'failed') {
        this.addFundsError = deposit.note || 'Deposit failed at Alpaca.';
        return;
      }

      // Optimistically credit the user's main portfolio. When status
      // updates arrive (webhook → DB → /broker/funding/deposits refetch),
      // this snapshot is reconciled.
      const mainId = this.mainPortfolioId();
      if (mainId != null) {
        this.totalDeposited += amt;
        this.portfolioCash = {
          ...this.portfolioCash,
          [mainId]: (parseFloat(this.portfolioCash[mainId]) || 0) + amt,
        };
        this.portfolioDeposited = {
          ...this.portfolioDeposited,
          [mainId]: (parseFloat(this.portfolioDeposited[mainId]) || 0) + amt,
        };
        this._savePortfolioCash();
      }

      this.addFundsOpen = false;
      this.addFundsAmount = '';
      (Alpine.store('toast') as ToastStore).show(
        `${this.fmtUSD(amt)} deposit initiated · ${deposit.reference}`,
        'success'
      );
    } catch (e: any) {
      this.addFundsError = e?.message || 'Deposit failed. Please try again.';
    } finally {
      this.addFundsSubmitting = false;
    }
  },

  // Mirror of submitAddFunds for the OUTGOING side. Optimistically debits
  // local portfolio cash so the UI feels instant; the next loadBrokerage
  // tick reconciles against server state.
  async submitWithdrawal(this: any) {
    if (this.withdrawSubmitting) return;
    const amt = parseFloat(this.withdrawAmount);
    if (!amt || amt <= 0) return;

    this.withdrawSubmitting = true;
    this.withdrawError = '';
    try {
      const withdrawal = await apiFetch<any>('/broker/funding/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt.toFixed(2),
          method: this.withdrawMethod,
          bank_label: this.withdrawBankLabel,
        }),
      });
      this.brokerWithdrawals = [withdrawal, ...this.brokerWithdrawals];

      if (withdrawal.status === 'failed') {
        this.withdrawError = withdrawal.note || 'Withdrawal failed at Alpaca.';
        return;
      }

      // Optimistic debit on the user's main portfolio. Reconciled by
      // the next loadBrokerage / portfolioCash refresh.
      const mainId = this.mainPortfolioId();
      if (mainId != null) {
        this.portfolioCash = {
          ...this.portfolioCash,
          [mainId]: Math.max(0, (parseFloat(this.portfolioCash[mainId]) || 0) - amt),
        };
        this._savePortfolioCash();
      }

      this.withdrawOpen = false;
      this.withdrawAmount = '';
      (Alpine.store('toast') as ToastStore).show(
        `${this.fmtUSD(amt)} withdrawal initiated · ${withdrawal.reference}`,
        'success'
      );
      // Refresh activity log + history to reflect the new transfer.
      this.loadAlpacaActivities();
      this.loadAlpacaPortfolioHistory();
    } catch (e: any) {
      this.withdrawError = e?.message || 'Withdrawal failed. Please try again.';
    } finally {
      this.withdrawSubmitting = false;
    }
  },

  async loadBrokerWithdrawals(this: any) {
    try {
      const res = await apiFetch<{ withdrawals: any[] }>('/broker/funding/withdrawals');
      this.brokerWithdrawals = res.withdrawals || [];
    } catch {
      this.brokerWithdrawals = [];
    }
  },

  // ── Recurring investments ─────────────────────────────────────────────

  async loadRecurringInvestments(this: any) {
    if (this.loadingRecurring) return;
    this.loadingRecurring = true;
    try {
      const res = await apiFetch<{ items: any[] }>('/recurring-investments');
      this.recurringInvestments = res.items || [];
    } catch {
      this.recurringInvestments = [];
    } finally {
      this.loadingRecurring = false;
    }
  },

  async createRecurringInvestment(this: any) {
    if (this.recurringSubmitting) return;
    const sym = (this.recurringForm.symbol || '').trim().toUpperCase();
    const qty = parseFloat(this.recurringForm.qty);
    if (!sym || !Number.isFinite(qty) || qty <= 0) {
      this.recurringError = 'Symbol and quantity are required.';
      return;
    }

    this.recurringSubmitting = true;
    this.recurringError = '';
    try {
      const body: any = {
        symbol: sym,
        qty: qty.toString(),
        side: this.recurringForm.side,
        order_type: this.recurringForm.order_type,
        time_in_force: 'day',
        frequency: this.recurringForm.frequency,
      };
      if (this.recurringForm.order_type === 'limit' && this.recurringForm.limit_price) {
        body.limit_price = parseFloat(this.recurringForm.limit_price).toString();
      }
      if (this.recurringForm.starts_at) {
        // datetime-local input gives "YYYY-MM-DDTHH:mm" with no zone —
        // attach a Z so the server parses it as UTC. Local-vs-UTC
        // mismatch is acceptable for this v0; we can add a TZ picker later.
        body.starts_at = this.recurringForm.starts_at + ':00Z';
      }

      const res = await apiFetch<{ item: any }>('/recurring-investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      this.recurringInvestments = [res.item, ...this.recurringInvestments];
      this.recurringForm.symbol = '';
      this.recurringForm.qty = '1';
      this.recurringForm.limit_price = '';
      this.recurringForm.starts_at = '';
      (Alpine.store('toast') as ToastStore).show(
        `Recurring ${this.recurringForm.frequency} buy created for ${sym}`,
        'success'
      );
    } catch (e: any) {
      this.recurringError = e?.message || 'Could not create recurring investment.';
    } finally {
      this.recurringSubmitting = false;
    }
  },

  async toggleRecurringInvestment(this: any, item: any) {
    try {
      const res = await apiFetch<{ item: any }>(`/recurring-investments/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      this.recurringInvestments = this.recurringInvestments.map((i: any) =>
        i.id === item.id ? res.item : i,
      );
    } catch (e: any) {
      (Alpine.store('toast') as ToastStore).show(
        e?.message || 'Could not update recurring investment',
        'error'
      );
    }
  },

  async deleteRecurringInvestment(this: any, item: any) {
    if (!confirm(`Delete recurring ${item.frequency} ${item.side} for ${item.symbol}?`)) return;
    try {
      await apiFetch(`/recurring-investments/${item.id}`, { method: 'DELETE' });
      this.recurringInvestments = this.recurringInvestments.filter((i: any) => i.id !== item.id);
    } catch (e: any) {
      (Alpine.store('toast') as ToastStore).show(
        e?.message || 'Could not delete recurring investment',
        'error'
      );
    }
  },

  async loadBrokerDeposits(this: any) {
    try {
      const res = await apiFetch<{ deposits: any[] }>('/broker/funding/deposits');
      this.brokerDeposits = res.deposits || [];
    } catch {
      // Swallow — pending deposits are nice-to-have, not load-blocking.
    }
  },

  // Fetch the user's Alpaca account state (or null if no onboarding yet).
  // Called on init + after KYC submit. Drives the Add Funds gate.
  //
  // The backend refreshes from Alpaca on read when status is pending,
  // so repeated polling here drives status forward without needing a
  // separate refresh endpoint. Once we see kyc_state === 'active', we
  // stop the poll loop and let the user click Add Funds.
  async loadBrokerageAccount(this: any) {
    try {
      const res = await apiFetch<{ account: any }>('/brokerage/account');
      const prevState = this.brokerageAccount?.kyc_state;
      this.brokerageAccount = res.account;
      // First time we see kyc=active (post-onboarding settlement),
      // refresh the Alpaca trading snapshot so the brokerage/holdings
      // pages stop showing empty/disabled state without a manual reload.
      if (prevState !== 'active' && res.account?.kyc_state === 'active') {
        if (this.page === 'brokerage' || this.page === 'holdings') {
          this.loadBrokerage();
        }
      }
    } catch (e: any) {
      // 404 = no account yet; any other error = treat as missing.
      this.brokerageAccount = null;
    }
    this._scheduleAccountPoll();
  },

  // Internal: poll the account endpoint every 4s while status is
  // pending. Sandbox approval typically completes in 5–15s; 4s strikes
  // a balance between responsive UI and Alpaca API politeness. Cleared
  // once kyc_state hits 'active' (or 'failed') so we don't poll forever.
  _accountPollTimer: null as ReturnType<typeof setTimeout> | null,
  _scheduleAccountPoll(this: any) {
    if (this._accountPollTimer) {
      clearTimeout(this._accountPollTimer);
      this._accountPollTimer = null;
    }
    const state = this.brokerageAccount?.kyc_state;
    if (state && state !== 'active' && state !== 'failed') {
      this._accountPollTimer = setTimeout(() => this.loadBrokerageAccount(), 4000);
    }
  },

  // Convenience predicate for templates: can the user actually deposit?
  canDeposit(this: any): boolean {
    return this.brokerageAccount?.kyc_state === 'active';
  },

  // Submit KYC form to the backend. Validates agreements client-side;
  // backend re-validates everything and forwards to Alpaca.
  async submitKyc(this: any) {
    this.kycError = '';
    this.kycFieldErrors = [];

    const f = this.kycForm;
    if (!f.agreement_margin || !f.agreement_account || !f.agreement_customer) {
      this.kycError = 'You must accept all three agreements to continue.';
      return;
    }

    const payload = {
      given_name: f.given_name,
      middle_name: f.middle_name || undefined,
      family_name: f.family_name,
      date_of_birth: f.date_of_birth,
      tax_id: f.tax_id,
      phone_number: f.phone_number,
      street_address: f.street_address,
      city: f.city,
      state: f.state.toUpperCase(),
      postal_code: f.postal_code,
      country: f.country,
      country_of_citizenship: f.country_of_citizenship,
      country_of_birth: f.country_of_birth,
      country_of_tax_residence: f.country_of_tax_residence,
      funding_source: [f.funding_source],
      is_control_person: f.is_control_person,
      is_affiliated_exchange_or_finra: f.is_affiliated_exchange_or_finra,
      is_politically_exposed: f.is_politically_exposed,
      immediate_family_exposed: f.immediate_family_exposed,
    };

    this.kycSubmitting = true;
    try {
      const res = await apiFetch<{ account: any }>('/brokerage/account', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      this.brokerageAccount = res.account;
      // Kick off the pending→active poller so the UI advances on its
      // own; without this the user would need to refresh after Alpaca
      // approval lands.
      this._scheduleAccountPoll();
      // Clear sensitive fields immediately on success — don't leave SSN
      // sitting in component state any longer than necessary.
      this.kycForm.tax_id = '';
      (Alpine.store('toast') as ToastStore).show(
        'Account submitted — approval typically completes in a few seconds.',
        'success',
      );
      this.page = 'brokerage';
    } catch (e: any) {
      const status = e?.status;
      const body = e?.body;
      if (status === 422 && body?.error === 'missing_fields') {
        this.kycFieldErrors = body.fields || [];
        this.kycError = `Missing: ${(body.fields || []).join(', ')}`;
      } else if (status === 422 && body?.error === 'alpaca_rejected') {
        this.kycError = `Alpaca rejected: ${body.message}`;
      } else if (status === 409) {
        this.kycError = 'You already have a brokerage account.';
        this.loadBrokerageAccount();
      } else {
        this.kycError = e?.message || 'Submission failed. Please try again.';
      }
    } finally {
      this.kycSubmitting = false;
    }
  },

  // Transfer Main → active portfolio. Internal, zero-sum.
  submitTransfer(this: any) {
    const amt = parseFloat(this.transferAmount);
    const target = this.activeBrokeragePortfolioId;
    const mainId = this.mainPortfolioId();
    if (!amt || amt <= 0) return;
    if (mainId == null || target === mainId || target === 'all') return;
    const mainCash = parseFloat(this.portfolioCash[mainId]) || 0;
    if (amt > mainCash) {
      (Alpine.store('toast') as ToastStore).show('Insufficient funds in Main Account', 'error');
      return;
    }
    this.portfolioCash = {
      ...this.portfolioCash,
      [mainId]: mainCash - amt,
      [target]: (parseFloat(this.portfolioCash[target]) || 0) + amt,
    };
    // Bump only the destination's cumulative deposits — Main's stays
    // anchored to its external-deposit history.
    this.portfolioDeposited = {
      ...this.portfolioDeposited,
      [target]: (parseFloat(this.portfolioDeposited[target]) || 0) + amt,
    };
    this._savePortfolioCash();
    this.transferModalOpen = false;
    this.transferAmount = '';
    const portfolioName = this.brokeragePortfolios.find((p: any) => p.id === target)?.name || target;
    (Alpine.store('toast') as ToastStore).show(`${this.fmtUSD(amt)} transferred to ${portfolioName}`, 'success');
  },

  rewardsForActivePortfolio(this: any) {
    const id = this.activeBrokeragePortfolioId;
    return this.brokerageRewardsByPortfolio[id] || 0;
  },

  // Positions for the active portfolio.
  // 'all' returns the user's full Alpaca position list as-is (the
  // backend already scopes by user — Broker API per-customer endpoint).
  // A specific portfolio prorates by the user's per-portfolio allocation
  // for each symbol, so positions without an explicit allocation in
  // that bucket are hidden.
  filteredAlpacaPositions(this: any) {
    const id = this.activeBrokeragePortfolioId;
    if (id === 'all') return this.alpacaPositions || [];

    const out: any[] = [];
    for (const p of this.alpacaPositions || []) {
      const allocQty = parseFloat(this.positionAllocation[p.symbol]?.[id]) || 0;
      if (allocQty <= 0) continue;
      const totalQty = parseFloat(p.qty) || 0;
      if (totalQty <= 0) continue;
      const ratio = allocQty / totalQty;
      out.push({
        ...p,
        qty: String(allocQty),
        market_value: String((parseFloat(p.market_value) || 0) * ratio),
        cost_basis: String((parseFloat(p.cost_basis) || 0) * ratio),
        unrealized_pl: String((parseFloat(p.unrealized_pl) || 0) * ratio),
        unrealized_intraday_pl: String((parseFloat(p.unrealized_intraday_pl) || 0) * ratio),
        // current_price, avg_entry_price, unrealized_plpc are per-share
        // and don't change with the allocation ratio.
      });
    }
    return out;
  },

  // ── Wish list ─────────────────────────────────────────────────────────
  // Server is the source of truth; we mirror `_wishlistItems` after every
  // API response and rebuild the template-facing `wishList` + `wishListQty`
  // fields from it.

  _hydrateWishlist(this: any, items: any[]) {
    this._wishlistItems = (items || []).slice().sort(
      (a: any, b: any) => a.position - b.position,
    );
    this.wishList = this._wishlistItems.map((i: any) => i.symbol);
    const qty: Record<string, string> = {};
    for (const i of this._wishlistItems) {
      // Strip trailing zeros — server returns "5.00000000" for qty=5.
      const n = parseFloat(i.qty);
      if (Number.isFinite(n) && n > 0) qty[i.symbol] = String(n);
    }
    this.wishListQty = qty;
  },

  async loadWishlist(this: any) {
    try {
      const res = await apiFetch<{ items: any[] }>('/wishlist');
      this._hydrateWishlist(res.items || []);
    } catch {
      this._hydrateWishlist([]);
    }
  },

  async addToWishList(this: any, raw: string) {
    const sym = (raw || '').trim().toUpperCase();
    if (!sym) return;
    if (this.wishList.includes(sym)) {
      this.wishListInput = '';
      return;
    }
    try {
      const res = await apiFetch<{ item: any }>('/wishlist', {
        method: 'POST',
        body: JSON.stringify({ symbol: sym, qty: '1' }),
      });
      this._hydrateWishlist([...this._wishlistItems, res.item]);
      this.wishListInput = '';
    } catch (e: any) {
      (Alpine.store('toast') as ToastStore).show(
        e?.message || 'Could not add to wishlist',
        'error',
      );
    }
  },

  async removeFromWishList(this: any, symbol: string) {
    const sym = (symbol || '').toUpperCase();
    const item = this._wishlistItems.find((i: any) => i.symbol === sym);
    if (!item) return;
    try {
      await apiFetch(`/wishlist/${item.id}`, { method: 'DELETE' });
      this._hydrateWishlist(this._wishlistItems.filter((i: any) => i.id !== item.id));
    } catch (e: any) {
      (Alpine.store('toast') as ToastStore).show(
        e?.message || 'Could not remove from wishlist',
        'error',
      );
    }
  },

  isInWishList(this: any, symbol: string): boolean {
    return this.wishList.includes((symbol || '').toUpperCase());
  },

  async toggleWishList(this: any, symbol: string) {
    const sym = (symbol || '').toUpperCase();
    if (!sym) return;
    if (this.wishList.includes(sym)) {
      await this.removeFromWishList(sym);
    } else {
      await this.addToWishList(sym);
    }
  },

  buyFromWishList(this: any, symbol: string) {
    this.pickScreenerSymbol(symbol);
    this.wishListOpen = false;
  },

  // Debounced qty updates — the input is keystrokes; we don't want to
  // POST on every digit. Persists 400ms after the last edit.
  _wishListQtyTimers: {} as Record<string, ReturnType<typeof setTimeout>>,
  setWishListQty(this: any, symbol: string, val: string) {
    const sym = (symbol || '').toUpperCase();
    if (!sym) return;
    // Optimistic local update so the input stays responsive.
    this.wishListQty = { ...this.wishListQty, [sym]: val };
    const n = parseFloat(val);
    if (!Number.isFinite(n) || n <= 0) return;

    if (this._wishListQtyTimers[sym]) clearTimeout(this._wishListQtyTimers[sym]);
    this._wishListQtyTimers[sym] = setTimeout(async () => {
      try {
        const res = await apiFetch<{ item: any }>('/wishlist', {
          method: 'POST',
          body: JSON.stringify({ symbol: sym, qty: String(n) }),
        });
        // Merge the server's authoritative copy back in.
        const next = this._wishlistItems.map((i: any) =>
          i.symbol === sym ? res.item : i,
        );
        this._hydrateWishlist(next);
      } catch (e: any) {
        (Alpine.store('toast') as ToastStore).show(
          e?.message || 'Could not save quantity',
          'error',
        );
      }
    }, 400);
  },

  // Drag-and-drop reorder: swap the dragged row into the target slot.
  async moveWishListItem(this: any, fromIdx: number, toIdx: number) {
    if (fromIdx == null || fromIdx === toIdx) {
      this.wishListDragIndex = null;
      return;
    }
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= this._wishlistItems.length || toIdx >= this._wishlistItems.length) {
      this.wishListDragIndex = null;
      return;
    }
    const next = [...this._wishlistItems];
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    // Optimistic UI update so the drag feels instant.
    this._hydrateWishlist(next.map((i: any, idx: number) => ({ ...i, position: idx })));
    this.wishListDragIndex = null;
    try {
      const res = await apiFetch<{ items: any[] }>('/wishlist/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: next.map((i: any) => i.id) }),
      });
      this._hydrateWishlist(res.items || []);
    } catch (e: any) {
      (Alpine.store('toast') as ToastStore).show(
        e?.message || 'Could not save order',
        'error',
      );
      // Re-fetch to recover from the failed reorder.
      this.loadWishlist();
    }
  },

  // Fetch live snapshot prices for any wish-list symbols not yet in
  // `screenerQuotes`. The screener page populates that map only for tabs
  // the user has visited, so an entry like AAPL might not have a price
  // when the wish list opens from outside the brokerage screener.
  async loadWishListQuotes(this: any) {
    const missing = this.wishList.filter((s: string) => !this.screenerQuotes[s]);
    if (missing.length === 0) return;
    try {
      const data = await apiFetch<Record<string, { price: number | null; change_pct: number | null }>>(
        `/alpaca/snapshots?symbols=${encodeURIComponent(missing.join(','))}`
      );
      this.screenerQuotes = { ...this.screenerQuotes, ...data };
    } catch {
      // Silent — rows just show no price.
    }
  },

  // Sum of (qty × price) across the user's wishlist. Returns:
  //   total       — dollars committed if every order fills at current price
  //   priced      — count of symbols with both a qty and a live price
  //   unpriced    — symbols with qty but no quote yet (price loading)
  //   noQty       — symbols on the list but no qty entered
  // UI shows the total as an estimate ("~$X") with the unpriced/noQty
  // counts in muted text so the user understands when it's incomplete.
  wishlistSubtotal(this: any) {
    let total = 0;
    let priced = 0;
    let unpriced = 0;
    let noQty = 0;
    for (const sym of this.wishList) {
      const qty = parseFloat(this.wishListQty[sym]);
      if (!Number.isFinite(qty) || qty <= 0) {
        noQty += 1;
        continue;
      }
      const price = Number(this.screenerQuotes[sym]?.price);
      if (!Number.isFinite(price) || price <= 0) {
        unpriced += 1;
        continue;
      }
      total += qty * price;
      priced += 1;
    }
    return { total, priced, unpriced, noQty };
  },

  openAllocationEdit(this: any, symbol: string) {
    this.allocationEditSymbol = symbol;
    const current = this.positionAllocation[symbol] || {};
    const values: Record<string, string> = {};
    for (const p of this.brokeragePortfolios) {
      values[p.id] = String(current[p.id] || 0);
    }
    this.allocationEditValues = values;
    this.allocationEditOpen = true;
  },

  async saveAllocationEdit(this: any) {
    const symbol = this.allocationEditSymbol;
    if (!symbol) return;
    const newAlloc: Record<string, number> = {};
    for (const [pid, v] of Object.entries(this.allocationEditValues)) {
      const n = parseFloat(v as string);
      if (n > 0) newAlloc[pid] = n;
    }
    try {
      await this._saveSymbolAllocation(symbol, newAlloc);
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show(
        (e as Error).message || 'Could not save allocation',
        'error',
      );
      return;
    }
    this.allocationEditOpen = false;
    if (this.page === 'holdings') {
      this.$nextTick(() => {
        this.renderHoldingsChart();
        this.renderHoldingsDividendChart();
        this.renderHoldingsPriceChart();
      });
    }
  },

  async createBrokeragePortfolio(this: any) {
    const name = (this.newBrokeragePortfolioName || '').trim();
    if (!name) return;
    try {
      const res = await apiFetch<{ portfolio: any }>('/brokerage/portfolios', {
        method: 'POST',
        body: JSON.stringify({ name, color: this.newBrokeragePortfolioColor }),
      });
      this.brokeragePortfolios = [...this.brokeragePortfolios, res.portfolio];
      this.activeBrokeragePortfolioId = res.portfolio.id;
      this.newBrokeragePortfolioOpen = false;
      this.newBrokeragePortfolioName = '';
      this.newBrokeragePortfolioColor = '#b44dff';
      this._saveBrokeragePortfolios();
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show(
        (e as Error).message || 'Could not create portfolio',
        'error',
      );
    }
  },

  async deleteBrokeragePortfolio(this: any, id: number) {
    const target = this.brokeragePortfolios.find((p: any) => p.id === id);
    if (!target || target.is_main) return;  // can't delete the main portfolio
    try {
      await apiFetch(`/brokerage/portfolios/${id}`, { method: 'DELETE' });
      this.brokeragePortfolios = this.brokeragePortfolios.filter((p: any) => p.id !== id);
      if (this.activeBrokeragePortfolioId === id) {
        this.activeBrokeragePortfolioId = this.mainPortfolioId() ?? 'all';
      }
      this._saveBrokeragePortfolios();
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show(
        (e as Error).message || 'Could not delete portfolio',
        'error',
      );
    }
  },

  async submitContactForm(this: any) {
    this.contactError = null;
    this.contactSubmitting = true;
    try {
      await apiFetch('/contact', {
        method: 'POST',
        body: JSON.stringify(this.contactForm),
      });
      this.contactSent = true;
      this.contactForm = { name: '', email: '', subject: '', message: '' };
    } catch (e) {
      this.contactError = (e as Error).message || 'Could not send message.';
    } finally {
      this.contactSubmitting = false;
    }
  },

  async submitAlpacaOrder(this: any) {
    this.orderError = null;
    this.orderSubmitting = true;
    try {
      const f = this.orderForm;
      const symbol = (f.symbol || '').trim().toUpperCase();
      const body: any = {
        symbol,
        side: f.side,
        qty: f.qty,
        type: f.type,
        time_in_force: f.time_in_force,
      };
      // Per-type body fields. Alpaca rejects extraneous price params on
      // types that don't use them, so only attach what's relevant.
      if (f.type === 'limit') {
        body.limit_price = f.limit_price;
      } else if (f.type === 'stop') {
        body.stop_price = f.stop_price;
      } else if (f.type === 'stop_limit') {
        body.stop_price = f.stop_price;
        body.limit_price = f.limit_price;
      } else if (f.type === 'trailing_stop') {
        // trail_price OR trail_percent — never both. Prefer percent
        // if the user filled it in, since that's the more common
        // "lock in N% from peak" usage.
        if (f.trail_percent) body.trail_percent = f.trail_percent;
        else if (f.trail_price) body.trail_price = f.trail_price;
      }

      // Resolve destination portfolio: when 'all' is active, fall back to
      // the user's main portfolio.
      const targetPortfolio = this.activeBrokeragePortfolioId === 'all'
        ? this.mainPortfolioId()
        : this.activeBrokeragePortfolioId;
      if (targetPortfolio == null) {
        this.orderError = 'No portfolio available — refresh and try again.';
        return;
      }

      // Estimate order cost for the per-portfolio cash check. Different
      // order types pin the worst-case price at different inputs:
      //   limit / stop_limit → limit_price (won't fill above this)
      //   stop                → stop_price (executes at market once
      //                         triggered; stop_price is the rough mark)
      //   trailing_stop / market → live quote (worst case == ask)
      const qty = parseFloat(f.qty) || 0;
      const liveAsk = parseFloat(this.alpacaQuote?.quote?.ap) || parseFloat(this.alpacaQuote?.quote?.bp) || 0;
      const estPrice =
        f.type === 'limit' || f.type === 'stop_limit'
          ? parseFloat(f.limit_price) || 0
          : f.type === 'stop'
            ? parseFloat(f.stop_price) || 0
            : liveAsk;
      const estCost = qty * estPrice;

      // Cash check on buys — block before hitting Alpaca if portfolio is short.
      if (f.side === 'buy' && estCost > 0) {
        const available = parseFloat(this.portfolioCash[targetPortfolio]) || 0;
        if (estCost > available) {
          const portfolioName = this.brokeragePortfolios.find((p: any) => p.id === targetPortfolio)?.name || targetPortfolio;
          this.orderError = `Insufficient cash in ${portfolioName} (${this.fmtUSD(available)} available, ${this.fmtUSD(estCost)} needed). Transfer funds from Main first.`;
          return;
        }
      }

      await apiFetch<any>('/alpaca/orders', { method: 'POST', body: JSON.stringify(body) });

      // Increment (or decrement on sell) the destination portfolio's qty
      // and persist the full per-symbol map via the allocations API.
      const existingAlloc = this.positionAllocation[symbol] || {};
      const targetKey = String(targetPortfolio);
      const currentQty = parseFloat(existingAlloc[targetKey]) || 0;
      const delta = f.side === 'buy' ? qty : -qty;
      const newQty = Math.max(0, currentQty + delta);
      const next = { ...existingAlloc };
      if (newQty > 0) next[targetKey] = newQty; else delete next[targetKey];
      try {
        await this._saveSymbolAllocation(symbol, next);
      } catch (e) {
        // Order already placed at Alpaca — surface the persistence
        // failure but don't unwind. Refresh will re-fetch true state.
        (Alpine.store('toast') as ToastStore).show(
          'Order placed but allocation save failed — refresh to resync.',
          'error',
        );
      }

      // Adjust cash: deduct on buy, credit on sell.
      if (estCost > 0) {
        const current = parseFloat(this.portfolioCash[targetPortfolio]) || 0;
        const delta = f.side === 'buy' ? -estCost : estCost;
        this.portfolioCash = {
          ...this.portfolioCash,
          [targetPortfolio]: current + delta,
        };
        this._savePortfolioCash();
      }

      this.orderConfirmOpen = false;
      this.orderForm.qty = '';
      this.orderForm.limit_price = '';
      this.orderForm.stop_price = '';
      this.orderForm.trail_price = '';
      this.orderForm.trail_percent = '';
      (Alpine.store('toast') as ToastStore).show(`${f.side === 'buy' ? 'Buy' : 'Sell'} order placed`, 'success');
      await this.loadBrokerage();
    } catch (e) {
      this.orderError = (e as Error).message || 'Order failed';
    } finally {
      this.orderSubmitting = false;
    }
  },

  pickScreenerSymbol(this: any, sym: string) {
    this.orderForm.symbol = sym;
    // After a successful order, submitAlpacaOrder clears qty + limit_price
    // so the form looks "fresh" for the next entry. Restore the qty
    // default here so picking another stock prefills the full row again,
    // not just the symbol. Only fill when blank — if the user typed a
    // qty before clicking the row, leave their value alone.
    if ((this.orderForm.qty || '').trim() === '') {
      this.orderForm.qty = '1';
    }
    // Pre-fill the limit field instantly from the cached screener price so
    // the user sees a number before the live-quote round-trip completes.
    // loadAlpacaQuote will refresh it once the up-to-the-second quote lands.
    const cachedPrice = Number(this.screenerQuotes?.[sym]?.price);
    if (Number.isFinite(cachedPrice) && cachedPrice > 0) {
      const formatted = cachedPrice.toFixed(2);
      const current = (this.orderForm.limit_price || '').trim();
      if (current === '' || current === this._lastAutoLimitPrice) {
        this.orderForm.limit_price = formatted;
        this._lastAutoLimitPrice = formatted;
      }
    }
    this.loadAlpacaQuote(sym);
    this.screenerOpen = false;
  },

  async toggleScreenerChart(this: any, sym: string) {
    if (this.expandedScreenerRow === sym) {
      this.expandedScreenerRow = null;
      return;
    }
    this.expandedScreenerRow = sym;

    const benchmark = this.benchmarkForSymbol(sym);
    const targets: string[] = [sym, benchmark].filter((s): s is string => !!s);
    const symbolsToFetch = targets.filter((s) => !this.screenerBars[s]?.bars);

    if (symbolsToFetch.length === 0) {
      this.$nextTick(() => this.renderScreenerChart(sym));
      return;
    }

    const loadingPatch: any = {};
    for (const s of symbolsToFetch) loadingPatch[s] = { loading: true };
    this.screenerBars = { ...this.screenerBars, ...loadingPatch };

    try {
      const results = await Promise.all(
        symbolsToFetch.map((s) => apiFetch<Array<{ t: string; c: number }>>(`/alpaca/bars/${encodeURIComponent(s)}?days=1460`))
      );
      const patch: any = {};
      symbolsToFetch.forEach((s, i) => { patch[s] = { bars: results[i] || [] }; });
      this.screenerBars = { ...this.screenerBars, ...patch };
      this.$nextTick(() => this.renderScreenerChart(sym));
    } catch (e) {
      this.screenerBars = { ...this.screenerBars, [sym]: { error: (e as Error).message || 'failed to load chart' } };
    }
  },

  renderScreenerChart(this: any, sym: string) {
    // Multiple canvases per symbol exist (one per tab template). Pick
    // the visible one — querySelector would grab a hidden duplicate.
    const canvases = document.querySelectorAll<HTMLCanvasElement>(
      `canvas[data-screener-chart="${sym}"]`
    );
    let canvas: HTMLCanvasElement | null = null;
    canvases.forEach((c) => {
      if (canvas) return;
      if (c.offsetParent !== null) canvas = c;
    });
    if (!canvas) return;
    const entry = this.screenerBars[sym];
    const bars = entry?.bars || [];
    if (bars.length === 0) return;

    // Tear down any prior chart on this canvas
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    // Normalize stock series to % change from first close
    const stockFirst = bars[0].c;
    const stockPct = bars.map((b: { t: string; c: number }) => ((b.c - stockFirst) / stockFirst) * 100);
    const labels = bars.map((b: { t: string; c: number }) => new Date(b.t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));

    // Indices where the first bar of January or July starts — used to draw
    // x-axis labels at clean 6-month intervals.
    const sixMonthIndices = new Set<number>();
    let lastMonth = -1;
    bars.forEach((b: { t: string; c: number }, i: number) => {
      const m = new Date(b.t).getMonth();
      if ((m === 0 || m === 6) && m !== lastMonth) sixMonthIndices.add(i);
      lastMonth = m;
    });

    const last = stockPct[stockPct.length - 1];
    const up = last >= 0;
    const stockColor = up ? '#5dd49a' : '#ff8a8a';

    // Build datasets — start with the stock line.
    const datasets: any[] = [{
      label: sym,
      data: stockPct,
      borderColor: stockColor,
      backgroundColor: up ? 'rgba(93,212,154,0.08)' : 'rgba(255,138,138,0.08)',
      fill: true,
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.1,
    }];

    // Add benchmark series if this stock has a category benchmark and we've
    // loaded its bars.
    const benchSym = this.benchmarkForSymbol(sym);
    if (benchSym) {
      const benchBars = this.screenerBars[benchSym]?.bars || [];
      if (benchBars.length > 0) {
        // Build a date → close map for the benchmark, then align with stock dates.
        const benchByDate: Record<string, number> = {};
        for (const b of benchBars as Array<{ t: string; c: number }>) {
          benchByDate[b.t.slice(0, 10)] = b.c;
        }
        const benchAligned: Array<number | null> = bars.map((b: { t: string; c: number }) => {
          const v = benchByDate[b.t.slice(0, 10)];
          return typeof v === 'number' ? v : null;
        });
        // Find the first non-null entry to anchor the % calc; if all null, skip.
        const benchAnchor = benchAligned.find((v): v is number => v != null);
        if (benchAnchor) {
          const benchPct = benchAligned.map((v) => v != null ? ((v - benchAnchor) / benchAnchor) * 100 : null);
          datasets.push({
            label: `${benchSym} (peer avg)`,
            data: benchPct,
            borderColor: '#b44dff',
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1,
            spanGaps: true,
          });
        }
      }
    }

    const config: ChartConfiguration = {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: datasets.length > 1,
            position: 'top',
            align: 'end',
            labels: { color: '#aaa', boxWidth: 24, boxHeight: 2, font: { size: 10 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}%`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#888',
              autoSkip: false,
              maxRotation: 0,
              callback: function(_val: any, index: number) {
                return sixMonthIndices.has(index) ? labels[index] : '';
              },
            },
            grid: { display: false },
          },
          y: {
            ticks: {
              color: '#888',
              stepSize: 10,
              callback: (val: any) => `${Number(val) >= 0 ? '+' : ''}${val}%`,
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    };

    const chart = new Chart(canvas, config);
    this.screenerBars = { ...this.screenerBars, [sym]: { ...entry, chart } };
  },

  // Fetches snapshot prices and 1-year price change for the bottom-strip
  // ticker. Two concurrent calls — snapshots for live price, changes for
  // the trailing-365-day return — and merges them into the topCoins-shaped
  // structure the existing template iterates.
  async loadTickerStocks(this: any) {
    const csv = TICKER_SYMBOLS.join(',');
    try {
      const [snaps, changes] = await Promise.all([
        apiFetch<Record<string, { price: number | null; change_pct: number | null }>>(
          `/alpaca/snapshots?symbols=${encodeURIComponent(csv)}`
        ).catch(() => ({} as Record<string, any>)),
        apiFetch<Record<string, { stock_pct: number | null; bench_pct: number | null; days: number } | null>>(
          `/alpaca/changes?pairs=${encodeURIComponent(csv)}&days=365`
        ).catch(() => ({} as Record<string, any>)),
      ]);
      this.tickerStocks = TICKER_SYMBOLS.map((sym) => ({
        symbol: sym,
        current_price_usd: snaps?.[sym]?.price ?? null,
        price_change_1y: changes?.[sym]?.stock_pct ?? null,
      }));
    } catch {
      // Silent — strip just stays empty.
    }
  },

  async loadScreenerQuotes(this: any, categoryId?: string) {
    const cat = this.stockScreener.find((c: any) => c.id === (categoryId || this.screenerCategory));
    if (!cat) return;
    const all = [...cat.stocks.map((s: any) => s.symbol)];
    if (cat.benchmark) all.push(cat.benchmark);
    await this.loadScreenerQuotesForSymbols(all);
  },

  // Loads quotes + performance-vs-benchmark pairs for the currently-
  // visible filter results. Each candidate is paired with its
  // source-category benchmark (e.g. NVDA → XLK) so the green/red arrow
  // renders correctly on the Filters tab — same arrow you see on the
  // Mag-7 / Dividend / Sector tabs, just resolved per-symbol.
  _hydrateFilterCandidates(this: any) {
    const candidates = this.filteredScreenerCandidates();
    if (candidates.length === 0) return;
    const symbols = candidates.map((s: any) => s.symbol);
    this.loadScreenerQuotesForSymbols(symbols);

    // Pair each symbol with the benchmark from whichever category it
    // belongs to. benchmarkForSymbol already walks stockScreener for us.
    const pairs: Array<[string, string | null]> = candidates.map((s: any) => [
      s.symbol,
      this.benchmarkForSymbol(s.symbol),
    ]);
    this.loadScreenerChanges(pairs);
  },

  // Fetch snapshots for an arbitrary symbol list, skipping any already
  // in `screenerQuotes`. Used by the Filters tab so a chip can populate
  // price + arrow widgets for stocks whose category the user hasn't
  // visited (e.g. biotech symbols live under Dividend; clicking the
  // biotech chip without first hitting Dividend would otherwise leave
  // the rows priceless).
  async loadScreenerQuotesForSymbols(this: any, symbols: string[]) {
    if (!Array.isArray(symbols) || symbols.length === 0) return;
    const missing = symbols.filter((s: string) => !this.screenerQuotes[s]);
    if (missing.length === 0) return;
    this.loadingScreenerQuotes = true;
    try {
      const data = await apiFetch<Record<string, { price: number | null; change_pct: number | null }>>(
        `/alpaca/snapshots?symbols=${encodeURIComponent(missing.join(','))}`
      );
      this.screenerQuotes = { ...this.screenerQuotes, ...data };
    } catch {
      // Silent — screener still renders, just without live numbers.
    } finally {
      this.loadingScreenerQuotes = false;
    }
  },

  visibleScreenerCount(this: any) {
    if (this.screenerCategory === 'filters') return this.filteredScreenerCandidates().length;
    const cat = this.stockScreener.find((c: any) => c.id === this.screenerCategory);
    return cat ? this.filterScreenerStocks(cat).length : 0;
  },

  allScreenerCandidates(this: any) {
    const seen = new Set<string>();
    const flat: any[] = [];
    // Filters tab is stocks-only — exclude ETF categories so the chip
    // taxonomy doesn't pull in mismatched ETF rows.
    for (const cat of this.stockScreener) {
      if (cat.view === 'etfs') continue;
      for (const s of cat.stocks) {
        if (seen.has(s.symbol)) continue;
        seen.add(s.symbol);
        flat.push(s);
      }
    }
    return flat;
  },

  filterInfoText(this: any): string {
    const q = (this.filterSearchText || '').toLowerCase().trim();
    return CHIP_INFO[q] || '';
  },

  filteredScreenerCandidates(this: any) {
    const q = (this.filterSearchText || '').toLowerCase().trim();
    const all = this.allScreenerCandidates();

    let matched: any[];
    if (!q) {
      matched = all;
    } else if (q.length <= 3 && /^[a-z]+$/.test(q)) {
      // Short alphabetic queries (≤3 chars) require word boundaries so
      // "AI" matches "AI accelerators" but not "container" or "aircraft".
      const re = new RegExp(`\\b${q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      matched = all.filter((s: any) =>
        re.test(s.note || '') || re.test(s.name || '') || re.test(s.symbol || '')
      );
    } else {
      matched = all.filter((s: any) =>
        (s.note || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (s.symbol || '').toLowerCase().includes(q)
      );
    }

    // Tier-2 sub-filter (e.g. farming → "fertilizer", local → "IL"). Short
    // alphabetic codes like state abbreviations need word boundaries so
    // "IL" doesn't accidentally match "missile" or "Illinois".
    const sub = (this.filterSubText || '').toLowerCase().trim();
    if (sub) {
      if (sub.length <= 3 && /^[a-z]+$/.test(sub)) {
        const subRe = new RegExp(`\\b${sub.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        matched = matched.filter((s: any) =>
          subRe.test(s.note || '') || subRe.test(s.name || '')
        );
      } else {
        matched = matched.filter((s: any) =>
          (s.note || '').toLowerCase().includes(sub) ||
          (s.name || '').toLowerCase().includes(sub)
        );
      }
    }

    // Sort cheapest → most expensive. Stocks without a loaded price sink
    // to the end so the priced ones are always on top.
    return [...matched].sort((a: any, b: any) => {
      const pa = this.screenerQuotes[a.symbol]?.price;
      const pb = this.screenerQuotes[b.symbol]?.price;
      const va = typeof pa === 'number' ? pa : Infinity;
      const vb = typeof pb === 'number' ? pb : Infinity;
      return va - vb;
    });
  },

  async loadFiltersData(this: any) {
    // When the Filters tab is active, ensure quotes + dividends for every
    // candidate are loaded so search results show price + yield.
    const all = this.allScreenerCandidates().map((s: any) => s.symbol);
    const quotesNeeded = all.filter((s: string) => !this.screenerQuotes[s]);
    const divsNeeded = all.filter((s: string) => !this.screenerDividends[s]);

    const calls: Promise<any>[] = [];
    if (quotesNeeded.length) {
      calls.push(
        apiFetch<Record<string, { price: number | null; change_pct: number | null }>>(
          `/alpaca/snapshots?symbols=${encodeURIComponent(quotesNeeded.join(','))}`
        ).then((data) => { this.screenerQuotes = { ...this.screenerQuotes, ...data }; }).catch(() => {})
      );
    }
    if (divsNeeded.length) {
      calls.push(
        apiFetch<Record<string, any>>(
          `/alpaca/dividends?symbols=${encodeURIComponent(divsNeeded.join(','))}`
        ).then((data) => { this.screenerDividends = { ...this.screenerDividends, ...data }; }).catch(() => {})
      );
    }

    await Promise.all(calls);
  },

  // Targeted matched-window comparison preload for filter results — sends
  // pairs (stock, home-category benchmark) so each row is compared over
  // its own actual trading history.
  async loadFilterBars(this: any) {
    if (this.screenerCategory !== 'filters') return;
    const candidates = this.filteredScreenerCandidates();
    if (!candidates.length) return;

    const pairs: Array<[string, string | null]> = candidates.map((c: any) => [
      c.symbol,
      this.benchmarkForSymbol(c.symbol),
    ]);
    await this.loadScreenerChanges(pairs);
  },

  // Look up a symbol's benchmark. In a real category, use that category's
  // benchmark. In the Filters tab, find the stock's home category in
  // STOCK_SCREENER and use its benchmark.
  benchmarkForSymbol(this: any, sym: string): string | null {
    if (this.screenerCategory === 'filters') {
      for (const c of this.stockScreener) {
        if (c.benchmark && c.stocks.some((s: any) => s.symbol === sym)) {
          return c.benchmark === sym ? null : c.benchmark;
        }
      }
      return null;
    }
    const cat = this.stockScreener.find((c: any) => c.id === this.screenerCategory);
    return cat?.benchmark && cat.benchmark !== sym ? cat.benchmark : null;
  },

  performanceVsBenchmark(this: any, sym: string): 'up' | 'down' | null {
    const entry = this.screenerChanges[sym];
    if (!entry) return null;
    const { stock_pct, bench_pct, days } = entry;
    // Hide arrow for stocks with less than ~3 months of trading history —
    // the comparison is too noisy below that.
    if (typeof stock_pct !== 'number' || typeof bench_pct !== 'number') return null;
    if (typeof days !== 'number' || days < 60) return null;
    if (stock_pct > bench_pct) return 'up';
    if (stock_pct < bench_pct) return 'down';
    return null;
  },

  // Hover-text describing the comparison window in human terms.
  performanceTooltip(this: any, sym: string): string {
    const entry = this.screenerChanges[sym];
    if (!entry || typeof entry.days !== 'number') return '';
    const months = Math.round(entry.days / 21);
    const window =
      months >= 12
        ? `${(months / 12).toFixed(months % 12 === 0 ? 0 : 1)}-year`
        : `${months}-month`;
    const dir = this.performanceVsBenchmark(sym);
    const verb = dir === 'up' ? 'Outperforming' : 'Underperforming';
    return `${verb} category benchmark over ${window} window.`;
  },

  // Load matched-window stock-vs-benchmark comparison for every stock in
  // the category. One server-side call computes the comparison fairly even
  // for newly-IPO'd names (e.g. RIVN gets compared over its 2yr history,
  // not 4yr).
  async loadScreenerPerformance(this: any, categoryId?: string) {
    const id = categoryId || this.screenerCategory;
    const cat = this.stockScreener.find((c: any) => c.id === id);
    if (!cat?.benchmark) return;
    const pairs = cat.stocks.map((s: any) => [s.symbol, cat.benchmark] as [string, string]);
    await this.loadScreenerChanges(pairs);
  },

  async loadScreenerChanges(this: any, pairs: Array<[string, string | null]>) {
    const toFetch = pairs.filter(([s]) => !(s in this.screenerChanges));
    if (toFetch.length === 0) return;

    // Mark as in-flight so concurrent calls don't redundantly refetch.
    const inflightPatch: Record<string, null> = {};
    for (const [s] of toFetch) inflightPatch[s] = null;
    this.screenerChanges = { ...this.screenerChanges, ...inflightPatch };

    const csv = toFetch
      .map(([s, b]) => (b ? `${s}:${b}` : s))
      .join(',');

    try {
      const data = await apiFetch<Record<string, { stock_pct: number | null; bench_pct: number | null; days: number } | null>>(
        `/alpaca/changes?pairs=${encodeURIComponent(csv)}&days=1460`
      );
      this.screenerChanges = { ...this.screenerChanges, ...data };
    } catch {
      // Silent — arrows just won't show for these symbols. The null
      // placeholders above prevent retry storms.
    }
  },

  // Distribution frequency badge derived from how many payments Alpaca
  // recorded in the last ~12 months. '' means "no badge" — either no
  // dividend or not enough data yet.
  dividendFrequency(this: any, symbol: string): string {
    const d = this.screenerDividends[symbol];
    if (!d || !d.annual_rate || d.annual_rate <= 0) return '';
    const n = d.payment_count || 0;
    if (n >= 11) return 'Monthly';
    if (n >= 3 && n <= 6) return 'Quarterly';
    if (n === 2) return 'Semi-annual';
    if (n === 1) return 'Annual';
    return '';
  },

  // Static risk classification for known ETFs.
  riskTierFor(this: any, symbol: string): string {
    return ETF_RISK[symbol] || '';
  },

  // Dividend-tier classification for individual stocks. Returns:
  //   'King'        — 50+ consecutive years of dividend increases
  //   'Aristocrat'  — 25-49 years (S&P 500 only); Kings are excluded so
  //                   the two labels surface disjoint sets
  //   ''            — neither
  dividendStatusFor(this: any, symbol: string): string {
    if (DIVIDEND_KINGS.has(symbol)) return 'King';
    if (DIVIDEND_ARISTOCRATS.has(symbol)) return 'Aristocrat';
    return '';
  },

  // Logo.dev URL for a ticker — empty string when no logo can be served
  // (no token, crypto pair, etc.). Components fall back to no-image.
  logoUrlFor(this: any, symbol: string, size = 64): string {
    return logoUrlFor(symbol, size);
  },

  // Approximate underlying holdings count for known ETFs ("500 stocks",
  // "12,000 bonds", "1 coin (BTC)", etc.).
  holdingsCountFor(this: any, symbol: string): string {
    return ETF_HOLDINGS[symbol] || '';
  },

  // Returns a short label if there's any delisting / bankruptcy signal on
  // the symbol. EDGAR 8-K filings (preemptive) take priority over Alpaca's
  // post-mortem inactive/non-tradable flags. Empty string = no concern.
  delistingRiskFor(this: any, symbol: string): string {
    const filings = this.edgarRisk[symbol];
    if (Array.isArray(filings) && filings.length > 0) {
      // Severity order: severe > warn > info. Pick the worst-tier filing's label.
      const severe = filings.find((f: any) => f.severity === 'severe');
      if (severe) return severe.label;
      const warn = filings.find((f: any) => f.severity === 'warn');
      if (warn) return warn.label;
      return filings[0].label;
    }
    const a = this.alpacaAssetStatus[symbol];
    if (!a) return '';
    if (a.status && a.status !== 'active') return 'Delisted';
    if (a.tradable === false) return 'Halted';
    return '';
  },

  // Risk tier — drives the badge color. 'severe' for confirmed bankruptcy
  // or already-delisted; 'warn' for early-stage distress signals (notices,
  // defaults, audit issues); 'info' for acquisition / change-in-control
  // (delisting-causing but typically a cash-out for the holder).
  delistingRiskSeverity(this: any, symbol: string): 'severe' | 'warn' | 'info' | '' {
    const filings = this.edgarRisk[symbol];
    if (Array.isArray(filings) && filings.length > 0) {
      if (filings.some((f: any) => f.severity === 'severe')) return 'severe';
      if (filings.some((f: any) => f.severity === 'warn')) return 'warn';
      return 'info';
    }
    const a = this.alpacaAssetStatus[symbol];
    if (!a) return '';
    if (a.status && a.status !== 'active') return 'severe';
    if (a.tradable === false) return 'warn';
    return '';
  },

  // Tooltip explaining what triggered the badge — lists each EDGAR filing
  // with its date, then falls back to Alpaca metadata.
  delistingRiskReason(this: any, symbol: string): string {
    const filings = this.edgarRisk[symbol];
    if (Array.isArray(filings) && filings.length > 0) {
      const lines = filings
        .map((f: any) => `• ${f.label} — 8-K item ${f.item} filed ${f.filed_at}`)
        .join('\n');
      return `SEC filings in the last 90 days:\n${lines}\n\nClick the symbol's entry on sec.gov for the full document.`;
    }
    const a = this.alpacaAssetStatus[symbol];
    if (!a) return '';
    if (a.status && a.status !== 'active') {
      return `Alpaca reports asset status "${a.status}" — ticker is no longer active. Often a sign of bankruptcy, merger close-out, or delisting.`;
    }
    if (a.tradable === false) {
      return 'Alpaca has flagged this symbol as not tradable. Trading may be halted (regulatory suspension, pending corporate action) or the security may be in the process of being delisted.';
    }
    return '';
  },

  // First filing URL for the symbol so the badge can deep-link to the
  // actual SEC filing on sec.gov.
  delistingFilingUrl(this: any, symbol: string): string {
    const filings = this.edgarRisk[symbol];
    if (!Array.isArray(filings) || filings.length === 0) return '';
    const severe = filings.find((f: any) => f.severity === 'severe');
    if (severe?.url) return severe.url;
    const warn = filings.find((f: any) => f.severity === 'warn');
    if (warn?.url) return warn.url;
    return filings[0]?.url || '';
  },

  filterScreenerStocks(this: any, cat: any) {
    const q = (this.screenerSearch || '').trim().toLowerCase();
    const matchSearch = (s: any) => {
      if (!q) return true;
      return (s.symbol || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q);
    };
    if (cat.id === 'low-price-dividend') {
      const divRange = this.lowPriceRange;
      const priceRange = this.lowSharePrice;
      const yieldRange = this.lowDivYield;
      return cat.stocks
        .filter(matchSearch)
        .filter((s: any) => {
          const q = this.screenerQuotes[s.symbol];
          const d = this.screenerDividends[s.symbol];
          if (!q || typeof q.price !== 'number' || q.price <= 0 || q.price >= 20) return false;
          if (!d || typeof d.annual_rate !== 'number' || d.annual_rate <= 0) return false;

          // Share-price bucket (within the $20 cap).
          if (priceRange === '1to5' && !(q.price >= 1 && q.price <= 5)) return false;
          if (priceRange === '5to10' && !(q.price > 5 && q.price <= 10)) return false;
          if (priceRange === '10to15' && !(q.price > 10 && q.price <= 15)) return false;

          // Annual-dividend amount bucket.
          if (divRange === 'under1' && !(d.annual_rate < 1)) return false;
          if (divRange === '1to5' && !(d.annual_rate >= 1 && d.annual_rate <= 5)) return false;
          if (divRange === '5to10' && !(d.annual_rate > 5 && d.annual_rate <= 10)) return false;

          // Dividend-yield bucket (annual_rate / price * 100).
          const yieldPct = (d.annual_rate / q.price) * 100;
          if (yieldRange === '1to10' && !(yieldPct >= 1 && yieldPct <= 10)) return false;
          if (yieldRange === '10to20' && !(yieldPct > 10 && yieldPct <= 20)) return false;
          if (yieldRange === '20to30' && !(yieldPct > 20 && yieldPct <= 30)) return false;
          if (yieldRange === '30plus' && !(yieldPct > 30)) return false;

          return true;
        })
        .sort((a: any, b: any) => (this.screenerQuotes[a.symbol]?.price ?? 0) - (this.screenerQuotes[b.symbol]?.price ?? 0));
    }
    let stocks = cat.stocks;

    // All other tabs — sort cheapest → most expensive. Symbols without a
    // loaded price sink to the bottom so the visible top of the list is
    // always the cheapest available picks.
    return [...stocks].filter(matchSearch).sort((a: any, b: any) => {
      const pa = this.screenerQuotes[a.symbol]?.price;
      const pb = this.screenerQuotes[b.symbol]?.price;
      const va = typeof pa === 'number' && pa > 0 ? pa : Number.POSITIVE_INFINITY;
      const vb = typeof pb === 'number' && pb > 0 ? pb : Number.POSITIVE_INFINITY;
      return va - vb;
    });
  },

  // SEC EDGAR 8-K risk findings for the active screener category. Mirrors
  // the dividend loader's pattern — only fetches symbols not already
  // resolved this session, and silently leaves the rest with no badge.
  async loadScreenerEdgarRisk(this: any, categoryId?: string) {
    const id = categoryId || this.screenerCategory;
    if (id === 'filters') return;
    const cat = this.stockScreener.find((c: any) => c.id === id);
    if (!cat) return;
    const symbols = cat.stocks
      .map((s: any) => s.symbol)
      .filter((s: string) => s && this.edgarRisk[s] === undefined);
    if (symbols.length === 0) return;
    try {
      const data = await apiFetch<Record<string, any>>(
        `/edgar/risk?symbols=${encodeURIComponent(symbols.join(','))}`
      );
      this.edgarRisk = { ...this.edgarRisk, ...data };
    } catch {
      // Silent — badges just won't show for these symbols.
    }
  },

  async loadScreenerDividends(this: any, categoryId?: string) {
    const id = categoryId || this.screenerCategory;
    // Stock dividend tabs + every ETF tab (ETFs frequently distribute).
    const ETF_DIV_TABS = new Set([
      'dividend',
      'low-price-dividend',
      'index-etfs',
      'dividend-etfs',
      'sector-etfs',
      'bond-etfs',
      'international-etfs',
      'commodity-etfs',
      'crypto-etfs',
      'thematic-etfs',
    ]);
    if (!ETF_DIV_TABS.has(id)) return;
    const cat = this.stockScreener.find((c: any) => c.id === id);
    if (!cat) return;
    const all = [...cat.stocks.map((s: any) => s.symbol)];
    if (cat.benchmark) all.push(cat.benchmark);
    const symbols = all.filter((s: string) => !this.screenerDividends[s]);
    if (symbols.length === 0) return;
    this.loadingScreenerDividends = true;
    try {
      const data = await apiFetch<Record<string, { annual_rate: number; latest_rate: number | null; latest_ex_date: string | null; payment_count: number }>>(
        `/alpaca/dividends?symbols=${encodeURIComponent(symbols.join(','))}`
      );
      this.screenerDividends = { ...this.screenerDividends, ...data };
    } catch {
      // Silent — row just won't show a dividend rate.
    } finally {
      this.loadingScreenerDividends = false;
    }
  },

  // Load dividend data for the user's actual positions (so we can compute
  // forward yearly income) plus the account's lifetime DIV-activity total.
  async loadHoldingsDividends(this: any) {
    const symbols = (this.alpacaPositions || [])
      .map((p: any) => p.symbol)
      .filter((s: string) => s && !this.screenerDividends[s]);

    const calls: Promise<any>[] = [];

    if (symbols.length) {
      calls.push(
        apiFetch<Record<string, any>>(
          `/alpaca/dividends?symbols=${encodeURIComponent(symbols.join(','))}`
        ).then((data) => { this.screenerDividends = { ...this.screenerDividends, ...data }; }).catch(() => {})
      );
    }

    calls.push(
      apiFetch<{ total_paid: number; count: number }>(`/alpaca/dividend-activities`)
        .then((data) => { this.holdingsTotalDividendsPaid = data?.total_paid ?? 0; })
        .catch(() => {})
    );

    // Asset status — proxy for delisting / liquidation. Only fetch for
    // symbols we don't already have cached locally.
    const statusSymbols = (this.alpacaPositions || [])
      .map((p: any) => p.symbol)
      .filter((s: string) => s && this.alpacaAssetStatus[s] === undefined);
    if (statusSymbols.length) {
      calls.push(
        apiFetch<Record<string, any>>(
          `/alpaca/assets?symbols=${encodeURIComponent(statusSymbols.join(','))}`
        ).then((data) => { this.alpacaAssetStatus = { ...this.alpacaAssetStatus, ...data }; }).catch(() => {})
      );
    }

    // SEC EDGAR 8-K monitoring — preemptive bankruptcy / delisting warning.
    const edgarSymbols = (this.alpacaPositions || [])
      .map((p: any) => p.symbol)
      .filter((s: string) => s && this.edgarRisk[s] === undefined);
    if (edgarSymbols.length) {
      calls.push(
        apiFetch<Record<string, any>>(
          `/edgar/risk?symbols=${encodeURIComponent(edgarSymbols.join(','))}`
        ).then((data) => { this.edgarRisk = { ...this.edgarRisk, ...data }; }).catch(() => {})
      );
    }

    await Promise.all(calls);
    this.$nextTick(() => {
      this.renderHoldingsChart();
      this.renderHoldingsDividendChart();
    });
  },

  // Map a symbol to a single primary "chip" by looking up its note in
  // STOCK_SCREENER and matching against the known chip list. First match
  // in priority order wins. Symbols not in our screener fall back to
  // 'Other'. Used to bucket positions for the Holdings doughnut chart.
  // Look up the friendly business name for a position symbol from
  // STOCK_SCREENER. Falls back to the symbol itself if we don't have it.
  nameForPosition(this: any, symbol: string): string {
    for (const cat of this.stockScreener) {
      const found = cat.stocks.find((s: any) => s.symbol === symbol);
      if (found) return found.name;
    }
    return symbol;
  },

  chipForPosition(this: any, symbol: string): string {
    // Priority order is the order of CHIPS — earlier wins. Specific
    // themes before generic descriptors so e.g. an AI-tagged stock
    // doesn't get bucketed as "monthly" if both apply.
    let stock: any = null;
    for (const cat of this.stockScreener) {
      const found = cat.stocks.find((s: any) => s.symbol === symbol);
      if (found) { stock = found; break; }
    }
    if (!stock) return 'Other';

    const haystack = `${stock.note || ''} ${stock.name || ''}`.toLowerCase();
    for (const chip of CHIP_PRIORITY) {
      const c = chip.toLowerCase();
      if (c.length <= 3 && /^[a-z]+$/.test(c)) {
        const re = new RegExp(`\\b${c}\\b`, 'i');
        if (re.test(haystack)) return chip;
      } else if (haystack.includes(c)) {
        return chip;
      }
    }
    return 'Other';
  },

  // Bucket the user's positions by their primary chip and sum market
  // value per bucket. Returns {labels, values} sorted by value desc so
  // the largest slices come first in the legend.
  // Generic breakdown helper — buckets `alpacaPositions` by chip,
  // summing whatever scalar `value(p)` returns for each. Used by both
  // the allocation and dividend-income charts. Alphabetical legend with
  // 'Other' sunk to the bottom.
  bucketPositionsByChip(this: any, value: (p: any) => number) {
    const buckets: Record<string, number> = {};
    const symbolsByBucket: Record<string, string[]> = {};
    for (const p of this.filteredAlpacaPositions()) {
      const v = value(p);
      if (v <= 0) continue;
      const chip = this.chipForPosition(p.symbol);
      buckets[chip] = (buckets[chip] || 0) + v;
      (symbolsByBucket[chip] = symbolsByBucket[chip] || []).push(p.symbol);
    }
    const entries = Object.entries(buckets)
      .filter(([_, v]) => v > 0)
      .sort((a: any, b: any) => {
        if (a[0] === 'Other') return 1;
        if (b[0] === 'Other') return -1;
        return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
      });
    return {
      labels: entries.map(([k]) => k),
      values: entries.map(([_, v]) => v),
      symbolsByBucket,
    };
  },

  holdingsBreakdown(this: any) {
    return this.bucketPositionsByChip((p: any) => parseFloat(p.market_value) || 0);
  },

  // Per-symbol breakdown for the logo-palette pie. Each holding gets its
  // own slice; slice value defaults to market value (so dollar-weighted
  // ownership shows). `valueOf` lets the dividend chart reuse this with
  // qty * annual_rate instead.
  holdingsBySymbolBreakdown(this: any, valueOf?: (p: any) => number) {
    const fn = valueOf || ((p: any) => parseFloat(p.market_value) || 0);
    const entries: Array<{ symbol: string; value: number }> = [];
    for (const p of this.filteredAlpacaPositions()) {
      const v = fn(p);
      if (v <= 0) continue;
      entries.push({ symbol: p.symbol, value: v });
    }
    entries.sort((a, b) => b.value - a.value);
    return {
      labels: entries.map((e) => e.symbol),
      values: entries.map((e) => e.value),
      symbolsByBucket: Object.fromEntries(entries.map((e) => [e.symbol, [e.symbol]])),
    };
  },

  // Synchronous color lookup. Returns the cached sampled color if we
  // have one; otherwise falls back to the symbol's chip color so the
  // chart has something to render before the async sampler completes.
  _logoColorFor(this: any, symbol: string): string {
    const cached = logoColorCache.get(symbol);
    if (cached && cached.length) return cached[0];
    return CHIP_COLORS[this.chipForPosition(symbol)] || CHIP_COLORS.Other;
  },

  // Collision-aware palette assignment. For each symbol, walk its ranked
  // logo colors and claim the first one whose quantized bucket isn't
  // already taken by an earlier slice. If every sampled color collides
  // (or sampling returned nothing), fall back to the chip color. This is
  // what keeps two financials with similar blue logos from rendering as
  // indistinguishable slices — the second one slides to its secondary.
  _assignLogoColors(this: any, symbols: string[]): string[] {
    const used = new Set<string>();
    return symbols.map((sym) => {
      const palette = logoColorCache.get(sym) || [];
      for (const hex of palette) {
        const key = quantizeHex(hex);
        if (!used.has(key)) {
          used.add(key);
          return hex;
        }
      }
      const fallback = CHIP_COLORS[this.chipForPosition(sym)] || CHIP_COLORS.Other;
      used.add(quantizeHex(fallback));
      return fallback;
    });
  },

  // Async warm-up — samples the ranked palette for each missing symbol's
  // logo and stuffs it into the cache. Calls `onColor` after each
  // resolution so the caller can re-render the chart progressively as
  // colors arrive (rather than waiting for the whole batch).
  async _warmLogoColors(this: any, symbols: string[], onColor?: () => void) {
    const missing = symbols.filter((s) => s && !logoColorCache.has(s));
    if (missing.length === 0) return;
    await Promise.all(missing.map(async (sym) => {
      const url = logoUrlFor(sym, 96);
      if (!url) return;
      const palette = await sampleLogoDominantColors(url);
      if (palette && palette.length) {
        logoColorCache.set(sym, palette);
        if (onColor) onColor();
      }
    }));
  },

  // Bucket positions by current share-price tier and sum market value per
  // bucket. Tells the user whether their capital sits in penny stocks,
  // mid-priced names, or high-flyers. Order is fixed low→high.
  holdingsPriceBreakdown(this: any) {
    const order = ['Under $5', '$5 – $20', '$20 – $50', '$50 – $100', '$100 – $250', '$250+'];
    const bucketFor = (price: number) =>
      price < 5 ? 'Under $5'
        : price <= 20 ? '$5 – $20'
        : price <= 50 ? '$20 – $50'
        : price <= 100 ? '$50 – $100'
        : price <= 250 ? '$100 – $250'
        : '$250+';

    const buckets: Record<string, number> = {};
    const symbolsByBucket: Record<string, string[]> = {};
    // Track market value per chip and per symbol within each price tier
    // so the chart can color each slice by either its dominant industry
    // chip (chip palette) or its dominant holding's logo (logo palette).
    const chipMvByBucket: Record<string, Record<string, number>> = {};
    const symbolMvByBucket: Record<string, Record<string, number>> = {};
    for (const p of this.filteredAlpacaPositions()) {
      const price = parseFloat(p.current_price) || 0;
      const mv = parseFloat(p.market_value) || 0;
      if (price <= 0 || mv <= 0) continue;
      const b = bucketFor(price);
      buckets[b] = (buckets[b] || 0) + mv;
      (symbolsByBucket[b] = symbolsByBucket[b] || []).push(p.symbol);
      const chip = this.chipForPosition(p.symbol);
      chipMvByBucket[b] = chipMvByBucket[b] || {};
      chipMvByBucket[b][chip] = (chipMvByBucket[b][chip] || 0) + mv;
      symbolMvByBucket[b] = symbolMvByBucket[b] || {};
      symbolMvByBucket[b][p.symbol] = (symbolMvByBucket[b][p.symbol] || 0) + mv;
    }
    const entries = order
      .map((k) => [k, buckets[k] || 0] as [string, number])
      .filter(([_, v]) => v > 0);

    // Per-tier "winner" — both the dominant chip and the dominant single
    // symbol. The color renderer picks one or the other depending on the
    // active palette mode.
    const dominantChip: Record<string, string> = {};
    const dominantSymbol: Record<string, string> = {};
    for (const [bucket] of entries) {
      const chips = chipMvByBucket[bucket] || {};
      let bestChip = 'Other', bestChipMv = 0;
      for (const [chip, mv] of Object.entries(chips)) {
        if (mv > bestChipMv) { bestChipMv = mv; bestChip = chip; }
      }
      dominantChip[bucket] = bestChip;

      const syms = symbolMvByBucket[bucket] || {};
      let bestSym = '', bestSymMv = 0;
      for (const [sym, mv] of Object.entries(syms)) {
        if (mv > bestSymMv) { bestSymMv = mv; bestSym = sym; }
      }
      dominantSymbol[bucket] = bestSym;
    }

    return {
      labels: entries.map(([k]) => k),
      values: entries.map(([_, v]) => v),
      symbolsByBucket,
      dominantChip,
      dominantSymbol,
    };
  },

  // Bucket dividend-paying positions by chip and sum *projected yearly
  // dividend income* (qty × annual_rate). Stocks with no dividend yield
  // produce zero and get filtered out by the helper.
  holdingsDividendBreakdown(this: any) {
    return this.bucketPositionsByChip((p: any) => {
      const annual = this.screenerDividends[p.symbol]?.annual_rate || 0;
      const qty = parseFloat(p.qty) || 0;
      return qty * annual;
    });
  },

  // Generic Holdings breakdown chart — shared by the allocation doughnut
  // and the dividend-income pie. Caller supplies the canvas selector,
  // chart type, breakdown source, the state slot to store the Chart.js
  // instance in, and an optional value suffix for tooltips (e.g. "/yr").
  renderHoldingsBreakdownChart(this: any, opts: {
    selector: string;
    type: 'doughnut' | 'pie';
    breakdown: { labels: string[]; values: number[]; symbolsByBucket: Record<string, string[]> };
    state: 'holdingsChart' | 'holdingsDividendChart' | 'holdingsPriceChart';
    valueSuffix?: string;
    colors?: string[];
  }) {
    const canvas = document.querySelector<HTMLCanvasElement>(opts.selector);
    if (!canvas) return;

    const { labels, values, symbolsByBucket } = opts.breakdown;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    if (values.length === 0) {
      this[opts.state] = null;
      return;
    }

    // Default to chip→color mapping (stable across allocation + dividend
    // charts). Caller can override with opts.colors for non-chip labels
    // like price-tier buckets.
    const colors = opts.colors
      ? labels.map((_: any, i: number) => opts.colors![i % opts.colors!.length])
      : labels.map((label: string) => CHIP_COLORS[label] || CHIP_COLORS.Other);
    const suffix = opts.valueSuffix || '';

    this[opts.state] = new Chart(canvas, {
      type: opts.type,
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: '#07050f',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(opts.type === 'doughnut' ? { cutout: '60%' } : {}),
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: document.documentElement.dataset.theme === 'light' ? '#18181b' : '#e8e0ff',
              boxWidth: 12,
              boxHeight: 12,
              font: { size: 11 },
            },
          },
          tooltip: {
            backgroundColor: '#0d0a1e',
            borderColor: '#261d4a',
            borderWidth: 1,
            titleColor: '#e8e0ff',
            bodyColor: '#e8e0ff',
            callbacks: {
              label: (ctx: any) => {
                const v = ctx.parsed;
                const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
                const pct = total > 0 ? (v / total) * 100 : 0;
                return `${ctx.label}: ${this.fmtUSD(v)}${suffix} (${pct.toFixed(1)}%)`;
              },
              afterLabel: (ctx: any) => {
                // Only the Other slice gets a tickers list — the rest are
                // self-explanatory from the chip name.
                if (ctx.label !== 'Other') return '';
                const syms = symbolsByBucket['Other'] || [];
                return syms.length ? `Tickers: ${syms.join(', ')}` : '';
              },
            },
          },
        },
      },
    });
  },

  // 10-year compound-growth projection from current portfolio state.
  // Three scenarios — Conservative (4%), Expected (7%), Optimistic (10%)
  // price appreciation, each plus the portfolio's current dividend yield
  // assuming reinvestment. Re-runs whenever positions or dividends shift,
  // so the chart tracks live Alpaca polls.
  renderHoldingsProjection(this: any) {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-holdings-projection]');
    if (!canvas) return;

    const totals = this.holdingsTotals();
    const startValue = totals.marketValue || 0;
    const divYieldPct = totals.dividendYield || 0; // already a percentage
    const divYield = divYieldPct / 100;

    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    if (startValue <= 0) return;

    const labels = Array.from({ length: 11 }, (_, i) => `Year ${i}`);
    const compute = (priceRate: number) =>
      labels.map((_, i) => startValue * Math.pow(1 + priceRate + divYield, i));

    const conservative = compute(0.04);
    const expected = compute(0.07);
    const optimistic = compute(0.10);

    this.holdingsProjectionChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Optimistic — 10% + dividends',
            data: optimistic,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.10)',
            fill: '+1',
            borderWidth: 1.8,
            pointRadius: 0,
            tension: 0.25,
          },
          {
            label: 'Expected — 7% + dividends',
            data: expected,
            borderColor: '#b44dff',
            backgroundColor: 'rgba(180, 77, 255, 0.10)',
            fill: '+1',
            borderWidth: 2.4,
            pointRadius: 3,
            pointBackgroundColor: '#b44dff',
            tension: 0.25,
          },
          {
            label: 'Conservative — 4% + dividends',
            data: conservative,
            borderColor: '#d2a84a',
            backgroundColor: 'transparent',
            fill: false,
            borderWidth: 1.8,
            pointRadius: 0,
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: { color: '#bbb', boxHeight: 10, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => `${ctx.dataset.label}: ${this.fmtUSD(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#888' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: {
              color: '#888',
              callback: (val: any) => this.fmtUSD(Number(val)),
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
            beginAtZero: false,
          },
        },
      } as any,
    });
  },

  renderHoldingsChart(this: any) {
    if (this.holdingsPaletteMode === 'chip') {
      // Chip palette — bucket by industry; default chip→color mapping
      // applied by renderHoldingsBreakdownChart when no `colors` passed.
      this.renderHoldingsBreakdownChart({
        selector: 'canvas[data-holdings-chart]',
        type: 'doughnut',
        breakdown: this.holdingsBreakdown(),
        state: 'holdingsChart',
      });
      return;
    }
    const breakdown = this.holdingsBySymbolBreakdown();
    const colors = this._assignLogoColors(breakdown.labels);
    this.renderHoldingsBreakdownChart({
      selector: 'canvas[data-holdings-chart]',
      type: 'doughnut',
      breakdown,
      state: 'holdingsChart',
      colors,
    });
    // Kick off async sampling for any symbols not yet in the color cache;
    // re-render the chart once new colors arrive so the palette upgrades
    // from chip-fallback hues to logo-sampled ones progressively.
    this._warmLogoColors(breakdown.labels, () => {
      this.$nextTick(() => this.renderHoldingsChart());
    });
  },

  renderHoldingsDividendChart(this: any) {
    if (this.holdingsPaletteMode === 'chip') {
      this.renderHoldingsBreakdownChart({
        selector: 'canvas[data-holdings-dividend-chart]',
        type: 'doughnut',
        breakdown: this.holdingsDividendBreakdown(),
        state: 'holdingsDividendChart',
        valueSuffix: '/yr',
      });
      return;
    }
    const breakdown = this.holdingsBySymbolBreakdown((p: any) => {
      const annual = this.screenerDividends[p.symbol]?.annual_rate || 0;
      const qty = parseFloat(p.qty) || 0;
      return qty * annual;
    });
    const colors = this._assignLogoColors(breakdown.labels);
    this.renderHoldingsBreakdownChart({
      selector: 'canvas[data-holdings-dividend-chart]',
      type: 'doughnut',
      breakdown,
      state: 'holdingsDividendChart',
      valueSuffix: '/yr',
      colors,
    });
    this._warmLogoColors(breakdown.labels, () => {
      this.$nextTick(() => this.renderHoldingsDividendChart());
    });
  },

  // Each price tier inherits the color of its dominant *holding* —
  // either by its industry chip (color palette) or by the dominant
  // single ticker's logo-sampled color (logo palette). So a tier
  // dominated by AGNC under the logo palette will show AGNC's mark
  // color; under the color palette the same tier shows the REIT chip
  // purple.
  renderHoldingsPriceChart(this: any) {
    const breakdown = this.holdingsPriceBreakdown();
    if (this.holdingsPaletteMode === 'logo') {
      const dominantSyms = breakdown.labels.map(
        (label: string) => breakdown.dominantSymbol?.[label] || ''
      );
      const assigned = this._assignLogoColors(dominantSyms.filter(Boolean));
      let i = 0;
      const colors = dominantSyms.map((sym: string) =>
        sym ? assigned[i++] : CHIP_COLORS.Other
      );
      this.renderHoldingsBreakdownChart({
        selector: 'canvas[data-holdings-price-chart]',
        type: 'doughnut',
        breakdown,
        state: 'holdingsPriceChart',
        colors,
      });
      // Warm any uncached dominant-symbol logos and re-render so the
      // tiers progressively upgrade from chip-fallback to true logo color.
      this._warmLogoColors(dominantSyms.filter(Boolean) as string[], () => {
        this.$nextTick(() => this.renderHoldingsPriceChart());
      });
      return;
    }
    const colors = breakdown.labels.map((label: string) => {
      const chip = breakdown.dominantChip?.[label] || 'Other';
      return CHIP_COLORS[chip] || CHIP_COLORS.Other;
    });
    this.renderHoldingsBreakdownChart({
      selector: 'canvas[data-holdings-price-chart]',
      type: 'doughnut',
      breakdown,
      state: 'holdingsPriceChart',
      colors,
    });
  },

  // Aggregate stats for the Holdings page — sums across all open
  // positions. Returns market value, total P&L (with cost basis for the
  // % calc), day's change, and the top-weighted holding so callers can
  // surface concentration risk.
  holdingsTotals(this: any) {
    let marketValue = 0;
    let pl = 0;
    let costBasis = 0;
    let dayPl = 0;
    let yearlyDividendIncome = 0;
    let topSymbol = '';
    let topValue = 0;

    for (const p of this.filteredAlpacaPositions()) {
      const mv = parseFloat(p.market_value) || 0;
      const upl = parseFloat(p.unrealized_pl) || 0;
      const intraday = parseFloat(p.unrealized_intraday_pl) || 0;
      const cb = parseFloat(p.cost_basis) || (parseFloat(p.qty) || 0) * (parseFloat(p.avg_entry_price) || 0);
      const qty = parseFloat(p.qty) || 0;
      const annualPerShare = this.screenerDividends[p.symbol]?.annual_rate || 0;

      marketValue += mv;
      pl += upl;
      costBasis += cb;
      dayPl += intraday;
      yearlyDividendIncome += qty * annualPerShare;
      if (mv > topValue) { topValue = mv; topSymbol = p.symbol; }
    }

    const topWeight = marketValue > 0 ? (topValue / marketValue) * 100 : 0;
    const dividendYield = marketValue > 0 ? (yearlyDividendIncome / marketValue) * 100 : 0;
    const totalPaid = this.holdingsTotalDividendsPaid || 0;

    return {
      marketValue,
      pl,
      costBasis,
      dayPl,
      yearlyDividendIncome,
      dividendYield,
      totalPaid,
      topSymbol,
      topWeight,
    };
  },

  // Holdings table — sorted view. Cycles none → asc → desc → none per
  // column. Clicking a different column starts that column at asc.
  sortedHoldings(this: any) {
    const positions = this.filteredAlpacaPositions();
    if (!this.holdingsSortBy) return positions;
    const dir = this.holdingsSortDir === 'asc' ? 1 : -1;
    const keyFor = (p: any) => {
      switch (this.holdingsSortBy) {
        case 'name':     return this.nameForPosition(p.symbol).toLowerCase();
        case 'industry': return this.chipForPosition(p.symbol).toLowerCase();
        case 'side':     return (p.side || '').toLowerCase();
        case 'qty':      return parseFloat(p.qty) || 0;
        case 'avg':      return parseFloat(p.avg_entry_price) || 0;
        case 'current':  return parseFloat(p.current_price) || 0;
        case 'mv':       return parseFloat(p.market_value) || 0;
        case 'pl':       return parseFloat(p.unrealized_pl) || 0;
        case 'div':      return (parseFloat(p.qty) || 0) * (this.screenerDividends[p.symbol]?.annual_rate || 0);
        default:         return (p.symbol || '').toLowerCase();
      }
    };
    return [...positions].sort((a: any, b: any) => {
      const ka = keyFor(a), kb = keyFor(b);
      return ka < kb ? -dir : ka > kb ? dir : 0;
    });
  },

  cycleHoldingsSort(this: any, field: 'symbol' | 'name' | 'industry' | 'side' | 'qty' | 'avg' | 'current' | 'mv' | 'pl' | 'div') {
    if (this.holdingsSortBy !== field) {
      this.holdingsSortBy = field;
      this.holdingsSortDir = 'asc';
    } else if (this.holdingsSortDir === 'asc') {
      this.holdingsSortDir = 'desc';
    } else {
      this.holdingsSortBy = '';
      this.holdingsSortDir = 'asc';
    }
  },

  // Slice the user's orders by the selected Recent-orders tab.
  // `alpacaOrders` is already scoped to the user's own Alpaca account
  // server-side (Broker API per-customer endpoint), so no extra
  // ownership filter needed here.
  recentOrdersFiltered(this: any) {
    const tab = this.recentOrdersTab;
    const orders = this.alpacaOrders || [];
    if (tab === 'filled') {
      return orders.filter((o: any) => o.status === 'filled' || o.status === 'partially_filled');
    }
    if (tab === 'expired') {
      return orders.filter((o: any) => o.status === 'expired' || o.status === 'canceled' || o.status === 'rejected');
    }
    // 'active' — orders still working in the book.
    return orders.filter((o: any) =>
      ['new', 'accepted', 'pending_new', 'partially_filled', 'pending_cancel', 'pending_replace', 'replaced', 'held'].includes(o.status)
    );
  },

  async cancelAlpacaOrder(this: any, id: string) {
    try {
      await apiFetch(`/alpaca/orders/${id}`, { method: 'DELETE' });
      (Alpine.store('toast') as ToastStore).show('Order canceled', 'success');
      await this.loadBrokerage();
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    }
  },

  _startBrokeragePoll(this: any) {
    this._stopBrokeragePoll();
    this._brokeragePollTimer = setInterval(() => {
      if (this.page === 'brokerage') this.loadBrokerage();
    }, 30_000);
  },

  _stopBrokeragePoll(this: any) {
    if (this._brokeragePollTimer) {
      clearInterval(this._brokeragePollTimer);
      this._brokeragePollTimer = null;
    }
  },

  // ── Lookup ────────────────────────────────────────────────────────────────

  async lookupHash(this: any) {
    const q = this.lookupQuery.trim();
    if (!q) return;
    this.lookupLoading = true;
    this.lookupError = '';
    this.lookupResult = null;
    this.lookupValues = {};
    try {
      this.lookupResult = await apiFetch(`/lookup/${encodeURIComponent(q)}`);
      // If the input is a wallet address (not a tx hash), fetch native
      // balances per chain so we can show per-chain USD values inline.
      this.fetchLookupValues(q, this.lookupResult?.type);
    } catch (e) {
      this.lookupError = (e as Error).message;
    } finally {
      this.lookupLoading = false;
    }
  },

  // Populates `lookupValues` keyed by chain slug. Native balance only,
  // multiplied by current price. Runs in the background — values appear
  // as each chain responds.
  async fetchLookupValues(this: any, addr: string, type: string | undefined) {
    if (!type || !addr) return;
    const ETH_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    if (type === 'evm_address') {
      // Reuse the multi-chain fan-out we use for portfolio import.
      try {
        const res = await apiFetch<{ balances: any[] }>(`/wallet/all/${encodeURIComponent(addr)}`);
        const next: Record<string, number> = {};
        for (const b of (res.balances ?? [])) {
          // Native balances only (EVM sentinel address marks the native asset).
          if ((b.contract_address ?? '').toLowerCase() !== ETH_SENTINEL) continue;
          const price = Number(b.current_price_usd);
          const amount = Number(b.amount);
          if (Number.isFinite(price) && Number.isFinite(amount)) {
            next[b.chain] = (next[b.chain] ?? 0) + price * amount;
          }
        }
        this.lookupValues = { ...this.lookupValues, ...next };
      } catch { /* ignore — value column just stays empty */ }
      return;
    }

    if (type === 'sol_address') {
      try {
        const res = await apiFetch<{ balances: any[] }>(`/wallet/solana/${encodeURIComponent(addr)}`);
        const native = (res.balances ?? []).find((b: any) => b.coingecko_id === 'solana');
        if (native) {
          const price = Number(native.current_price_usd);
          const amount = Number(native.amount);
          if (Number.isFinite(price) && Number.isFinite(amount)) {
            this.lookupValues = { ...this.lookupValues, solana: price * amount };
          }
        }
      } catch { /* ignore */ }
      return;
    }

    if (type === 'tron_address') {
      try {
        const res = await apiFetch<{ balances: any[] }>(`/wallet/tron/${encodeURIComponent(addr)}`);
        const native = (res.balances ?? []).find((b: any) => b.coingecko_id === 'tron');
        if (native) {
          const price = Number(native.current_price_usd);
          const amount = Number(native.amount);
          if (Number.isFinite(price) && Number.isFinite(amount)) {
            this.lookupValues = { ...this.lookupValues, tron: price * amount };
          }
        }
      } catch { /* ignore */ }
    }
    // BTC / LTC: no balance endpoint yet — value column stays empty.
  },

  // ── Template helpers ──────────────────────────────────────────────────────

  paxosCoinDescription(symbol: string) { return COIN_DESCRIPTIONS[symbol.toUpperCase()] || null; },

  filteredHoldings(this: any) {
    const all = this.portfolioDetail?.holdings ?? [];
    if (!this.activeWalletFilter) return all;
    return all.filter((h: any) => h.wallet_address === this.activeWalletFilter);
  },

  portfolioWallets(this: any) {
    const holdings = this.portfolioDetail?.holdings ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of holdings) {
      if (h.wallet_address && !seen.has(h.wallet_address)) {
        seen.add(h.wallet_address);
        out.push(h.wallet_address);
      }
    }
    return out;
  },

  // 1-based index into portfolioWallets(). Returns 0 when the holding has no
  // wallet_address (manually-entered position). Used for the "W1/W2/..." column.
  walletIndex(this: any, address: string | null) {
    if (!address) return 0;
    const idx = this.portfolioWallets().indexOf(address);
    return idx < 0 ? 0 : idx + 1;
  },

  // Same palette as renderPieChart so the wallet badges line up with chart
  // colors when we later tie them together.
  _walletPalette: ['#b44dff','#00e676','#00bcd4','#ff6ec7','#ffb300','#39ff14','#cc77ff','#ff3366'],

  walletColor(this: any, address: string | null) {
    const idx = this.walletIndex(address);
    if (idx === 0) return null;
    return this._walletPalette[(idx - 1) % this._walletPalette.length];
  },

  // Detect chain family from wallet address format. EVM is ambiguous across
  // our 7 supported chains (same 0x format), so we return just "EVM".
  // ── Portfolio insight cards ──

  topHolding(this: any) {
    const holdings = this.portfolioDetail?.holdings ?? [];
    let best: any = null;
    for (const h of holdings) {
      const v = Number(h.current_value_usd);
      if (!Number.isFinite(v) || v <= 0) continue;
      if (!best || v > Number(best.current_value_usd)) best = h;
    }
    return best;
  },

  topHoldingPct(this: any) {
    const top = this.topHolding();
    const total = Number(this.portfolioDetail?.total_value_usd);
    if (!top || !Number.isFinite(total) || total <= 0) return null;
    return (Number(top.current_value_usd) / total) * 100;
  },

  concentrationPct(this: any) {
    const holdings = this.portfolioDetail?.holdings ?? [];
    const total = Number(this.portfolioDetail?.total_value_usd);
    if (!Number.isFinite(total) || total <= 0) return null;
    const values = holdings
      .map((h: any) => Number(h.current_value_usd))
      .filter((v: number) => Number.isFinite(v) && v > 0)
      .sort((a: number, b: number) => b - a);
    const top3 = values.slice(0, 3).reduce((s: number, v: number) => s + v, 0);
    return (top3 / total) * 100;
  },

  stablecoinPct(this: any) {
    const holdings = this.portfolioDetail?.holdings ?? [];
    const total = Number(this.portfolioDetail?.total_value_usd);
    if (!Number.isFinite(total) || total <= 0) return null;
    let stable = 0;
    for (const h of holdings) {
      const sym = (h.coin?.symbol || '').toUpperCase();
      const v = Number(h.current_value_usd);
      if (STABLECOIN_SYMBOLS.has(sym) && Number.isFinite(v)) stable += v;
    }
    return (stable / total) * 100;
  },

  walletChain(address: string | null) {
    if (!address) return null;
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) return { slug: 'evm', name: 'EVM', color: '#627EEA' };
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return { slug: 'tron', name: 'Tron', color: '#EF0027' };
    if (/^bc1[a-z0-9]{6,87}$/i.test(address) || /^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(address))
      return { slug: 'bitcoin', name: 'Bitcoin', color: '#F7931A' };
    if (/^ltc1[a-z0-9]{6,87}$/i.test(address) || /^[LM][a-km-zA-HJ-NP-Z1-9]{25,33}$/.test(address))
      return { slug: 'litecoin', name: 'Litecoin', color: '#BFBBBB' };
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return { slug: 'solana', name: 'Solana', color: '#9945FF' };
    return null;
  },

  // Chain logo URLs. Native-asset chains use cryptocurrency-icons (consistent
  // visual style); L2s with their own brand identity use icons.llamao.fi
  // (DefiLlama's chain icon set).
  chainLogoUrl(slug: string | null | undefined): string | null {
    if (!slug) return null;
    const URLS: Record<string, string> = {
      eth: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
      bsc: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/bnb.svg',
      polygon: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/matic.svg',
      avalanche: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/avax.svg',
      solana: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/sol.svg',
      tron: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/trx.svg',
      bitcoin: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
      litecoin: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/ltc.svg',
      // L2s — chain-specific logos via DefiLlama's icon CDN.
      arbitrum: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum',
      optimism: 'https://icons.llamao.fi/icons/chains/rsz_optimism',
      base:     'https://icons.llamao.fi/icons/chains/rsz_base',
      linea:    'https://icons.llamao.fi/icons/chains/rsz_linea',
      zksync:   'https://icons.llamao.fi/icons/chains/rsz_era',
      scroll:   'https://icons.llamao.fi/icons/chains/rsz_scroll',
      blast:    'https://icons.llamao.fi/icons/chains/rsz_blast',
    };
    return URLS[slug] ?? null;
  },

  // Per-holding chain display. Prefers the explicit `chain` slug saved at
  // wallet-import time (gives us the specific EVM chain, not just "EVM"),
  // and falls back to address-shape detection for legacy holdings without
  // a stored chain.
  holdingChain(this: any, h: any) {
    const SLUGS: Record<string, { name: string; color: string }> = {
      eth:       { name: 'Ethereum',  color: '#627EEA' },
      bsc:       { name: 'BNB Chain', color: '#F3BA2F' },
      polygon:   { name: 'Polygon',   color: '#8247E5' },
      arbitrum:  { name: 'Arbitrum',  color: '#28A0F0' },
      optimism:  { name: 'Optimism',  color: '#FF0420' },
      avalanche: { name: 'Avalanche', color: '#E84142' },
      base:      { name: 'Base',      color: '#0052FF' },
      linea:     { name: 'Linea',     color: '#61DFFF' },
      zksync:    { name: 'zkSync',    color: '#4E529A' },
      scroll:    { name: 'Scroll',    color: '#FFEEDA' },
      blast:     { name: 'Blast',     color: '#FCFC03' },
      solana:    { name: 'Solana',    color: '#9945FF' },
      tron:      { name: 'Tron',      color: '#EF0027' },
      bitcoin:   { name: 'Bitcoin',   color: '#F7931A' },
      litecoin:  { name: 'Litecoin',  color: '#BFBBBB' },
    };
    const stored = typeof h?.chain === 'string' ? SLUGS[h.chain] : null;
    if (stored) return { slug: h.chain, ...stored };
    return this.walletChain(h?.wallet_address ?? null);
  },

  // True when the holding's coin has a CoinGecko price match (real price &
  // image). Used to split the holdings table into "main" and "spam/airdrop"
  // sections — unmatched tokens are typically junk a wallet received.
  isHoldingMatched(h: any) {
    return !!(h?.coin?.current_price_usd != null && h?.coin?.image_url);
  },

  matchedHoldings(this: any) {
    return this.filteredHoldings().filter((h: any) => this.isHoldingMatched(h));
  },

  unmatchedHoldings(this: any) {
    return this.filteredHoldings().filter((h: any) => !this.isHoldingMatched(h));
  },

  // Matched first so they render at the top; the unmatched rows below them
  // are hidden via per-row x-show until the toggle is clicked.
  displayHoldings(this: any) {
    return [...this.matchedHoldings(), ...this.unmatchedHoldings()];
  },

  showUnmatchedHoldings: false,

  async copyAddress(this: any, address: string) {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      (Alpine.store('toast') as ToastStore).show('Address copied');
    } catch {
      (Alpine.store('toast') as ToastStore).show('Copy failed', 'error');
    }
  },

  walletIsSolana(addr: string) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr ?? '');
  },

  unknownCoinShape(key: string) {
    if (!key) return 0;
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 6;
  },

  categorizeRouters(routers: string[]) {
    const PLATFORM = new Set(['Phantom Swap']);
    const ROUTING = new Set(['Jupiter', 'Jupiter v3', 'Jupiter v4', 'OKX DEX', 'OKX DEX Aggregator', 'OKX Labs', 'Dex.guru']);
    const out: any = { platform: null, dex_routing: null, liquidity_pool: null };
    for (const r of (routers ?? [])) {
      if (PLATFORM.has(r) && !out.platform) out.platform = r;
      else if (ROUTING.has(r) && !out.dex_routing) out.dex_routing = r;
      else if (!out.liquidity_pool) out.liquidity_pool = r;
    }
    return out;
  },

  totalFeeLabel(parties: any[]) {
    if (!parties || !parties.length) return '';
    const stableTotal = parties.filter((p) => p.is_stable).reduce((s, p) => s + Number(p.amount), 0);
    const byMint: Record<string, { amount: number; symbol: string }> = {};
    for (const p of parties.filter((p) => !p.is_stable)) {
      byMint[p.mint] = byMint[p.mint] || { amount: 0, symbol: p.symbol };
      byMint[p.mint].amount += Number(p.amount);
    }
    const parts: string[] = [];
    if (stableTotal > 0) parts.push('$' + stableTotal.toFixed(2));
    for (const { amount, symbol } of Object.values(byMint)) {
      parts.push(fmtAmount(amount) + ' ' + symbol);
    }
    return parts.join(' + ');
  },

  coinCollateral(symbol: string) { return _collateralMap[symbol.toUpperCase()] || null; },

  volatilityLabel(vol: number | null) {
    if (vol == null) return null;
    if (vol < 0.20) return { label: 'Low', cls: 'badge-green' };
    if (vol < 0.55) return { label: 'Moderate', cls: 'badge-yellow' };
    if (vol < 0.85) return { label: 'High', cls: 'badge-orange' };
    return { label: 'Very High', cls: 'badge-red-glow' };
  },

  coinFeatures(symbol: string) { return COIN_FEATURES[symbol.toUpperCase()] || null; },
  coinYieldTypes(symbol: string) { return COIN_YIELD_TYPES[symbol.toUpperCase()] || null; },

  // ── Marketplace ───────────────────────────────────────────────────────────

  async loadMarketplace(this: any) {
    if (this.marketplaceLoading) return;
    this.marketplaceLoading = true;
    this.marketplaceError = '';
    try {
      let iconCache = (lsGet<Record<string, { url: string; name: string }>>('icon_cache')) || {};
      let yearlyCache = (lsGet<Record<string, any>>('yearly_cache')) || {};
      let longRangeCache = (lsGet<Record<string, any>>('long_range_cache')) || {};

      if (this.topCoins.length < 200) {
        try {
          const r = await apiFetch<{ coins: any[] }>('/coins/top?limit=200');
          this.topCoins = r.coins;
        } catch { /* ignore */ }
      }

      const cgBySymbol: Record<string, any> = {};
      for (const c of this.topCoins) cgBySymbol[c.symbol.toUpperCase()] = c;

      const coins = this.topCoins
        .map((c: any) => {
          const sym = c.symbol.toUpperCase();
          const yearly = yearlyCache[c.coingecko_id] || {};
          const lr = longRangeCache[sym] || {};

          if (c.image_url) iconCache[sym] = { url: c.image_url, name: c.name };

          const fresh: any = {
            image: c.image_url ?? iconCache[sym]?.url ?? null,
            coinName: c.name ?? iconCache[sym]?.name ?? null,
            mktCap: c.market_cap ?? null,
            base_asset: sym,
            market: sym + '/USD',
            change200d: c.price_change_200d ?? null,
            change1y: c.price_change_1y ?? null,
            change1_5y: lr.change1_5y ?? null,
            vol90d: yearly.vol_90d ?? null,
            vol180d: yearly.vol_180d ?? null,
            vol365d: yearly.vol_365d ?? null,
            last: c.current_price_usd ?? null,
            bid: null,
            ask: null,
            spread: null,
            high: yearly.high_1y ?? null,
            low: yearly.low_1y ?? null,
            circulating: c.circulating_supply ?? null,
            hardCap: HARD_CAPS[sym] !== undefined ? HARD_CAPS[sym] : (c.max_supply ?? null),
          };
          const cached = this._marketplaceCache[sym] || {};
          const merged: any = {};
          for (const key of Object.keys(fresh)) merged[key] = fresh[key] ?? cached[key] ?? null;
          this._marketplaceCache[sym] = { ...cached, ...merged };
          return { ...merged };
        })
        .sort((a: any, b: any) => {
          const sa = _dataScore(a), sb = _dataScore(b);
          if (sb !== sa) return sb - sa;
          return (b.last || 0) - (a.last || 0);
        });

      lsSet('icon_cache', iconCache, null);
      this.marketplaceCoins = coins;

      // Background: fetch yearly ranges for uncached coins
      const mkIds = coins
        .map((c: any) => cgBySymbol[c.base_asset]?.coingecko_id)
        .filter((id: string) => id && !yearlyCache[id]);
      if (mkIds.length) {
        apiFetch<{ yearly_ranges: Record<string, any> }>(`/coins/yearly-ranges?ids=${mkIds.join(',')}`).then((r) => {
          const fresh = r?.yearly_ranges || {};
          if (!Object.keys(fresh).length) return;
          yearlyCache = { ...yearlyCache, ...fresh };
          lsSet('yearly_cache', yearlyCache, 24 * 3600);
          this.marketplaceCoins = this.marketplaceCoins.map((p: any) => {
            const cg = cgBySymbol[p.base_asset];
            const yr = fresh[cg?.coingecko_id];
            if (!yr) return p;
            const updated = { ...p, high: yr.high_1y ?? p.high, low: yr.low_1y ?? p.low, vol90d: yr.vol_90d ?? p.vol90d, vol180d: yr.vol_180d ?? p.vol180d, vol365d: yr.vol_365d ?? p.vol365d };
            this._marketplaceCache[p.base_asset] = { ...this._marketplaceCache[p.base_asset], ...updated };
            return updated;
          });
        }).catch(() => {});
      }

      // Background: fetch 1.5Y changes
      const mkSymsForLR = coins
        .map((c: any) => c.base_asset)
        .filter((s: string) => !longRangeCache[s]);
      if (mkSymsForLR.length) {
        apiFetch<{ changes: Record<string, Record<string, number>> }>(`/cryptocompare/changes?symbols=${mkSymsForLR.join(',')}&days=548`).then((r) => {
          const fresh = r?.changes || {};
          if (!Object.keys(fresh).length) return;
          for (const [sym, data] of Object.entries(fresh)) {
            longRangeCache[sym] = { change1_5y: data['548'] ?? null };
          }
          lsSet('long_range_cache', longRangeCache, 24 * 3600);
          this.marketplaceCoins = this.marketplaceCoins.map((p: any) => {
            const lr = longRangeCache[p.base_asset];
            if (!lr) return p;
            const updated = { ...p, change1_5y: lr.change1_5y ?? p.change1_5y };
            this._marketplaceCache[p.base_asset] = { ...this._marketplaceCache[p.base_asset], ...updated };
            return updated;
          });
        }).catch(() => {});
      }
    } catch (e) {
      this.marketplaceError = (e as Error).message;
    } finally {
      this.marketplaceLoading = false;
      this.mkPage = 1;
    }
  },

  mkFilteredCoins(this: any) {
    let coins = this.marketplaceCoins;
    if (this.mkSearch.trim()) {
      const q = this.mkSearch.trim().toLowerCase();
      coins = coins.filter((c: any) =>
        c.base_asset.toLowerCase().includes(q) || (c.coinName || '').toLowerCase().includes(q));
    }
    switch (this.mkSort) {
      case 'price_asc':
        coins = [...coins].filter((c: any) => c.last != null).sort((a: any, b: any) => a.last - b.last);
        break;
      case 'vol_desc':
        coins = [...coins].sort((a: any, b: any) => (b.vol90d || 0) - (a.vol90d || 0));
        break;
      case 'vol_asc':
        coins = [...coins].sort((a: any, b: any) => (a.vol90d ?? Infinity) - (b.vol90d ?? Infinity));
        break;
      case 'stablecoin':
        coins = coins.filter((c: any) => STABLECOIN_SYMBOLS.has(c.base_asset));
        break;
      case 'income_yield':
        coins = [...coins].sort((a: any, b: any) => (coinYieldApr(b.base_asset) ?? -1) - (coinYieldApr(a.base_asset) ?? -1));
        break;
      default:
        coins = [...coins].sort((a: any, b: any) => {
          const sa = _dataScore(a), sb = _dataScore(b);
          if (sb !== sa) return sb - sa;
          return (b.last || 0) - (a.last || 0);
        });
    }
    if (this.mkPinned) {
      const idx = coins.findIndex((c: any) => c.base_asset === this.mkPinned);
      if (idx > 0) {
        const [pinned] = coins.splice(idx, 1);
        coins.unshift(pinned);
      }
    }
    return coins;
  },

  mkPageCoins(this: any) {
    const filtered = this.mkFilteredCoins();
    const start = (this.mkPage - 1) * this.mkPerPage;
    return filtered.slice(start, start + this.mkPerPage);
  },

  mkTotalPages(this: any) {
    return Math.max(1, Math.ceil(this.mkFilteredCoins().length / this.mkPerPage));
  },

  fmtPaxosPrice(v: any) {
    if (v == null) return '—';
    const n = parseFloat(v);
    if (isNaN(n) || n === 0) return '—';
    if (n < 0.0001) return '$' + n.toFixed(10).replace(/\.?0+$/, '');
    if (n < 0.01) return '$' + n.toFixed(6).replace(/\.?0+$/, '');
    if (n < 1) return '$' + n.toFixed(4);
    return fmtUSD(n);
  },

  lookupConfidenceClass(c: string) {
    if (c === 'confirmed') return 'badge-green';
    if (c === 'likely') return 'badge-yellow';
    return 'badge-muted';
  },

  lookupConfidenceLabel(c: string) {
    if (c === 'confirmed') return 'Confirmed';
    if (c === 'likely') return 'Likely';
    return 'Format Match';
  },

  pnlClass(n: number | null) { return n == null ? '' : n >= 0 ? 'pos' : 'neg'; },

  async refreshPortfolio(this: any) {
    if (!this.activePortfolioId) return;
    this.loadingPortfolio = true;
    try {
      const res = await apiFetch<{ portfolio: any; refreshed_coins: number }>(`/portfolios/${this.activePortfolioId}/refresh`, { method: 'POST' });
      this.portfolioDetail = res.portfolio;
      await this.$nextTick();
      this.renderPieChart();
      (Alpine.store('toast') as ToastStore).show(`Refreshed ${res.refreshed_coins} coin price${res.refreshed_coins === 1 ? '' : 's'}`);
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    } finally {
      this.loadingPortfolio = false;
    }
  },

  logout(this: any) {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    (Alpine.store('auth') as AuthStore).logout();
    window.location.reload();
  },
});

Alpine.start();
