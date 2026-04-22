defmodule CryptoPortfolioV3.Chain.Wallet do
  @moduledoc """
  High-level EVM wallet balance orchestration. Runs the native-balance and
  token-contract calls in parallel, then fans out per-token balance checks
  bounded by `:etherscan` `:concurrency` config (default 5 req/s for free tier).
  """

  alias CryptoPortfolioV3.Chain.{ChainInfo, Etherscan}

  @spec fetch_balances(binary(), binary()) :: {:ok, [map()]} | {:error, :unknown_chain}
  def fetch_balances(address, chain_slug) when is_binary(address) and is_binary(chain_slug) do
    case ChainInfo.get(chain_slug) do
      nil -> {:error, :unknown_chain}
      chain -> {:ok, do_fetch(chain, address)}
    end
  end

  defp do_fetch(chain, address) do
    concurrency = Application.fetch_env!(:crypto_portfolio_v3, :etherscan)[:concurrency]

    # Native + contract enumeration in parallel.
    [native_task, contracts_task] =
      [
        Task.async(fn -> Etherscan.native_balance(chain.chain_id, address) end),
        Task.async(fn -> Etherscan.token_contracts(chain.chain_id, address) end)
      ]

    native_bal =
      case Task.await(native_task, 30_000) do
        {:ok, bal} -> bal
        _ -> Decimal.new(0)
      end

    contracts =
      case Task.await(contracts_task, 30_000) do
        {:ok, list} -> list
        _ -> []
      end

    # Per-token balance fan-out, capped by Etherscan free-tier rate.
    token_balances =
      contracts
      |> Task.async_stream(
        fn c -> Etherscan.token_balance(chain.chain_id, address, c) end,
        max_concurrency: concurrency,
        timeout: 30_000,
        on_timeout: :kill_task
      )
      |> Enum.flat_map(fn
        {:ok, {:ok, bal}} -> [bal]
        _ -> []
      end)

    # Native goes first if non-zero, matches TS behavior.
    if Decimal.gt?(native_bal, 0) do
      [native_entry(chain, native_bal) | token_balances]
    else
      token_balances
    end
  end

  defp native_entry(chain, balance) do
    %{
      contract_address: Etherscan.eth_sentinel(),
      symbol: chain.native_symbol,
      name: chain.native_name,
      decimals: 18,
      balance: balance
    }
  end
end
