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
    } else if (body.errors && typeof body.errors === 'object') {
      msg = Object.entries(body.errors as Record<string, string[]>)
        .map(([field, errs]) => `${field} ${errs.join(', ')}`)
        .join('; ');
    }
    const e: ApiError = new Error(msg);
    e.status = res.status;
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
  }
}

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
      const res = await apiFetch<{ user: User; token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
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

window.loginApp = () => ({
  tab: 'login' as 'login' | 'register',
  username: '', email: '', password: '',
  loading: false, error: '',
  // verification stubs (backend has no email verification yet)
  verifyStep: false, pendingEmail: '', verifyCode: '', resendCooldown: 0,

  async submit(this: any) {
    this.error = '';
    this.loading = true;
    try {
      const auth = Alpine.store('auth') as AuthStore;
      if (this.tab === 'login') {
        await auth.login(this.username, this.password);
      } else {
        await auth.register(this.username, this.email, this.password);
      }
      window.location.reload();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  },

  async submitVerify() { /* no-op */ },
  async resendCode() { /* no-op */ },
});

// ── Dashboard component ─────────────────────────────────────────────────────

const VALID_PAGES = ['portfolios', 'market', 'resources', 'lookup', 'marketplace', 'platforms'];
const restoredPage = (() => {
  try {
    const v = localStorage.getItem('currentPage');
    // Migrate old 'dashboard' value silently for users who saved it before the rename.
    if (v === 'dashboard') return 'portfolios';
    return v && VALID_PAGES.includes(v) ? v : 'portfolios';
  } catch { return 'portfolios'; }
})();

window.dashApp = () => ({
  // State
  page: restoredPage,
  portfolios: [] as Portfolio[],
  activePortfolioId: null as number | null,
  portfolioDetail: null as any,
  lastBuyFees: {} as Record<number, any>,
  activeWalletFilter: null as string | null,
  loadingPortfolio: false,
  _refreshTimer: null as ReturnType<typeof setInterval> | null,

  // Market
  topCoins: [] as any[],
  filteredCoins: [] as any[],
  loadingMarket: false,
  coinSearch: '',
  priceChart: null as Chart | null,
  selectedChartCoin: null as string | null,
  // Cache the /coins/:id/history responses keyed by `${coin}:${days}` with a
  // 5-minute TTL so flipping between range buttons doesn't re-hit the API.
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

    await this.loadPortfolios();
    if (this.portfolios.length) {
      this.activePortfolioId = this.portfolios[0].id;
      await this.loadPortfolioDetail();
    }
    this.$watch('page', (p: string) => {
      try { localStorage.setItem('currentPage', p); } catch {}
      if (p === 'market') this.loadMarket();
      if (p === 'marketplace') this.loadMarketplace();
    });

    // If the restored page is market/marketplace, kick off its data load
    // now — the $watch above only fires on future changes, not initial value.
    if (this.page === 'market') this.loadMarket();
    if (this.page === 'marketplace') this.loadMarketplace();

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
    }, 2000);

    this.$watch('holdingSearch', () => this._rebuildHoldingCoins());
    this.$watch('holdingSearchResults', () => this._rebuildHoldingCoins());
    this.$watch('topCoins', () => { this._rebuildHoldingCoins(); this._rebuildFilteredCoins(); });
    this.$watch('coinSearch', () => this._rebuildFilteredCoins());
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
    // 24h cache: tx hashes don't change. Avoids re-hitting Etherscan on every
    // dashboard refresh, where rate limits cause some holdings to come back
    // empty even when prior calls succeeded.
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
      // Prefer the chain stored on the holding (set during wallet import).
      // Fall back to address-shape detection — accurate for Solana, defaults
      // to ETH for EVM-shaped addresses on legacy rows.
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
        // Persist successful responses only — don't cache 'unavailable' or
        // null results, so a transient rate-limit doesn't poison the cache
        // for a full day.
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

    // Filter out holdings without a numeric, positive value. The API now
    // returns decimals-as-strings; parseDecimalsDeep restores them to numbers,
    // but we guard with Number.isFinite in case of null / stale data.
    const holdings = (this.portfolioDetail?.holdings ?? []).filter((h: any) => {
      const v = Number(h.current_value_usd);
      return Number.isFinite(v) && v > 0;
    });

    // If our stored reference drifted from what Chart.js tracks (page flips,
    // DOM swaps), reconcile to the one actually bound to this canvas so the
    // next destroy/update targets a live instance.
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

    // Update in place if the chart already exists — avoids destroy/recreate
    // flicker on the 90s auto-refresh and rapid portfolio switches. Wrap in
    // try/catch: Chart.js occasionally throws "Cannot set 'fullSize'" when
    // internal layout state is stale. In that case, rebuild.
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

  // ── Market page ───────────────────────────────────────────────────────────

  async loadMarket(this: any) {
    this.loadingMarket = true;
    try {
      if (this.topCoins.length < 200) {
        const r = await apiFetch<{ coins: any[] }>('/coins/top?limit=200');
        this.topCoins = r.coins;
      }
    } catch (e) {
      (Alpine.store('toast') as ToastStore).show((e as Error).message, 'error');
    } finally {
      this.loadingMarket = false;
    }
  },

  _rebuildFilteredCoins(this: any) {
    const q = this.coinSearch.toLowerCase();
    this.filteredCoins = q
      ? this.topCoins.filter((c: any) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
      : [...this.topCoins];
  },

  // ── Lookup ────────────────────────────────────────────────────────────────

  async lookupHash(this: any) {
    const q = this.lookupQuery.trim();
    if (!q) return;
    this.lookupLoading = true;
    this.lookupError = '';
    this.lookupResult = null;
    try {
      this.lookupResult = await apiFetch(`/lookup/${encodeURIComponent(q)}`);
    } catch (e) {
      this.lookupError = (e as Error).message;
    } finally {
      this.lookupLoading = false;
    }
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
