defmodule CryptoPortfolioV3.Chain.EnrichedTron do
  @moduledoc """
  Tron wallet fetch + CoinGecko enrichment. Matches the shape produced by
  `EnrichedWallet` (EVM) and `EnrichedSolana` for a unified frontend contract.
  CG platform slug for Tron contract lookups is `"tron"`.
  """

  alias CryptoPortfolioV3.Chain.TronWallet
  alias CryptoPortfolioV3.Market

  @match_cap 50
  @max_total 100

  @spec fetch(binary()) :: {:ok, [map()]}
  def fetch(address) when is_binary(address) do
    {:ok, raw_balances} = TronWallet.fetch_balances(address)
    {:ok, enrich(raw_balances)}
  end

  defp enrich(raw_balances) do
    sentinel = TronWallet.trx_native_sentinel()
    {native_raw, trc20_raw} = Enum.split_with(raw_balances, fn b -> b.contract_address == sentinel end)

    sorted = Enum.sort_by(trc20_raw, & &1.balance, {:desc, Decimal})
    {to_match, over_cap} = Enum.split(sorted, @match_cap)

    native_prices_task = Task.async(fn -> fetch_native_price(native_raw) end)
    matches_task = Task.async(fn -> fetch_matches(to_match) end)

    native_prices = yield_or_empty(native_prices_task, 20_000)
    matches = yield_or_empty(matches_task, 30_000)

    native = Enum.map(native_raw, &native_entry(&1, native_prices))

    {matched, unmatched_top} =
      Enum.split_with(to_match, fn b -> Map.has_key?(matches, b.contract_address) end)

    matched_entries = Enum.map(matched, &matched_entry(&1, matches))

    cap_remaining = max(@max_total - length(matched_entries), 0)

    unmatched_entries =
      (unmatched_top ++ over_cap)
      |> Enum.sort_by(& &1.balance, {:desc, Decimal})
      |> Enum.take(cap_remaining)
      |> Enum.map(&unmatched_entry/1)

    native ++ matched_entries ++ unmatched_entries
  end

  defp fetch_native_price([]), do: %{}

  defp fetch_native_price(_) do
    case Market.fetch_prices(["tron"]) do
      {:ok, map} -> map
      _ -> %{}
    end
  end

  defp fetch_matches([]), do: %{}

  defp fetch_matches(list) do
    list
    |> Enum.map(& &1.contract_address)
    |> Market.match_tokens_by_contract("tron")
  end

  defp native_entry(b, native_prices) do
    rec = Map.get(native_prices, "tron", %{})

    %{
      coingecko_id: "tron",
      contract_address: b.contract_address,
      chain: "tron",
      chain_name: "Tron",
      symbol: "TRX",
      name: "TRON",
      amount: b.balance,
      decimals: b.decimals,
      current_price_usd: Map.get(rec, "current_price_usd"),
      image_url: Map.get(rec, "image_url"),
      matched: true
    }
  end

  defp matched_entry(b, matches) do
    info = Map.fetch!(matches, b.contract_address)

    %{
      coingecko_id: info["coingecko_id"],
      contract_address: b.contract_address,
      chain: "tron",
      chain_name: "Tron",
      symbol: info["symbol"] || b.symbol,
      name: info["name"] || b.name,
      amount: b.balance,
      decimals: b.decimals,
      current_price_usd: info["current_price_usd"],
      image_url: info["image_url"],
      matched: true
    }
  end

  defp unmatched_entry(b) do
    %{
      coingecko_id: nil,
      contract_address: b.contract_address,
      chain: "tron",
      chain_name: "Tron",
      symbol: b.symbol,
      name: b.name,
      amount: b.balance,
      decimals: b.decimals,
      current_price_usd: nil,
      image_url: nil,
      matched: false
    }
  end

  defp yield_or_empty(task, timeout_ms) do
    case Task.yield(task, timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} -> result
      _ -> %{}
    end
  end
end
