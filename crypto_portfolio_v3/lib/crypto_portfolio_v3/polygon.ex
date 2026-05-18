defmodule CryptoPortfolioV3.Polygon do
  @moduledoc """
  HTTP client for Polygon.io's reference API. Used as the primary source
  for the company-profile card because the free tier exposes the fields
  Finnhub gates behind a paid plan:

    * `address.city` / `address.state` (HQ location)
    * `total_employees`
    * `sic_description` (what the company produces)
    * `list_date` + `description`

  Free tier: ~5 requests/minute. The CompanyProfile aggregator caches
  per-symbol for 24h, so a few cold misses on launch are the only time
  we'd brush against that ceiling under normal use.

  If `POLYGON_API_KEY` is unset, every call returns
  `{:error, :missing_credentials}` and the aggregator falls back to
  Finnhub's free profile2 (no city / employee count, but better than
  nothing).
  """

  require Logger

  @default_base_url "https://api.polygon.io"
  @timeout_ms 10_000

  def configured? do
    case api_key() do
      key when is_binary(key) and key != "" -> true
      _ -> false
    end
  end

  @doc "Returns Polygon's raw `results` map, or `{:ok, nil}` when ticker unknown."
  def company_profile(symbol) when is_binary(symbol) do
    if configured?() do
      sym = String.upcase(symbol)
      url = base_url() <> "/v3/reference/tickers/" <> URI.encode(sym)

      case Req.get(url,
             params: [apiKey: api_key()],
             receive_timeout: @timeout_ms,
             retry: :transient,
             max_retries: 2
           ) do
        {:ok, %Req.Response{status: 200, body: %{"results" => results}}}
        when is_map(results) ->
          {:ok, results}

        # 404 on a real ticker means Polygon hasn't onboarded it (rare).
        # 404 is also what they return for malformed symbols. Either way
        # surface as not-found so the aggregator can fall back.
        {:ok, %Req.Response{status: 404}} ->
          {:ok, nil}

        {:ok, %Req.Response{status: 429, body: body}} ->
          Logger.warning("Polygon rate-limited: #{inspect(body)}")
          {:error, {:http, 429, body}}

        {:ok, %Req.Response{status: status, body: body}} ->
          Logger.warning("Polygon /tickers -> #{status}: #{inspect(body)}")
          {:error, {:http, status, body}}

        {:error, e} ->
          Logger.warning("Polygon /tickers request error: #{inspect(e)}")
          {:error, e}
      end
    else
      {:error, :missing_credentials}
    end
  end

  defp api_key, do: cfg()[:api_key]
  defp base_url, do: cfg()[:base_url] || @default_base_url
  defp cfg, do: Application.get_env(:crypto_portfolio_v3, :polygon, [])
end
