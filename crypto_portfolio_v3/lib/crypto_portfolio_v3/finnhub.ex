defmodule CryptoPortfolioV3.Finnhub do
  @moduledoc """
  HTTP client for Finnhub's company-news endpoint. Used alongside
  Alpaca's news feed (which on the free tier is mostly Benzinga) to
  diversify the news panel with Reuters, MarketWatch, Yahoo Finance,
  SeekingAlpha, CNBC and others that Finnhub aggregates.

  Auth: single `FINNHUB_API_KEY` env var; if unset, every call returns
  `{:error, :missing_credentials}` and the news aggregator
  (`CryptoPortfolioV3.News`) falls back to Alpaca-only.

  Free tier limits: ~60 requests/minute. The `News` aggregator caches
  per-symbol so rapid UI toggling doesn't burn through the quota.
  """

  require Logger

  @default_base_url "https://finnhub.io/api/v1"
  @timeout_ms 10_000
  @lookback_days 7

  @doc "True when FINNHUB_API_KEY is set."
  def configured? do
    case api_key() do
      key when is_binary(key) and key != "" -> true
      _ -> false
    end
  end

  @doc """
  Basic company profile — `/stock/profile2` (free tier). Returns:

      %{"country", "currency", "exchange", "ipo" (YYYY-MM-DD),
        "marketCapitalization", "name", "phone", "shareOutstanding",
        "ticker", "weburl", "logo", "finnhubIndustry"}

  Employee count + HQ address require the premium `/stock/profile`
  endpoint; the controller fills those slots with `nil` and the frontend
  renders "Not disclosed" rather than blocking the whole card.
  """
  def company_profile(symbol) when is_binary(symbol) do
    if configured?() do
      params = [symbol: String.upcase(symbol), token: api_key()]

      case Req.get(base_url() <> "/stock/profile2",
             params: params,
             receive_timeout: @timeout_ms,
             retry: :transient,
             max_retries: 2
           ) do
        # Empty {} = symbol unknown on the free tier. Treat as not-found
        # rather than an error so the frontend can show a clean empty state.
        {:ok, %Req.Response{status: 200, body: body}} when map_size(body) == 0 ->
          {:ok, nil}

        {:ok, %Req.Response{status: 200, body: body}} when is_map(body) ->
          {:ok, body}

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.warning("Finnhub /stock/profile2 -> #{status}: #{inspect(body)}")
          {:error, {:http, status, body}}

        {:error, e} ->
          {:error, e}
      end
    else
      {:error, :missing_credentials}
    end
  end

  @doc """
  Recent news for `symbol` from the last #{@lookback_days} days. Returns
  Finnhub's raw article list — `CryptoPortfolioV3.News` normalizes the
  shape into the unified format the frontend expects.
  """
  def company_news(symbol) when is_binary(symbol) do
    if configured?() do
      today = Date.utc_today()
      from_date = Date.add(today, -@lookback_days)

      params = [
        symbol: String.upcase(symbol),
        from: Date.to_iso8601(from_date),
        to: Date.to_iso8601(today),
        token: api_key()
      ]

      case Req.get(base_url() <> "/company-news",
             params: params,
             receive_timeout: @timeout_ms,
             retry: :transient,
             max_retries: 2
           ) do
        {:ok, %Req.Response{status: 200, body: body}} when is_list(body) ->
          {:ok, body}

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.warning("Finnhub /company-news -> #{status}: #{inspect(body)}")
          {:error, {:http, status, body}}

        {:error, e} ->
          Logger.warning("Finnhub /company-news request error: #{inspect(e)}")
          {:error, e}
      end
    else
      {:error, :missing_credentials}
    end
  end

  defp api_key, do: cfg()[:api_key]
  defp base_url, do: cfg()[:base_url] || @default_base_url
  defp cfg, do: Application.get_env(:crypto_portfolio_v3, :finnhub, [])
end
