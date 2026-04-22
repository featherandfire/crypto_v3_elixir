defmodule CryptoPortfolioV3.Chain do
  @moduledoc """
  Chain-related public API: EVM wallet balances, (later) Solana lookups,
  tx resolving, hash format detection.
  """

  alias CryptoPortfolioV3.Chain.{
    ChainInfo,
    EnrichedSolana,
    EnrichedTron,
    EnrichedWallet,
    EvmTx,
    SolanaTx,
    TxResolver
  }

  @doc "Static list of supported EVM chains."
  def list_chains, do: ChainInfo.list()

  @doc "Enriched balances (native + ERC-20) for an EVM wallet on a chain."
  def fetch_wallet_balances(address, chain_slug),
    do: EnrichedWallet.fetch(address, chain_slug)

  @doc "Enriched balances across all supported EVM chains."
  def fetch_wallet_balances_all_evm(address), do: EnrichedWallet.fetch_all(address)

  @doc "Last-buy-fees breakdown for (chain, wallet, coin-contract)."
  def last_buy_fees(chain_slug, wallet, contract),
    do: EvmTx.fetch_last_buy_fees(chain_slug, wallet, contract)

  @doc "Enriched native SOL + SPL balances for a Solana wallet (with caps)."
  def fetch_solana_wallet_balances(address), do: EnrichedSolana.fetch(address)

  @doc "Compact Solana tx display summary (used by /api/lookup)."
  def solana_tx_summary(signature), do: SolanaTx.fetch_tx_summary(signature)

  @doc "Last-buy-fees breakdown for a Solana (wallet, mint) pair."
  def solana_last_buy_fees(wallet, mint, opts \\ []),
    do: SolanaTx.fetch_last_buy_fees(wallet, mint, opts)

  @doc "Resolves a tx hash → originating wallet address + chain."
  def resolve_from_tx(hash), do: TxResolver.resolve(hash)

  @doc "Enriched TRX + TRC-20 balances for a Tron wallet."
  def fetch_tron_wallet_balances(address), do: EnrichedTron.fetch(address)
end
