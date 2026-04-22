defmodule CryptoPortfolioV3.Market.PctChangePrefetcher do
  @moduledoc """
  Supervised GenServer that keeps `cryptocompare_pct_changes` warm for the
  top-N coin symbols. Ported from `startBackgroundPrefetch` in TS, persisting
  to Postgres instead of a JSON file.
  """

  use GenServer
  require Logger
  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.Market.{CoinGecko, CryptoCompare, PctChange}

  @ttl_ms 24 * 60 * 60_000
  @full_cycle_ms 24 * 60 * 60_000
  @error_retry_ms 5 * 60_000
  @days_list [548]

  def start_link(_opts), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    cfg = cfg()
    Logger.info("PctChangePrefetcher: starting (top=#{cfg[:top_limit]}, first tick in #{cfg[:initial_delay_ms]}ms)")
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
          Logger.error("PctChangePrefetcher crashed: #{Exception.message(e)}")
          @error_retry_ms
      end

    schedule(next)
    {:noreply, state}
  end

  defp schedule(delay_ms), do: Process.send_after(self(), :tick, delay_ms)

  defp run_cycle do
    cfg = cfg()

    case CoinGecko.list_top(cfg[:top_limit]) do
      {:ok, raw} ->
        symbols =
          raw
          |> Enum.map(& &1["symbol"])
          |> Enum.reject(&is_nil/1)
          |> Enum.map(&String.upcase/1)
          |> Enum.uniq()

        process_symbols(symbols, cfg[:call_delay_ms])

      {:error, reason} ->
        Logger.warning("PctChangePrefetcher: list_top failed (#{inspect(reason)})")
        @error_retry_ms
    end
  end

  defp process_symbols(symbols, call_delay_ms) do
    now = DateTime.utc_now()
    existing = load_existing(symbols)

    stale =
      for sym <- symbols, days <- @days_list, stale?(Map.get(existing, {sym, days}), now), do: {sym, days}

    total_targets = length(symbols) * length(@days_list)

    if stale == [] do
      Logger.info("PctChangePrefetcher: cache warm (#{map_size(existing)} entries), sleeping 24h")
      @full_cycle_ms
    else
      Logger.info("PctChangePrefetcher: #{length(stale)} stale of #{total_targets} total")

      Enum.each(stale, fn {sym, days} ->
        pct = fetch_pct(sym, days)
        upsert(sym, days, pct, now)
        if call_delay_ms > 0, do: Process.sleep(call_delay_ms)
      end)

      Logger.info("PctChangePrefetcher: cycle complete, sleeping 24h")
      @full_cycle_ms
    end
  end

  defp fetch_pct(sym, days) do
    case CryptoCompare.histoday(sym, days) do
      {:ok, points} when length(points) >= 2 ->
        first = List.first(points)["close"]
        last = List.last(points)["close"]

        cond do
          is_number(first) and is_number(last) and first > 0 ->
            (last - first) / first * 100.0

          true ->
            nil
        end

      _ ->
        nil
    end
  end

  defp upsert(sym, days, pct, now) do
    row = %{
      symbol: String.upcase(sym),
      days: days,
      pct_change: to_decimal(pct),
      fetched_at: now,
      inserted_at: now,
      updated_at: now
    }

    Repo.insert_all(PctChange, [row],
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: [:symbol, :days]
    )
  end

  defp load_existing(symbols) do
    Repo.all(
      from p in PctChange,
        where: p.symbol in ^symbols and p.days in ^@days_list
    )
    |> Map.new(fn p -> {{p.symbol, p.days}, p} end)
  end

  defp stale?(nil, _now), do: true
  defp stale?(%PctChange{fetched_at: ts}, now),
    do: DateTime.diff(now, ts, :millisecond) >= @ttl_ms

  defp cfg, do: Application.fetch_env!(:crypto_portfolio_v3, :pct_change_prefetcher)

  defp to_decimal(nil), do: nil
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(Float.round(n, 4))
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(%Decimal{} = d), do: d
end
