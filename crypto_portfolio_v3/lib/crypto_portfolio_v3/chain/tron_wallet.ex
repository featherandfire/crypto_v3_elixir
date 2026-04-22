defmodule CryptoPortfolioV3.Chain.TronWallet do
  @moduledoc """
  Fetches TRX + popular TRC-20 balances for a Tron wallet. Fan-out over
  `Chain.TronTokens.all/0` via `Task.async_stream`; zero balances are filtered.
  """

  alias CryptoPortfolioV3.Chain.{Tron, TronTokens}

  @trx_native_sentinel "trx-native"

  def trx_native_sentinel, do: @trx_native_sentinel

  @spec fetch_balances(binary()) :: {:ok, [map()]}
  def fetch_balances(address) when is_binary(address) do
    trx_task = Task.async(fn -> Tron.get_trx_balance(address) end)

    trc20_tasks =
      TronTokens.all()
      |> Task.async_stream(
        fn token ->
          case Tron.trc20_balance_of(address, token.contract) do
            {:ok, raw} -> {:ok, token, raw}
            _ -> :error
          end
        end,
        max_concurrency: 5,
        timeout: 20_000,
        on_timeout: :kill_task
      )
      |> Enum.to_list()

    trx_balance =
      case Task.await(trx_task, 20_000) do
        {:ok, sun} when is_integer(sun) and sun > 0 -> [native_entry(sun)]
        _ -> []
      end

    trc20_balances =
      Enum.flat_map(trc20_tasks, fn
        {:ok, {:ok, token, raw}} when is_integer(raw) and raw > 0 -> [trc20_entry(token, raw)]
        _ -> []
      end)

    {:ok, trx_balance ++ trc20_balances}
  end

  defp native_entry(sun) do
    # TRX native uses 6 decimals (1 TRX = 1,000,000 sun).
    balance = Decimal.div(Decimal.new(sun), Decimal.new(1_000_000))

    %{
      contract_address: @trx_native_sentinel,
      symbol: "TRX",
      name: "TRON",
      decimals: 6,
      balance: balance
    }
  end

  defp trc20_entry(%{contract: c, symbol: s, name: n, decimals: d}, raw) do
    balance = Decimal.div(Decimal.new(raw), Decimal.new(Integer.pow(10, d)))
    %{contract_address: c, symbol: s, name: n, decimals: d, balance: balance}
  end
end
