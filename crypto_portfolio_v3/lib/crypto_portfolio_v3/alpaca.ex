defmodule CryptoPortfolioV3.Alpaca do
  @moduledoc """
  HTTP client for Alpaca's broker-style trading API.

  Two base URLs:

    * trading_url — account, positions, orders. Defaults to paper
      (`paper-api.alpaca.markets`). Live trading uses `api.alpaca.markets`
      and is gated behind explicit env-var override.
    * data_url — market data (quotes, bars). Always
      `data.alpaca.markets`; same for paper and live.

  Auth is two HTTP headers — `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY`.
  Credentials are read from env vars `ALPACA_API_KEY` and `ALPACA_API_SECRET`
  via `runtime.exs`. If either is unset, every public function returns
  `{:error, :missing_credentials}` so the caller can render a clear error.
  """

  require Logger

  @type result :: {:ok, map() | list()} | {:error, term()}

  # Cache TTLs. Snapshots are live prices, so a short window keeps tab
  # toggles cheap without showing stale numbers. Dividends and trailing
  # 4-yr changes only update once a day (after market close), so a
  # 24-hour TTL is fine.
  @snapshot_ttl_ms 60_000
  @dividend_ttl_ms 24 * 60 * 60 * 1000
  # Charts and the matched-window arrow comparison both pull historical
  # daily bars. The data only changes once a day after market close, but
  # missing a single day's close on a 48-month chart is visually invisible
  # and doesn't flip arrow direction — so refresh weekly to dramatically
  # reduce Alpaca load. The live "where is it trading right now" signal
  # comes from snapshots, not from this cache.
  @chart_bars_ttl_ms 7 * 24 * 60 * 60 * 1000
  @change_ttl_ms 7 * 24 * 60 * 60 * 1000

  # ── Public API ──────────────────────────────────────────────────────────

  @doc "Account snapshot — cash, equity, buying power, etc."
  @spec account() :: result()
  def account, do: get(:trading, "/v2/account")

  @doc "Open positions across all symbols."
  @spec positions() :: result()
  def positions, do: get(:trading, "/v2/positions")

  @doc "Most recent quote for a stock symbol (NBBO)."
  @spec latest_quote(binary()) :: result()
  def latest_quote(symbol) when is_binary(symbol) do
    get(:data, "/v2/stocks/#{URI.encode(symbol)}/quotes/latest")
  end

  @doc """
  Daily OHLC bars for a symbol over the trailing N days. Returns a list of
  `%{t, c}` (timestamp + close) sorted oldest-to-newest. Auto-routes by
  symbol — alphabetic → stock endpoint, ends-in-USD+long → crypto endpoint.
  """
  @spec daily_bars(binary(), pos_integer()) :: result()
  def daily_bars(symbol, days) when is_binary(symbol) and is_integer(days) do
    cache_key = {:chart_bars, symbol, days}

    case Cachex.get(:alpaca_cache, cache_key) do
      {:ok, value} when not is_nil(value) ->
        {:ok, value}

      _ ->
        end_date = Date.utc_today()
        start_date = Date.add(end_date, -days)

        result =
          if crypto_symbol?(symbol) do
            fetch_crypto_bars(symbol, start_date, end_date)
          else
            fetch_stock_bars(symbol, start_date, end_date)
          end

        case result do
          {:ok, bars} ->
            Cachex.put(:alpaca_cache, cache_key, bars, ttl: @chart_bars_ttl_ms)
            {:ok, bars}

          other ->
            other
        end
    end
  end

  defp fetch_stock_bars(symbol, start_date, end_date) do
    # feed=iex uses the IEX exchange feed (free tier). Default is SIP which
    # requires a paid subscription and 403s on Basic accounts.
    params = [
      start: Date.to_iso8601(start_date),
      "end": Date.to_iso8601(end_date),
      timeframe: "1Day",
      limit: 1000,
      adjustment: "split",
      feed: "iex"
    ]

    case get(:data, "/v2/stocks/#{URI.encode(symbol)}/bars", params: params) do
      {:ok, %{"bars" => bars}} when is_list(bars) ->
        {:ok, Enum.map(bars, fn b -> %{t: b["t"], c: b["c"]} end)}

      {:ok, _} ->
        {:ok, []}

      other ->
        other
    end
  end

  defp fetch_crypto_bars(symbol, start_date, end_date) do
    pair = to_crypto_pair(symbol)

    params = [
      symbols: pair,
      start: Date.to_iso8601(start_date),
      "end": Date.to_iso8601(end_date),
      timeframe: "1Day",
      limit: 1000
    ]

    case get(:data, "/v1beta3/crypto/us/bars", params: params) do
      {:ok, %{"bars" => bars}} when is_map(bars) ->
        list = Map.get(bars, pair, [])
        {:ok, Enum.map(list, fn b -> %{t: b["t"], c: b["c"]} end)}

      other ->
        other
    end
  end

  @doc """
  Compute matched-window total return for stock vs. its category benchmark.
  Each pair is `{stock_symbol, benchmark_symbol}` (benchmark may be nil).

  Returns a map keyed by the stock symbol with `%{stock_pct, bench_pct,
  days}` per entry — both percentages measured over the same window
  (anchored to the stock's first available bar in the requested span).
  Lets newly-IPO'd names (RIVN, LCID, etc.) compare fairly against their
  benchmark over their actual trading history rather than 4 fixed years.

  `days` is a max history cap; if the stock has less, the comparison
  shrinks to whatever history exists. `days` field on the result is the
  number of trading days actually used.
  """
  @spec bars_changes([{binary(), binary() | nil}], pos_integer()) :: result()
  def bars_changes(pairs, days) when is_list(pairs) and is_integer(days) do
    unique_syms =
      pairs
      |> Enum.flat_map(fn
        {s, nil} -> [s]
        {s, b} -> [s, b]
      end)
      |> Enum.uniq()

    with {:ok, bars_map} <- bars_for(unique_syms, days) do
      {:ok,
       Map.new(pairs, fn {stock, bench} ->
         {stock, compare_bars(bars_map[stock], bars_map[bench])}
       end)}
    end
  end

  defp bars_for(symbols, days) do
    with_cache({:bars, days}, symbols, @change_ttl_ms, fn misses ->
      end_date = Date.utc_today()
      start_date = Date.add(end_date, -days)

      {crypto_syms, stock_syms} = Enum.split_with(misses, &crypto_symbol?/1)

      with {:ok, stock_map} <- batch_stock_bars(stock_syms, start_date, end_date),
           {:ok, crypto_map} <- batch_crypto_bars(crypto_syms, start_date, end_date) do
        {:ok, Map.merge(stock_map, crypto_map)}
      end
    end)
  end

  defp compare_bars(nil, _), do: nil
  defp compare_bars([], _), do: nil

  defp compare_bars(stock_bars, bench_bars) when is_list(stock_bars) do
    stock_first_t = List.first(stock_bars)["t"]
    stock_first_c = List.first(stock_bars)["c"]
    stock_last_c = List.last(stock_bars)["c"]
    stock_pct = pct(stock_first_c, stock_last_c)

    bench_pct =
      case bench_bars do
        list when is_list(list) and list != [] ->
          # Anchor benchmark to the first bar at or after the stock's first
          # date — matches windows for IPO'd-recently names.
          aligned = Enum.find(list, fn b -> b["t"] >= stock_first_t end)

          if aligned do
            pct(aligned["c"], List.last(list)["c"])
          end

        _ ->
          nil
      end

    %{
      stock_pct: stock_pct,
      bench_pct: bench_pct,
      days: length(stock_bars)
    }
  end

  defp pct(first, last)
       when is_number(first) and is_number(last) and first > 0,
       do: (last - first) / first * 100

  defp pct(_, _), do: nil

  defp batch_stock_bars([], _, _), do: {:ok, %{}}

  defp batch_stock_bars(symbols, start_date, end_date) do
    # Chunk by 10 — with limit=10000 and ~1000 bars/sym/4yr, ten symbols fit
    # comfortably in one Alpaca page. Avoids pagination handling for the
    # common case.
    symbols
    |> Enum.chunk_every(10)
    |> Enum.reduce_while({:ok, %{}}, fn chunk, {:ok, acc} ->
      params = [
        symbols: Enum.join(chunk, ","),
        start: Date.to_iso8601(start_date),
        "end": Date.to_iso8601(end_date),
        timeframe: "1Day",
        limit: 10_000,
        adjustment: "split",
        feed: "iex"
      ]

      case get(:data, "/v2/stocks/bars", params: params) do
        {:ok, %{"bars" => bars}} when is_map(bars) ->
          {:cont, {:ok, Map.merge(acc, bars)}}

        {:ok, _} ->
          {:cont, {:ok, acc}}

        other ->
          {:halt, other}
      end
    end)
  end

  defp batch_crypto_bars([], _, _), do: {:ok, %{}}

  defp batch_crypto_bars(symbols, start_date, end_date) do
    pairs = symbols |> Enum.map(&to_crypto_pair/1) |> Enum.join(",")

    params = [
      symbols: pairs,
      start: Date.to_iso8601(start_date),
      "end": Date.to_iso8601(end_date),
      timeframe: "1Day",
      limit: 10_000
    ]

    case get(:data, "/v1beta3/crypto/us/bars", params: params) do
      {:ok, %{"bars" => bars}} when is_map(bars) ->
        {:ok,
         Map.new(bars, fn {pair, list} ->
           {String.replace(pair, "/", ""), list}
         end)}

      other ->
        other
    end
  end

  @doc """
  Batch snapshot fetch for stocks and crypto. `symbols` is a list of strings
  like `["AAPL", "MSFT", "BTCUSD"]`. Crypto symbols are detected by ending
  in `USD` and length > 3, then converted to Alpaca's `BTC/USD` pair format
  for the crypto data endpoint. Returns a map keyed by the original symbol
  string with `%{price, change_pct}` per entry. Symbols Alpaca doesn't know
  about silently drop out.
  """
  @spec snapshots([binary()]) :: result()
  def snapshots(symbols) when is_list(symbols) do
    with_cache(:snapshot, symbols, @snapshot_ttl_ms, fn misses ->
      {crypto_syms, stock_syms} = Enum.split_with(misses, &crypto_symbol?/1)

      with {:ok, stock_map} <- fetch_stock_snapshots(stock_syms),
           {:ok, crypto_map} <- fetch_crypto_snapshots(crypto_syms) do
        {:ok, Map.merge(stock_map, crypto_map)}
      end
    end)
  end

  defp crypto_symbol?(sym) do
    String.ends_with?(sym, "USD") and byte_size(sym) > 3
  end

  defp fetch_stock_snapshots([]), do: {:ok, %{}}

  defp fetch_stock_snapshots(syms) do
    # Chunk into batches — Alpaca's snapshots endpoint has an undocumented
    # cap and silently drops symbols past it. 50 is conservative.
    syms
    |> Enum.chunk_every(50)
    |> Enum.reduce_while({:ok, %{}}, fn chunk, {:ok, acc} ->
      csv = Enum.join(chunk, ",")

      case get(:data, "/v2/stocks/snapshots", params: [symbols: csv]) do
        {:ok, body} when is_map(body) ->
          merged = Map.merge(acc, Map.new(body, fn {sym, snap} -> {sym, normalize_snapshot(snap)} end))
          {:cont, {:ok, merged}}

        other ->
          {:halt, other}
      end
    end)
  end

  defp fetch_crypto_snapshots([]), do: {:ok, %{}}

  defp fetch_crypto_snapshots(syms) do
    pairs = syms |> Enum.map(&to_crypto_pair/1) |> Enum.join(",")

    case get(:data, "/v1beta3/crypto/us/snapshots", params: [symbols: pairs]) do
      {:ok, %{"snapshots" => body}} when is_map(body) ->
        {:ok,
         Map.new(body, fn {pair, snap} ->
           {String.replace(pair, "/", ""), normalize_snapshot(snap)}
         end)}

      {:ok, body} when is_map(body) ->
        {:ok,
         Map.new(body, fn {pair, snap} ->
           {String.replace(pair, "/", ""), normalize_snapshot(snap)}
         end)}

      other ->
        other
    end
  end

  defp to_crypto_pair(s) do
    if String.ends_with?(s, "USD"),
      do: "#{String.slice(s, 0..-4//1)}/USD",
      else: s
  end

  defp normalize_snapshot(snap) when is_map(snap) do
    price = get_in(snap, ["latestTrade", "p"]) || get_in(snap, ["dailyBar", "c"])
    prev = get_in(snap, ["prevDailyBar", "c"])

    change_pct =
      cond do
        is_number(price) and is_number(prev) and prev > 0 ->
          (price - prev) / prev * 100

        true ->
          nil
      end

    %{price: price, change_pct: change_pct}
  end

  defp normalize_snapshot(_), do: %{price: nil, change_pct: nil}

  @doc """
  Trailing 12-month cash dividends per symbol. Returns a map keyed by symbol
  with `%{annual_rate, latest_rate, latest_ex_date, payment_count}` — the
  sum of cash dividend payments in the last 365 days, the most recent
  payment's per-share rate, that payment's ex-dividend date, and how many
  payments were counted.

  Symbols that paid no dividends in the window get `%{annual_rate: 0,
  payment_count: 0, latest_rate: nil, latest_ex_date: nil}`.
  """
  @spec cash_dividends([binary()]) :: result()
  def cash_dividends(symbols) when is_list(symbols) and symbols != [] do
    with_cache(:dividend, symbols, @dividend_ttl_ms, fn misses ->
      fetch_dividends_uncached(misses)
    end)
  end

  defp fetch_dividends_uncached(symbols) do
    today = Date.utc_today()
    start_date = Date.add(today, -370)

    # Chunk symbols by 50 — `/v1/corporate-actions` returns all events for
    # all symbols in one paginated response. With many monthly-payer
    # symbols × 12 months, the cumulative event count (~12 events/sym) can
    # exceed the response cap and the alphabetically-later symbols silently
    # drop. Smaller chunks keep each call's event count safely under
    # `limit: 1000`.
    symbols
    |> Enum.chunk_every(50)
    |> Enum.reduce_while({:ok, %{}}, fn chunk, {:ok, acc} ->
      params = [
        symbols: Enum.join(chunk, ","),
        types: "cash_dividend",
        start: Date.to_iso8601(start_date),
        end: Date.to_iso8601(today),
        limit: 1000
      ]

      case get(:data, "/v1/corporate-actions", params: params) do
        {:ok, %{"corporate_actions" => %{"cash_dividends" => events}}} when is_list(events) ->
          {:cont, {:ok, Map.merge(acc, summarize_dividends(events, chunk))}}

        {:ok, _} ->
          {:cont, {:ok, Map.merge(acc, Map.new(chunk, &{&1, empty_dividend_summary()}))}}

        other ->
          {:halt, other}
      end
    end)
  end

  def cash_dividends(_), do: {:ok, %{}}

  defp summarize_dividends(events, symbols) do
    grouped = Enum.group_by(events, & &1["symbol"])

    Map.new(symbols, fn sym ->
      case grouped[sym] do
        nil -> {sym, empty_dividend_summary()}
        entries -> {sym, summary_for(entries)}
      end
    end)
  end

  defp summary_for(entries) do
    rates =
      Enum.map(entries, fn e ->
        case e["rate"] do
          v when is_number(v) -> v
          v when is_binary(v) -> case Float.parse(v), do: ({n, _} -> n; :error -> 0)
          _ -> 0
        end
      end)

    sorted = Enum.sort_by(entries, & &1["ex_date"], :desc)
    latest = List.first(sorted) || %{}

    %{
      annual_rate: Enum.sum(rates),
      latest_rate: latest["rate"],
      latest_ex_date: latest["ex_date"],
      payment_count: length(rates)
    }
  end

  defp empty_dividend_summary do
    %{annual_rate: 0, latest_rate: nil, latest_ex_date: nil, payment_count: 0}
  end

  @doc "List orders. Pass keyword opts that map to Alpaca's query params (e.g. status: :open, limit: 50)."
  @spec list_orders(keyword()) :: result()
  def list_orders(opts \\ []), do: get(:trading, "/v2/orders", params: opts)

  @doc """
  Place an order. `params` is a map matching Alpaca's POST /v2/orders body —
  at minimum `symbol`, `qty` (or `notional`), `side`, `type`, and `time_in_force`.
  """
  @spec place_order(map()) :: result()
  def place_order(params) when is_map(params), do: post(:trading, "/v2/orders", params)

  @doc "Cancel an open order by ID."
  @spec cancel_order(binary()) :: result()
  def cancel_order(id) when is_binary(id), do: delete(:trading, "/v2/orders/#{id}")

  @doc """
  Asset metadata for a list of symbols — used to detect delisted/non-tradable
  tickers (a proxy for liquidation/bankruptcy). Returns a map keyed by symbol
  with `%{status, tradable, marginable, shortable}`. Symbols Alpaca doesn't
  recognize map to `nil`. Cached per-symbol for 6h since this metadata
  changes rarely.
  """
  @spec assets([binary()]) :: result()
  def assets(symbols) when is_list(symbols) and symbols != [] do
    syms = symbols |> Enum.map(&String.upcase/1) |> Enum.uniq()

    with_cache(:asset_status, syms, 6 * 60 * 60 * 1000, fn misses ->
      results =
        Enum.reduce(misses, %{}, fn sym, acc ->
          case get(:trading, "/v2/assets/#{URI.encode(sym)}") do
            {:ok, %{} = a} ->
              Map.put(acc, sym, %{
                status: a["status"],
                tradable: a["tradable"],
                marginable: a["marginable"],
                shortable: a["shortable"]
              })

            _ ->
              Map.put(acc, sym, nil)
          end
        end)

      {:ok, results}
    end)
  end

  def assets(_), do: {:ok, %{}}

  @doc """
  Sum of cash dividends paid into the account in the trailing 365 days.
  Pulls Alpaca's account activities filtered to `DIV` (cash dividend)
  entries since the cutoff and aggregates `net_amount`. Returns
  `%{total_paid, count}`.
  """
  @spec dividend_activities() :: result()
  def dividend_activities do
    cutoff = Date.utc_today() |> Date.add(-365) |> Date.to_iso8601()

    case get(:trading, "/v2/account/activities/DIV",
           params: [page_size: 100, after: cutoff]
         ) do
      {:ok, list} when is_list(list) ->
        total =
          Enum.reduce(list, 0.0, fn a, acc ->
            case a["net_amount"] do
              v when is_number(v) -> acc + v
              v when is_binary(v) -> case Float.parse(v), do: ({n, _} -> acc + n; :error -> acc)
              _ -> acc
            end
          end)

        {:ok, %{total_paid: total, count: length(list)}}

      other ->
        other
    end
  end

  # ── Internals ───────────────────────────────────────────────────────────

  # Per-symbol cache wrapper. `tag` namespaces cache keys (e.g. `:snapshot`,
  # `:dividend`, `{:change, days}`); `fetcher` is invoked only with the
  # cache-miss subset and must return `{:ok, map}` keyed by symbol.
  # Symbols absent from the fetcher's response (e.g. unknown ADRs) are
  # cached as `nil` to prevent retry storms across calls.
  defp with_cache(tag, symbols, ttl_ms, fetcher) when is_function(fetcher, 1) do
    {hits, misses} =
      Enum.reduce(symbols, {%{}, []}, fn sym, {hit_acc, miss_acc} ->
        case Cachex.get(:alpaca_cache, {tag, sym}) do
          {:ok, nil} -> {hit_acc, [sym | miss_acc]}
          {:ok, value} -> {Map.put(hit_acc, sym, value), miss_acc}
          _ -> {hit_acc, [sym | miss_acc]}
        end
      end)

    if misses == [] do
      {:ok, hits}
    else
      case fetcher.(misses) do
        {:ok, fresh} when is_map(fresh) ->
          for sym <- misses do
            Cachex.put(:alpaca_cache, {tag, sym}, Map.get(fresh, sym), ttl: ttl_ms)
          end

          {:ok, Map.merge(hits, fresh)}

        other ->
          other
      end
    end
  end

  defp get(env, path, opts \\ []), do: request(:get, env, path, opts)
  defp post(env, path, body), do: request(:post, env, path, json: body)
  defp delete(env, path), do: request(:delete, env, path, [])

  defp request(method, env, path, opts) do
    cfg = Application.fetch_env!(:crypto_portfolio_v3, :alpaca)

    cond do
      cfg[:api_key] in [nil, ""] -> {:error, :missing_credentials}
      cfg[:api_secret] in [nil, ""] -> {:error, :missing_credentials}
      true -> do_request(method, env, path, opts, cfg)
    end
  end

  defp do_request(method, env, path, opts, cfg) do
    base = if env == :data, do: cfg[:data_url], else: cfg[:trading_url]

    req =
      Req.new(
        base_url: base,
        receive_timeout: cfg[:timeout_ms],
        headers: [
          {"APCA-API-KEY-ID", cfg[:api_key]},
          {"APCA-API-SECRET-KEY", cfg[:api_secret]},
          {"accept", "application/json"}
        ],
        retry: :transient,
        max_retries: 2
      )

    req_opts = [method: method, url: path] ++ opts

    case Req.request(req, req_opts) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.warning("Alpaca #{method} #{path} returned #{status}: #{inspect(body)}")
        {:error, {:http, status, body}}

      {:error, e} ->
        Logger.warning("Alpaca #{method} #{path} error: #{Exception.message(e)}")
        {:error, e}
    end
  end
end
