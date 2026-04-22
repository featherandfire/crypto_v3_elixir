defmodule CryptoPortfolioV3.Chain.TxResolver do
  @moduledoc """
  Resolves a tx hash / signature → originating wallet address.

    * Solana sig (87-88 base58 chars) → `SolanaTx.fetch_tx_summary` → payer
    * EVM tx (0x + 64 hex) → `eth_getTransactionByHash` probed across all
      supported chains in parallel; returns the first hit.
  """

  alias CryptoPortfolioV3.Chain.{ChainInfo, EvmRpc, SolanaTx}

  @evm_tx_re ~r/^0x[0-9a-fA-F]{64}$/
  @sol_sig_re ~r/^[1-9A-HJ-NP-Za-km-z]{87,88}$/

  @spec resolve(binary()) :: {:ok, map()} | {:error, :unsupported_format | :not_found}
  def resolve(hash) when is_binary(hash) do
    cond do
      Regex.match?(@sol_sig_re, hash) -> resolve_solana(hash)
      Regex.match?(@evm_tx_re, hash) -> probe_evm(String.downcase(hash))
      true -> {:error, :unsupported_format}
    end
  end

  defp resolve_solana(signature) do
    case SolanaTx.fetch_tx_summary(signature) do
      {:ok, %{payer: payer}} when is_binary(payer) and payer != "" ->
        {:ok, %{"address" => payer, "chain" => "solana", "chain_name" => "Solana"}}

      _ ->
        {:error, :not_found}
    end
  end

  defp probe_evm(hash) do
    ChainInfo.list()
    |> Task.async_stream(
      fn chain ->
        case EvmRpc.call(chain.rpc_url, "eth_getTransactionByHash", [hash]) do
          {:ok, %{"from" => from}} when is_binary(from) -> {:hit, chain, from}
          _ -> :miss
        end
      end,
      max_concurrency: length(ChainInfo.list()),
      timeout: 8_000,
      on_timeout: :kill_task
    )
    |> Enum.find_value(fn
      {:ok, {:hit, chain, from}} ->
        %{"address" => String.downcase(from), "chain" => chain.slug, "chain_name" => chain.name}

      _ ->
        nil
    end)
    |> case do
      nil -> {:error, :not_found}
      result -> {:ok, result}
    end
  end
end
