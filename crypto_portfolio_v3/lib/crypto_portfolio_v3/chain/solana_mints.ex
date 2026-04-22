defmodule CryptoPortfolioV3.Chain.SolanaMints do
  @moduledoc """
  Solana-specific hardcoded maps:

    * `@known_mints` — well-known mint → symbol, used when CoinGecko is
      unavailable or rate-limiting.
    * `@stablecoins` — mints treated as USD-pegged for `spread_usd` calcs.
    * `@routers` — DEX / aggregator program IDs → display name.
  """

  @known_mints %{
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" => "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" => "USDT",
    "So11111111111111111111111111111111111111112" => "wSOL",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" => "BONK",
    "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" => "JUP",
    "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" => "RAY",
    "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" => "ORCA",
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" => "mSOL",
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj" => "stSOL",
    "HZ1JovNiVvGrGs7igeECtKiGHCFwHd9YTFGMCdFMkiuQ" => "PYTH",
    "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" => "wETH",
    "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E" => "wBTC",
    "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac" => "MNGO"
  }

  @stablecoins MapSet.new([
    # USDC
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    # USDT
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    # Phantom CASH
    "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH"
  ])

  @routers %{
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" => "Jupiter",
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB" => "Jupiter v4",
    "JUP3c2Uh3WA4Ng34tw6kPd2G4XKbb5zvxLd4m1K9yXa" => "Jupiter v3",
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8" => "Raydium AMM",
    "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h" => "Raydium CLMM",
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK" => "Raydium CAMM",
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP" => "Orca",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" => "Orca Whirlpools",
    "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX" => "OpenBook",
    "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb" => "OpenBook v2",
    "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" => "Pump.fun",
    "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" => "Meteora DLMM",
    "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EkAW7vA" => "Meteora",
    "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY" => "Phoenix",
    "DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm" => "Dex.guru",
    "HKx5d1sMEmBaT17a1r5tCqKw95JZt7M1LRJvkxvfFaV4" => "OKX DEX",
    "6MLxLqofvEkLnefa3cR6jR4H7qCVHXxU1WuwwCzBbfZq" => "OKX DEX",
    "obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y" => "OKX DEX",
    "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u" => "Phantom Swap",
    "ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA" => "AlphaQ",
    "6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma" => "OKX DEX Aggregator",
    "Ag3hiK9svNixH9Vu5sD2CmK5fyDWrx9a1iVSbZW22bUS" => "OKX Labs"
  }

  def known(mint), do: Map.get(@known_mints, mint)
  def known_map, do: @known_mints
  def stable?(mint), do: MapSet.member?(@stablecoins, mint)
  def router(pubkey), do: Map.get(@routers, pubkey)
  def routers, do: @routers
end
