defmodule CryptoPortfolioV3.Edgar do
  @moduledoc """
  SEC EDGAR client for monitoring 8-K filings on US-listed equities.

  Used to surface preemptive delisting / bankruptcy / financial-distress
  signals on the user's holdings. EDGAR is free and public — the only
  requirement from the SEC is a `User-Agent` header that identifies who
  you are. Rate limits are generous (~10 req/sec/IP).

  Two stages:

    1. Ticker → CIK lookup. Loaded once from the SEC's company-tickers
       file, cached in `:alpaca_cache` for 24h.
    2. Per-CIK filing fetch. We pull the company's recent submissions
       feed and scan 8-K rows for the items below.

  Items we treat as risk signals (each tagged with severity):

    * `1.03` — Bankruptcy or receivership (severe)
    * `2.04` — Triggering events that accelerate / increase debt (warn)
    * `3.01` — Notice of delisting / failure to satisfy listing rule (warn)
    * `4.02` — Non-reliance on prior financial statements (warn)

  Findings are filtered per-item with different lookback windows:
  bankruptcy/debt-default events expire in 90 days, delisting-warning and
  audit-issue events in 180, and acquisitions/changes-in-control stay
  flagged for 365 days (the delisting effect is permanent).
  """

  require Logger

  @type filing :: %{
          item: String.t(),
          severity: :severe | :warn | :info,
          form: String.t(),
          filed_at: String.t(),
          accession: String.t() | nil,
          url: String.t() | nil,
          label: String.t()
        }

  @type result :: {:ok, %{required(String.t()) => [filing()] | nil}}

  @ticker_cache_key :edgar_ticker_to_cik
  @ticker_ttl_ms 24 * 60 * 60 * 1000
  @filings_ttl_ms 6 * 60 * 60 * 1000

  # Per-item watch list. Each entry is `{severity, label, lookback_days}`.
  # Lookback varies by event type:
  #   * bankruptcy / debt default — 90 days (situation resolves quickly)
  #   * delisting warning / audit issue — 180 days (cure periods are 6mo+)
  #   * change-in-control (acquired) — 365 days (the delisting effect is
  #     permanent; a take-private deal that closed last year is still the
  #     reason a holder shouldn't be adding to that position)
  #
  # Item 5.01 (Changes in Control of Registrant) = the entity is being
  # acquired / taken private — different cause, same delisting outcome.
  # Marked :info because the holder typically gets cashed out (often at a
  # premium), so this is informational rather than a warning.
  # 3.01 entry is a placeholder — `disambiguate_3_01/3` rewrites severity
  # and label by reading the filing body, since item 3.01 covers three
  # very different scenarios (forced delist / rule failure / voluntary
  # transfer between exchanges).
  @item_labels %{
    "1.03" => {:severe, "Bankruptcy", 90},
    "2.04" => {:warn, "Debt Default", 90},
    "3.01" => {:warn, "Delisting Warning", 180},
    "4.02" => {:warn, "Audit Issue", 180},
    "5.01" => {:info, "Acquired", 365}
  }

  @max_lookback_days 365

  @user_agent "CryptoPortfolioV3 hotheadheather@gmail.com"
  @data_base "https://data.sec.gov"
  @www_base "https://www.sec.gov"

  @doc """
  Returns risk findings keyed by ticker. For each requested symbol the
  value is either a list of `filing/0` maps (most recent first) or `nil`
  if no qualifying filings were found within their per-item lookback
  windows. Symbols whose ticker isn't in the SEC universe (foreign-only
  ADRs, OTC pinks, fictional ETF tickers, crypto pairs) silently map to
  `nil`.
  """
  @spec risk([binary()]) :: result()
  def risk(symbols) when is_list(symbols) do
    syms = symbols |> Enum.map(&String.upcase/1) |> Enum.uniq()

    case ticker_to_cik() do
      {:ok, map} ->
        results =
          syms
          |> Enum.map(fn sym -> {sym, fetch_findings(sym, Map.get(map, sym))} end)
          |> Map.new()

        {:ok, results}

      {:error, _} = err ->
        err
    end
  end

  def risk(_), do: {:ok, %{}}

  # ── Internals ───────────────────────────────────────────────────────────

  defp fetch_findings(_sym, nil), do: nil

  defp fetch_findings(sym, cik_padded) do
    # Versioned cache key — bump suffix when the watch-item set changes so
    # previously-cleared symbols get re-evaluated.
    cache_key = {:edgar_findings_v4, sym}

    case Cachex.get(:alpaca_cache, cache_key) do
      {:ok, value} when not is_nil(value) ->
        # nil-cached negatives are surfaced as nil to the caller.
        if value == :none, do: nil, else: value

      _ ->
        findings =
          case fetch_submissions(cik_padded) do
            {:ok, body} ->
              extract_findings(body)

            {:error, _} ->
              nil
          end

        ttl = @filings_ttl_ms
        Cachex.put(:alpaca_cache, cache_key, findings || :none, ttl: ttl)
        findings
    end
  end

  defp fetch_submissions(cik_padded) do
    url = "/submissions/CIK#{cik_padded}.json"
    edgar_get(@data_base, url)
  end

  defp extract_findings(body) do
    recent = get_in(body, ["filings", "recent"]) || %{}
    forms = recent["form"] || []
    items_list = recent["items"] || []
    dates = recent["filingDate"] || []
    accessions = recent["accessionNumber"] || []
    primary_docs = recent["primaryDocument"] || []
    cik = body["cik"]

    today = Date.utc_today()
    # Coarse pre-filter — anything older than the longest watched window
    # can't qualify for any item, so we skip the per-item check entirely.
    outer_cutoff = Date.add(today, -@max_lookback_days)

    findings =
      forms
      |> Enum.with_index()
      |> Enum.flat_map(fn {form, idx} ->
        if form == "8-K" do
          items_str = Enum.at(items_list, idx, "") || ""
          filed_str = Enum.at(dates, idx, "") || ""
          accession = Enum.at(accessions, idx, "") || ""
          primary = Enum.at(primary_docs, idx, "") || ""

          case parse_date(filed_str) do
            {:ok, filed_d} ->
              if Date.compare(filed_d, outer_cutoff) != :lt do
                items_str
                |> String.split(~r/[,\s]+/, trim: true)
                |> Enum.flat_map(fn item ->
                  case Map.get(@item_labels, item) do
                    {sev, label, lookback} ->
                      item_cutoff = Date.add(today, -lookback)

                      if Date.compare(filed_d, item_cutoff) != :lt do
                        url = filing_url(cik, accession, primary)
                        # Item 3.01 is overloaded — fetch the filing body
                        # and rewrite severity/label based on what kind
                        # of listing event it actually is.
                        {sev, label} =
                          if item == "3.01", do: disambiguate_3_01(url, sev, label), else: {sev, label}

                        [
                          %{
                            item: item,
                            severity: sev,
                            form: "8-K",
                            filed_at: filed_str,
                            accession: accession,
                            url: url,
                            label: label
                          }
                        ]
                      else
                        []
                      end

                    _ ->
                      []
                  end
                end)
              else
                []
              end

            _ ->
              []
          end
        else
          []
        end
      end)

    case findings do
      [] -> nil
      list -> list |> Enum.sort_by(& &1.filed_at, :desc)
    end
  end

  # Item 3.01 covers three different scenarios — forced delisting (bad),
  # listing-rule deficiency notice (bad), or voluntary listing transfer
  # between exchanges (benign). Read the filing body and re-classify.
  # Returns `{severity, label}`. Cached per-URL since 8-K bodies never
  # change after filing.
  defp disambiguate_3_01(nil, sev, label), do: {sev, label}

  defp disambiguate_3_01(url, default_sev, default_label) do
    cache_key = {:edgar_3_01_class, url}

    case Cachex.get(:alpaca_cache, cache_key) do
      {:ok, {sev, label}} when not is_nil(sev) ->
        {sev, label}

      _ ->
        result =
          case fetch_filing_body(url) do
            {:ok, text} -> classify_3_01_text(text, default_sev, default_label)
            _ -> {default_sev, default_label}
          end

        # Long TTL — filings are immutable.
        Cachex.put(:alpaca_cache, cache_key, result, ttl: 30 * 24 * 60 * 60 * 1000)
        result
    end
  end

  # Heuristic: voluntary transfer to another exchange → :info "Listing Transfer";
  # listing-rule deficiency or notice → :warn "Listing Deficiency";
  # otherwise fall back to the default ":warn Delisting Warning".
  defp classify_3_01_text(text, default_sev, default_label) do
    lower = String.downcase(text)

    cond do
      String.contains?(lower, "voluntar") and
        (String.contains?(lower, "transfer") or String.contains?(lower, "withdraw")) and
        (String.contains?(lower, "nasdaq") or String.contains?(lower, "nyse") or
           String.contains?(lower, "stock exchange")) ->
        {:info, "Listing Transfer"}

      String.contains?(lower, "deficien") or
        String.contains?(lower, "minimum bid price") or
        String.contains?(lower, "fail to satisf") or
        String.contains?(lower, "non-compliance") or
        String.contains?(lower, "noncompliance") ->
        {:warn, "Listing Deficiency"}

      true ->
        {default_sev, default_label}
    end
  end

  defp fetch_filing_body(url) do
    req =
      Req.new(
        receive_timeout: 10_000,
        headers: [
          {"User-Agent", @user_agent},
          {"accept", "text/html,application/xhtml+xml,*/*"}
        ],
        retry: :transient,
        max_retries: 1
      )

    case Req.request(req, method: :get, url: url) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        text = body |> to_string() |> strip_html()
        {:ok, text}

      {:ok, %Req.Response{status: status}} ->
        {:error, {:http, status}}

      {:error, e} ->
        {:error, e}
    end
  end

  defp strip_html(html) do
    html
    |> String.replace(~r/<[^>]+>/, " ")
    |> String.replace(~r/\s+/, " ")
  end

  defp parse_date(s) when is_binary(s) do
    case Date.from_iso8601(s) do
      {:ok, _} = ok -> ok
      _ -> :error
    end
  end

  defp parse_date(_), do: :error

  defp filing_url(_cik, "", _), do: nil
  defp filing_url(nil, _, _), do: nil

  defp filing_url(cik, accession, primary) do
    cik_int = if is_integer(cik), do: cik, else: cik |> String.trim_leading("0") |> String.to_integer()
    bare = String.replace(accession, "-", "")
    primary = if primary in [nil, ""], do: "", else: "/" <> primary
    "#{@www_base}/Archives/edgar/data/#{cik_int}/#{bare}#{primary}"
  end

  # Ticker → padded-CIK map. SEC publishes a single JSON listing. Cached
  # 24h since the universe doesn't change often. Returns `{:ok, map}` or
  # `{:error, reason}`.
  defp ticker_to_cik do
    case Cachex.get(:alpaca_cache, @ticker_cache_key) do
      {:ok, %{} = map} ->
        {:ok, map}

      _ ->
        case edgar_get(@www_base, "/files/company_tickers.json") do
          {:ok, body} when is_map(body) ->
            map =
              body
              |> Map.values()
              |> Enum.reduce(%{}, fn entry, acc ->
                ticker = entry["ticker"] |> to_string() |> String.upcase()
                cik = entry["cik_str"] |> to_string() |> String.pad_leading(10, "0")
                Map.put(acc, ticker, cik)
              end)

            Cachex.put(:alpaca_cache, @ticker_cache_key, map, ttl: @ticker_ttl_ms)
            {:ok, map}

          other ->
            Logger.warning("Edgar ticker map fetch failed: #{inspect(other)}")
            {:error, :ticker_map_unavailable}
        end
    end
  end

  defp edgar_get(base, path) do
    req =
      Req.new(
        base_url: base,
        receive_timeout: 10_000,
        headers: [
          {"User-Agent", @user_agent},
          {"accept", "application/json"}
        ],
        retry: :transient,
        max_retries: 1
      )

    case Req.request(req, method: :get, url: path) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.warning("Edgar GET #{path} returned #{status}: #{inspect(body)}")
        {:error, {:http, status}}

      {:error, e} ->
        Logger.warning("Edgar GET #{path} error: #{Exception.message(e)}")
        {:error, e}
    end
  end
end
