defmodule CryptoPortfolioV3.Market.Fallbacks do
  @moduledoc """
  Hardcoded maps used when CoinGecko is rate-limiting or doesn't know a
  token.
  """

  @solana_mints %{
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" => %{
      coingecko_id: "usd-coin",
      symbol: "USDC",
      name: "USDC"
    },
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" => %{
      coingecko_id: "tether",
      symbol: "USDT",
      name: "Tether"
    },
    "So11111111111111111111111111111111111111112" => %{
      coingecko_id: "wrapped-solana",
      symbol: "wSOL",
      name: "Wrapped Solana"
    },
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" => %{
      coingecko_id: "bonk",
      symbol: "BONK",
      name: "Bonk"
    },
    "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" => %{
      coingecko_id: "jupiter-exchange-solana",
      symbol: "JUP",
      name: "Jupiter"
    },
    "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" => %{
      coingecko_id: "raydium",
      symbol: "RAY",
      name: "Raydium"
    },
    "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" => %{
      coingecko_id: "orca",
      symbol: "ORCA",
      name: "Orca"
    },
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" => %{
      coingecko_id: "msol",
      symbol: "mSOL",
      name: "Marinade Staked SOL"
    },
    "HZ1JovNiVvGrGs7igeECtKiGHCFwHd9YTFGMCdFMkiuQ" => %{
      coingecko_id: "pyth-network",
      symbol: "PYTH",
      name: "Pyth Network"
    }
  }

  @platform_contracts %{
    "usd-coin" => %{
      "ethereum" => "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "polygon-pos" => "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      "arbitrum-one" => "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      "optimistic-ethereum" => "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
      "binance-smart-chain" => "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "base" => "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      "solana" => "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    },
    "tether" => %{
      "ethereum" => "0xdac17f958d2ee523a2206206994597c13d831ec7",
      "polygon-pos" => "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      "arbitrum-one" => "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
      "binance-smart-chain" => "0x55d398326f99059ff775485246999027b3197955",
      "solana" => "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
    },
    "ethereum" => %{
      "ethereum" => "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      "polygon-pos" => "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      "arbitrum-one" => "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      "optimistic-ethereum" => "0x4200000000000000000000000000000000000006",
      "base" => "0x4200000000000000000000000000000000000006"
    },
    "dai" => %{"ethereum" => "0x6b175474e89094c44da98b954eedeac495271d0f"},
    "chainlink" => %{"ethereum" => "0x514910771af9ca656af840dff83e8264ecf986ca"},
    "uniswap" => %{"ethereum" => "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"},
    "aave" => %{"ethereum" => "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"},
    "wrapped-bitcoin" => %{"ethereum" => "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"},
    "nexo" => %{"ethereum" => "0xb62132e35a6c13ee1ee0f84dc5d40bad8d815206"},
    "matic-network" => %{"ethereum" => "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0"},
    "polygon-ecosystem-token" => %{"ethereum" => "0x455e53cbb86018ac2b8092fdcd39d8444affc3f6"},
    "shiba" => %{"ethereum" => "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce"},
    "shiba-inu" => %{"ethereum" => "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce"}
  }

  @cg_to_solana_mint Map.new(@solana_mints, fn {mint, %{coingecko_id: id}} -> {id, mint} end)

  def solana_mint(address), do: Map.get(@solana_mints, address)

  @doc "Inverse lookup: coingecko_id → Solana SPL mint address, when known."
  def solana_mint_for_cg_id(coingecko_id), do: Map.get(@cg_to_solana_mint, coingecko_id)

  def platform_contract(coingecko_id, platform), do: get_in(@platform_contracts, [coingecko_id, platform])
end
