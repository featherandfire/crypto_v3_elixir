defmodule CryptoPortfolioV3.Chain.EnrichedWallet do
  @moduledoc """
  EVM wallet fetch + CoinGecko enrichment. Response shape:
  `{coingecko_id, contract_address, chain, chain_name, symbol, name,
  amount, decimals, current_price_usd, image_url, matched}`.
  """

  alias CryptoPortfolioV3.Chain.{ChainInfo, Etherscan, Wallet}
  alias CryptoPortfolioV3.Market

  @spec fetch(binary(), binary()) :: {:ok, [map()]} | {:error, :unknown_chain}
  def fetch(address, chain_slug) when is_binary(address) and is_binary(chain_slug) do
    case ChainInfo.get(chain_slug) do
      nil ->
        {:error, :unknown_chain}

      chain ->
        {:ok, raw_balances} = Wallet.fetch_balances(address, chain_slug)
        {:ok, enrich(raw_balances, chain, chain_slug)}
    end
  end

  @doc """
  Fan-out across all 7 EVM chains for a single address. Per-chain failures
  don't abort the whole response — only successful chains contribute entries.
  """
  @spec fetch_all(binary()) :: {:ok, [map()]}
  def fetch_all(address) when is_binary(address) do
    chain_count = length(ChainInfo.list())

    balances =
      ChainInfo.list()
      |> Task.async_stream(
        fn chain ->
          case fetch(address, chain.slug) do
            {:ok, list} -> list
            _ -> []
          end
        end,
        max_concurrency: chain_count,
        timeout: 90_000,
        on_timeout: :kill_task
      )
      |> Enum.flat_map(fn
        {:ok, list} -> list
        _ -> []
      end)

    {:ok, balances}
  end

  # ── Enrichment core ──

  defp enrich(raw_balances, chain, chain_slug) do
    eth_sentinel = Etherscan.eth_sentinel()

    {native_raw, erc20_raw} =
      Enum.split_with(raw_balances, fn b -> b.contract_address == eth_sentinel end)

    native_prices_task =
      Task.async(fn -> fetch_native_prices(chain.native_cg_id, native_raw) end)

    contract_matches_task =
      Task.async(fn -> fetch_contract_matches(erc20_raw, chain.cg_platform) end)

    # Bounded waits. If CG rate-limits, we return partial matches rather
    # than hanging the request or crashing. yield+shutdown preserves a clean
    # shutdown if the task is still running.
    native_prices = yield_or_empty(native_prices_task, 20_000)
    contract_matches = yield_or_empty(contract_matches_task, 30_000)

    native = Enum.map(native_raw, &native_entry(&1, chain, chain_slug, native_prices))
    erc20 = Enum.map(erc20_raw, &erc20_entry(&1, chain, chain_slug, contract_matches))

    native ++ sort_matched_first(erc20)
  end

  defp fetch_native_prices(_cg_id, []), do: %{}

  defp fetch_native_prices(cg_id, _native_raw) do
    case Market.fetch_prices([cg_id]) do
      {:ok, map} -> map
      _ -> %{}
    end
  end

  defp fetch_contract_matches([], _platform), do: %{}

  defp fetch_contract_matches(erc20_raw, platform) do
    erc20_raw
    |> Enum.map(& &1.contract_address)
    |> Market.match_tokens_by_contract(platform)
  end

  defp native_entry(b, chain, chain_slug, native_prices) do
    rec = Map.get(native_prices, chain.native_cg_id, %{})

    %{
      coingecko_id: chain.native_cg_id,
      contract_address: b.contract_address,
      chain: chain_slug,
      chain_name: chain.name,
      symbol: chain.native_symbol,
      name: chain.native_name,
      amount: b.balance,
      decimals: 18,
      current_price_usd: Map.get(rec, "current_price_usd"),
      image_url: Map.get(rec, "image_url"),
      matched: true
    }
  end

  defp erc20_entry(b, chain, chain_slug, matches) do
    case Map.get(matches, b.contract_address) do
      %{} = info ->
        %{
          coingecko_id: info["coingecko_id"],
          contract_address: b.contract_address,
          chain: chain_slug,
          chain_name: chain.name,
          symbol: info["symbol"] || b.symbol,
          name: info["name"] || b.name,
          amount: b.balance,
          decimals: b.decimals,
          current_price_usd: info["current_price_usd"],
          image_url: info["image_url"],
          matched: true
        }

      _ ->
        %{
          coingecko_id: nil,
          contract_address: b.contract_address,
          chain: chain_slug,
          chain_name: chain.name,
          symbol: b.symbol,
          name: b.name,
          amount: b.balance,
          decimals: b.decimals,
          current_price_usd: nil,
          image_url: nil,
          matched: false
        }
    end
  end

  defp sort_matched_first(entries) do
    {matched, unmatched} = Enum.split_with(entries, & &1.matched)
    matched ++ unmatched
  end

  defp yield_or_empty(task, timeout_ms) do
    case Task.yield(task, timeout_ms) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} -> result
      _ -> %{}
    end
  end
end
