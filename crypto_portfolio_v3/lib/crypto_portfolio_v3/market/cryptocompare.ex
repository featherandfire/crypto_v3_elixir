defmodule CryptoPortfolioV3.Market.CryptoCompare do
  @moduledoc """
  CryptoCompare HTTP client. Used by the background pct-change prefetcher.
  """

  require Logger

  @doc """
  Fetches historical daily close prices. Returns `{:ok, [%{close, time}]}`.
  """
  @spec histoday(binary(), pos_integer()) :: {:ok, [map()]} | {:error, term()}
  def histoday(symbol, days) when is_binary(symbol) and is_integer(days) do
    with {:ok, data} <-
           get("/data/v2/histoday", %{fsym: symbol, tsym: "USD", limit: days}) do
      case data do
        %{"Response" => "Error"} -> {:error, :cryptocompare_error}
        %{"Data" => %{"Data" => points}} when is_list(points) -> {:ok, points}
        _ -> {:ok, []}
      end
    end
  end

  # ── Internals ──

  defp get(path, params) do
    cfg = Application.fetch_env!(:crypto_portfolio_v3, :cryptocompare)
    headers = if cfg[:api_key], do: [{"authorization", "Apikey #{cfg[:api_key]}"}], else: []

    req =
      Req.new(
        base_url: cfg[:base_url],
        receive_timeout: cfg[:timeout_ms],
        headers: headers,
        retry: :transient,
        max_retries: 3,
        retry_delay: fn attempt -> 5000 * (attempt + 1) end
      )

    case Req.get(req, url: path, params: Map.to_list(params)) do
      {:ok, %Req.Response{status: 200, body: body}} -> {:ok, body}
      {:ok, %Req.Response{status: s, body: b}} -> {:error, {:http, s, b}}
      {:error, e} ->
        Logger.warning("CryptoCompare #{path} error: #{Exception.message(e)}")
        {:error, e}
    end
  end
end
