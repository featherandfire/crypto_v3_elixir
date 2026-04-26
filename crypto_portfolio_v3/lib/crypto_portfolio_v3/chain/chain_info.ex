defmodule CryptoPortfolioV3.Chain.ChainInfo do
  @moduledoc """
  EVM chain configuration. Targets Etherscan V2 multi-chain API — all calls
  go to the same base URL with a `chainid` query param selecting which chain.
  """

  @chains %{
    "eth" => %{
      chain_id: 1,
      name: "Ethereum",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "ethereum",
      rpc_url: "https://ethereum.publicnode.com",
      explorer_base: "https://etherscan.io",
      color: "#627EEA",
      probe: true
    },
    "bsc" => %{
      chain_id: 56,
      name: "BNB Chain",
      native_symbol: "BNB",
      native_name: "BNB",
      native_cg_id: "binancecoin",
      cg_platform: "binance-smart-chain",
      rpc_url: "https://bsc.publicnode.com",
      explorer_base: "https://bscscan.com",
      color: "#F3BA2F",
      probe: true
    },
    "polygon" => %{
      chain_id: 137,
      name: "Polygon",
      native_symbol: "POL",
      native_name: "Polygon",
      native_cg_id: "polygon-ecosystem-token",
      cg_platform: "polygon-pos",
      rpc_url: "https://polygon-bor.publicnode.com",
      explorer_base: "https://polygonscan.com",
      color: "#8247E5",
      probe: true
    },
    "arbitrum" => %{
      chain_id: 42_161,
      name: "Arbitrum",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "arbitrum-one",
      rpc_url: "https://arbitrum-one.publicnode.com",
      explorer_base: "https://arbiscan.io",
      color: "#28A0F0",
      probe: false
    },
    "optimism" => %{
      chain_id: 10,
      name: "Optimism",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "optimistic-ethereum",
      rpc_url: "https://optimism.publicnode.com",
      explorer_base: "https://optimistic.etherscan.io",
      color: "#FF0420",
      probe: false
    },
    "avalanche" => %{
      chain_id: 43_114,
      name: "Avalanche",
      native_symbol: "AVAX",
      native_name: "Avalanche",
      native_cg_id: "avalanche-2",
      cg_platform: "avalanche",
      rpc_url: "https://avalanche-c-chain.publicnode.com",
      explorer_base: "https://snowtrace.io",
      color: "#E84142",
      probe: false
    },
    "base" => %{
      chain_id: 8453,
      name: "Base",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "base",
      rpc_url: "https://base.publicnode.com",
      explorer_base: "https://basescan.org",
      color: "#0052FF",
      probe: false
    },
    "linea" => %{
      chain_id: 59_144,
      name: "Linea",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "linea",
      rpc_url: "https://rpc.linea.build",
      explorer_base: "https://lineascan.build",
      color: "#61DFFF",
      probe: false
    },
    "zksync" => %{
      chain_id: 324,
      name: "zkSync Era",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "zksync",
      rpc_url: "https://mainnet.era.zksync.io",
      explorer_base: "https://explorer.zksync.io",
      color: "#4E529A",
      probe: false
    },
    "scroll" => %{
      chain_id: 534_352,
      name: "Scroll",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "scroll",
      rpc_url: "https://rpc.scroll.io",
      explorer_base: "https://scrollscan.com",
      color: "#FFEEDA",
      probe: false
    },
    "blast" => %{
      chain_id: 81_457,
      name: "Blast",
      native_symbol: "ETH",
      native_name: "Ethereum",
      native_cg_id: "ethereum",
      cg_platform: "blast",
      rpc_url: "https://rpc.blast.io",
      explorer_base: "https://blastscan.io",
      color: "#FCFC03",
      probe: false
    }
  }

  def get(slug), do: Map.get(@chains, slug)
  def all, do: @chains

  @doc "All chains as a list of maps, each with a `:slug` key added."
  def list do
    @chains
    |> Enum.map(fn {slug, info} -> Map.put(info, :slug, slug) end)
    |> Enum.sort_by(& &1.chain_id)
  end
end
