# crypto_v3_elixir

Multi-chain crypto portfolio tracker. Elixir/Phoenix API backend, TypeScript/Alpine.js frontend, PostgreSQL. Tracks holdings across EVM chains, Solana, Tron, Bitcoin, and Litecoin; fetches live prices from CoinGecko; 

**Backend** 
- Elixir 1.19, OTP 28, Phoenix 1.8, Ecto 3.13, Bandit 1.10
- PostgreSQL 16


**Frontend** 
- TypeScript 6 (strict mode), Vite 8
- Alpine.js 3 (reactive framework), Chart.js 4, Three.js

**External services**
- CoinGecko (prices, contract resolution, yearly volatility)
- CryptoCompare (long-range % changes)
- Etherscan V2 (EVM balances + tx history) — requires free API key
- TronGrid (TRX + TRC-20)
- Solana public RPC, mempool.space (BTC), litecoinspace.org (LTC)

## Supported chains
(Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Base) + Solana + Tron / Bitcoin + Litecoin 
