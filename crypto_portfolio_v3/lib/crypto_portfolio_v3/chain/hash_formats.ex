defmodule CryptoPortfolioV3.Chain.HashFormats do
  @moduledoc """
  Hash/address format detection for the `/api/lookup` endpoint. Regex-only,
  no RPC calls — callers use the returned type string to decide whether to
  probe live chain state.
  """

  @evm_address ~r/^0x[0-9a-fA-F]{40}$/
  @evm_tx ~r/^0x[0-9a-fA-F]{64}$/
  @btc_legacy ~r/^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/
  @btc_bech32 ~r/^bc1[a-z0-9]{6,87}$/i
  @hex64 ~r/^[0-9a-fA-F]{64}$/
  @sol_address ~r/^[1-9A-HJ-NP-Za-km-z]{32,44}$/
  @sol_sig ~r/^[1-9A-HJ-NP-Za-km-z]{87,88}$/
  @tron ~r/^T[1-9A-HJ-NP-Za-km-z]{33}$/
  @ltc_legacy ~r/^[LM][a-km-zA-HJ-NP-Z1-9]{25,33}$/
  @ltc_bech32 ~r/^ltc1[a-z0-9]{6,87}$/i

  @type detection ::
          {raw_type :: String.t(), display_type :: String.t()} | :unknown

  @spec detect(binary()) :: detection
  def detect(h) when is_binary(h) do
    cond do
      Regex.match?(@evm_address, h) -> {"evm_address", "EVM Address"}
      Regex.match?(@evm_tx, h) -> {"evm_tx_hash", "EVM Transaction / Block Hash"}
      Regex.match?(@tron, h) -> {"tron_address", "Tron Address"}
      Regex.match?(@ltc_bech32, h) -> {"ltc_bech32_address", "Litecoin Address (Bech32)"}
      Regex.match?(@ltc_legacy, h) -> {"ltc_address", "Litecoin Address"}
      Regex.match?(@btc_bech32, h) -> {"btc_bech32_address", "Bitcoin Address (SegWit/Taproot)"}
      Regex.match?(@btc_legacy, h) -> {"btc_address", "Bitcoin Address"}
      Regex.match?(@sol_sig, h) -> {"sol_tx_sig", "Solana Transaction Signature"}
      Regex.match?(@hex64, h) -> {"btc_tx_hash", "Bitcoin Transaction Hash"}
      Regex.match?(@sol_address, h) -> {"sol_address", "Solana Address"}
      true -> :unknown
    end
  end
end
