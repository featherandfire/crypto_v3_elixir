defmodule CryptoPortfolioV3.Chain.EnrichedSolana do
  @moduledoc """
  Solana wallet fetch + CoinGecko enrichment with caps:

    * `@match_cap` — only look up top-N SPL mints by balance against CG
      (active wallets routinely hold hundreds of dust / airdrop tokens)
    * `@max_total` — cap total entries returned so a dust-heavy wallet
      doesn't overwhelm the UI; always prefer matched tokens

  Output shape matches `EnrichedWallet` for a unified frontend contract.
  """

  alias CryptoPortfolioV3.Chain.SolanaWallet
  alias CryptoPortfolioV3.Market

  @match_cap 50
  @max_total 100

  @spec fetch(binary()) :: {:ok, [map()]}
  def fetch(address) when is_binary(address) do
    {:ok, raw_balances} = SolanaWallet.fetch_balances(address)
    {:ok, enrich(raw_balances)}
  end

  # ── Enrichment core ──

  defp enrich(raw_balances) do
    sol_sentinel = SolanaWallet.sol_native_sentinel()
    {native_raw, spl_raw} = Enum.split_with(raw_balances, fn b -> b.mint == sol_sentinel end)

    # Top MATCH_CAP SPL mints by balance — only those hit CG for metadata.
    sorted_spl = Enum.sort_by(spl_raw, & &1.balance, {:desc, Decimal})
    {to_match, over_cap} = Enum.split(sorted_spl, @match_cap)

    native_prices_task = Task.async(fn -> fetch_sol_prices(native_raw) end)
    contract_matches_task = Task.async(fn -> fetch_contract_matches(to_match) end)

    # Bounded waits — CG rate-limits readily; unmatched fallback preferable to hang.
    native_prices = yield_or_empty(native_prices_task, 20_000)
    contract_matches = yield_or_empty(contract_matches_task, 30_000)

    native = Enum.map(native_raw, &native_entry(&1, native_prices))

    {matched, unmatched_top} =
      Enum.split_with(to_match, fn b -> Map.has_key?(contract_matches, b.mint) end)

    matched_entries = Enum.map(matched, &matched_entry(&1, contract_matches))

    # Unmatched (both from-cap + over-cap) by balance desc, capped by @max_total - matched.
    cap_remaining = max(@max_total - length(matched_entries), 0)

    unmatched_entries =
      (unmatched_top ++ over_cap)
      |> Enum.sort_by(& &1.balance, {:desc, Decimal})
      |> Enum.take(cap_remaining)
      |> Enum.map(&unmatched_entry/1)

    native ++ matched_entries ++ unmatched_entries
  end

  defp fetch_sol_prices([]), do: %{}

  defp fetch_sol_prices(_) do
    case Market.fetch_prices(["solana"]) do
      {:ok, map} -> map
      _ -> %{}
    end
  end

  defp fetch_contract_matches([]), do: %{}

  defp fetch_contract_matches(to_match) do
    to_match
    |> Enum.map(& &1.mint)
    |> Market.match_tokens_by_contract("solana")
  end

  defp native_entry(b, native_prices) do
    rec = Map.get(native_prices, "solana", %{})

    %{
      coingecko_id: "solana",
      contract_address: b.mint,
      chain: "solana",
      chain_name: "Solana",
      symbol: "SOL",
      name: "Solana",
      amount: b.balance,
      decimals: 9,
      current_price_usd: Map.get(rec, "current_price_usd"),
      image_url: Map.get(rec, "image_url"),
      matched: true
    }
  end

  defp matched_entry(b, matches) do
    info = Map.fetch!(matches, b.mint)

    %{
      coingecko_id: info["coingecko_id"],
      contract_address: b.mint,
      chain: "solana",
      chain_name: "Solana",
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
      contract_address: b.mint,
      chain: "solana",
      chain_name: "Solana",
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
