defmodule CryptoPortfolioV3.Market.YearlyPrefetcher do
  @moduledoc """
  Supervised GenServer that keeps `coingecko_yearly_stats` warm for the
  top-N coins by market cap. Ported from `startYearlyPrefetch` in the TS
  app, but persists to Postgres instead of a JSON file.

  Tick schedule:
    * initial: `initial_delay_ms` after boot (default 10s)
    * hot (top 150) still empty after cycle → retry in `hot_retry_ms`
    * otherwise → full 24h cycle

  All timings overridable via env (see `config/runtime.exs`).
  """

  use GenServer
  require Logger
  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.Market.{CoinGecko, YearlyStat, YearlyVolatility}

  @yearly_ttl_ms 24 * 60 * 60_000
  @hot_retry_ms 2 * 60_000
  @full_cycle_ms 24 * 60 * 60_000
  @error_retry_ms 5 * 60_000

  # ── Public API ──

  def start_link(_opts), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    cfg = cfg()
    Logger.info("YearlyPrefetcher: starting (top=#{cfg[:top_limit]}, first tick in #{cfg[:initial_delay_ms]}ms)")
    schedule(cfg[:initial_delay_ms])
    {:ok, nil}
  end

  @impl true
  def handle_info(:tick, state) do
    next =
      try do
        run_cycle()
      rescue
        e ->
          Logger.error("YearlyPrefetcher crashed: #{Exception.message(e)}")
          @error_retry_ms
      end

    schedule(next)
    {:noreply, state}
  end

  # ── Internals ──

  defp schedule(delay_ms), do: Process.send_after(self(), :tick, delay_ms)

  defp run_cycle do
    cfg = cfg()
    hot_count = max(div(cfg[:top_limit] * 3, 4), 1)

    coin_ids =
      case CoinGecko.list_top(cfg[:top_limit]) do
        {:ok, raw} ->
          raw |> Enum.map(& &1["id"]) |> Enum.reject(&is_nil/1)

        {:error, reason} ->
          Logger.warning("YearlyPrefetcher: list_top failed (#{inspect(reason)}), falling back to DB ids")
          Repo.all(from y in YearlyStat, select: y.coingecko_id)
      end

    if coin_ids == [] do
      Logger.warning("YearlyPrefetcher: no coin ids available, retrying in #{div(@error_retry_ms, 60_000)}min")
      @error_retry_ms
    else
      process_ids(coin_ids, hot_count, cfg[:call_delay_ms])
    end
  end

  defp process_ids(coin_ids, hot_count, call_delay_ms) do
    now = DateTime.utc_now()
    {hot_ids, cold_ids} = Enum.split(coin_ids, hot_count)
    stats = load_stats(coin_ids)

    stale_hot = Enum.filter(hot_ids, &hot_stale?(Map.get(stats, &1), now))
    stale_cold = Enum.filter(cold_ids, &cold_stale?(Map.get(stats, &1), now))
    stale = stale_hot ++ stale_cold

    if stale == [] do
      Logger.info("YearlyPrefetcher: cache warm (#{map_size(stats)} entries), sleeping 24h")
      @full_cycle_ms
    else
      Logger.info("YearlyPrefetcher: #{length(stale)} stale of #{length(coin_ids)} total")

      Enum.each(stale, fn cid ->
        fetch_and_store(cid, now)
        if call_delay_ms > 0, do: Process.sleep(call_delay_ms)
      end)

      next_delay(hot_ids)
    end
  end

  defp fetch_and_store(cid, now) do
    case CoinGecko.market_chart(cid, 365) do
      {:ok, points} ->
        prices =
          points
          |> Enum.map(fn
            [_ts, p] when is_number(p) -> p
            _ -> nil
          end)
          |> Enum.reject(&is_nil/1)

        summary = YearlyVolatility.summarize(prices) || %{}
        upsert_stat(cid, summary, now)

      {:error, reason} ->
        Logger.debug("YearlyPrefetcher: market_chart(#{cid}) failed: #{inspect(reason)}")
        # Still write an empty row so we don't re-fetch within the TTL window.
        upsert_stat(cid, %{}, now)
    end
  end

  defp upsert_stat(cid, summary, now) do
    row = %{
      coingecko_id: cid,
      high_1y: to_decimal(summary[:high_1y]),
      low_1y: to_decimal(summary[:low_1y]),
      vol_90d: to_decimal(summary[:vol_90d]),
      vol_180d: to_decimal(summary[:vol_180d]),
      vol_365d: to_decimal(summary[:vol_365d]),
      fetched_at: now,
      inserted_at: now,
      updated_at: now
    }

    Repo.insert_all(YearlyStat, [row],
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: :coingecko_id
    )
  end

  defp load_stats(ids) do
    Repo.all(from y in YearlyStat, where: y.coingecko_id in ^ids)
    |> Map.new(fn y -> {y.coingecko_id, y} end)
  end

  # Hot (top-N by cap) must have vol_90d populated AND be within TTL.
  defp hot_stale?(nil, _now), do: true
  defp hot_stale?(%YearlyStat{vol_90d: nil}, _now), do: true
  defp hot_stale?(%YearlyStat{fetched_at: ts}, now), do: expired?(ts, now)

  # Cold: one-shot per cycle. If we tried and got nothing, that's fine —
  # don't retry until next 24h cycle.
  defp cold_stale?(nil, _now), do: true
  defp cold_stale?(%YearlyStat{fetched_at: ts}, now), do: expired?(ts, now)

  defp expired?(ts, now), do: DateTime.diff(now, ts, :millisecond) >= @yearly_ttl_ms

  defp next_delay(hot_ids) do
    now = DateTime.utc_now()
    refreshed = load_stats(hot_ids)

    still_empty =
      Enum.count(hot_ids, fn cid ->
        case Map.get(refreshed, cid) do
          nil -> true
          %YearlyStat{vol_90d: nil} -> true
          %YearlyStat{fetched_at: ts} -> expired?(ts, now)
        end
      end)

    if still_empty > 0 do
      Logger.info("YearlyPrefetcher: #{still_empty} top entries still empty, retrying in #{div(@hot_retry_ms, 60_000)}min")
      @hot_retry_ms
    else
      Logger.info("YearlyPrefetcher: cycle complete, sleeping 24h")
      @full_cycle_ms
    end
  end

  defp cfg, do: Application.fetch_env!(:crypto_portfolio_v3, :yearly_prefetcher)

  defp to_decimal(nil), do: nil
  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)
end
