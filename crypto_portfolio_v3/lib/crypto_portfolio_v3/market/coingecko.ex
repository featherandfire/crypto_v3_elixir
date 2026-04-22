defmodule CryptoPortfolioV3.Market.CoinGecko do
  @moduledoc """
  CoinGecko HTTP client. Uses `Req` for retry/backoff on 429. All functions
  return `{:ok, data}` or `{:error, reason}`.
  """

  alias CryptoPortfolioV3.Market.{Fallbacks, PriceCache}

  require Logger

  @top_ttl_ms 300_000
  @prices_ttl_ms 30_000
  @history_ttl_ms 300_000

  # ── Public API ──

  @spec list_top(pos_integer()) :: {:ok, [map()]} | {:error, term()}
  def list_top(limit) when is_integer(limit) and limit > 0 do
    key = {:top, limit}

    case PriceCache.get(key) do
      {:ok, cached} ->
        {:ok, cached}

      :miss ->
        with {:ok, data} <-
               get("/coins/markets", %{
                 vs_currency: "usd",
                 order: "market_cap_desc",
                 per_page: limit,
                 page: 1,
                 sparkline: "false",
                 price_change_percentage: "24h,200d,1y"
               }) do
          PriceCache.put(key, data, @top_ttl_ms)
          {:ok, data}
        end
    end
  end

  @doc """
  Fetches prices for a list of CoinGecko IDs. Per-id cache, batched at 50
  per request, concurrent batches. Partial failures are tolerated — the
  result map contains what we got.
  """
  @spec list_prices([binary()]) :: {:ok, %{binary() => map()}}
  def list_prices([]), do: {:ok, %{}}

  def list_prices(ids) when is_list(ids) do
    cached =
      ids
      |> Enum.reduce(%{}, fn id, acc ->
        case PriceCache.get({:price, id}) do
          {:ok, rec} -> Map.put(acc, id, rec)
          :miss -> acc
        end
      end)

    misses = ids -- Map.keys(cached)

    fetched =
      misses
      |> Enum.chunk_every(50)
      |> Task.async_stream(
        fn batch ->
          get("/coins/markets", %{
            vs_currency: "usd",
            ids: Enum.join(batch, ","),
            order: "market_cap_desc",
            per_page: length(batch),
            page: 1,
            sparkline: "false",
            price_change_percentage: "24h"
          })
        end,
        max_concurrency: 4,
        timeout: 20_000,
        on_timeout: :kill_task
      )
      |> Enum.reduce(%{}, fn
        {:ok, {:ok, coins}}, acc when is_list(coins) ->
          Enum.reduce(coins, acc, fn coin, inner ->
            id = coin["id"]
            rec = to_price_record(coin)
            PriceCache.put({:price, id}, rec, @prices_ttl_ms)
            Map.put(inner, id, rec)
          end)

        _, acc ->
          acc
      end)

    {:ok, Map.merge(cached, fetched)}
  end

  @spec market_chart(binary(), pos_integer()) :: {:ok, [[number()]]} | {:error, term()}
  def market_chart(coingecko_id, days) when is_binary(coingecko_id) and is_integer(days) do
    key = {:chart, coingecko_id, days}

    case PriceCache.get(key) do
      {:ok, cached} ->
        {:ok, cached}

      :miss ->
        with {:ok, data} <-
               get("/coins/#{coingecko_id}/market_chart", %{vs_currency: "usd", days: days}) do
          prices = Map.get(data, "prices", [])
          PriceCache.put(key, prices, @history_ttl_ms)
          {:ok, prices}
        end
    end
  end

  @spec search(binary()) :: {:ok, [map()]} | {:error, term()}
  def search(query) when is_binary(query) do
    with {:ok, data} <- get("/search", %{query: query}) do
      coins =
        data
        |> Map.get("coins", [])
        |> Enum.take(20)
        |> Enum.map(fn c ->
          %{
            "id" => c["id"],
            "name" => c["name"],
            "symbol" => c["symbol"],
            "thumb" => c["thumb"]
          }
        end)

      {:ok, coins}
    end
  end

  @doc """
  Looks up a token's CoinGecko metadata by contract address. Returns
  `{:ok, match_map}` or `:not_listed` if CG returns 404. For Solana
  falls back to the hardcoded mint map when CG fails.
  """
  @spec coin_by_contract(binary(), binary()) ::
          {:ok, map()} | :not_listed | {:error, term()}
  def coin_by_contract(address, platform) when is_binary(address) and is_binary(platform) do
    case get("/coins/#{platform}/contract/#{address}", %{}) do
      {:ok, data} ->
        {:ok,
         %{
           "coingecko_id" => data["id"],
           "name" => data["name"],
           "symbol" => data["symbol"],
           "current_price_usd" => get_in(data, ["market_data", "current_price", "usd"]),
           "image_url" => get_in(data, ["image", "small"])
         }}

      {:error, {:http, 404, _}} ->
        :not_listed

      {:error, _} = err ->
        # For Solana, fall back to hardcoded mint map + a live price lookup.
        case platform == "solana" && Fallbacks.solana_mint(address) do
          nil -> err
          false -> err
          %{coingecko_id: cgid} = fb -> solana_fallback(address, cgid, fb)
        end
    end
  end

  @doc """
  Fetches the `platforms` map for a CoinGecko coin. Used to resolve on-chain
  contract addresses across EVM chains + Solana.
  """
  @spec platforms(binary()) :: {:ok, %{binary() => binary()}} | {:error, term()}
  def platforms(coingecko_id) when is_binary(coingecko_id) do
    with {:ok, data} <-
           get("/coins/#{coingecko_id}", %{
             localization: "false",
             tickers: "false",
             market_data: "false",
             community_data: "false",
             developer_data: "false",
             sparkline: "false"
           }) do
      {:ok, Map.get(data, "platforms", %{})}
    end
  end

  # ── Internals ──

  defp solana_fallback(address, cgid, fb) do
    # Enrich hardcoded fallback with a live price if CG batched endpoint works.
    price_rec =
      case list_prices([cgid]) do
        {:ok, map} -> Map.get(map, cgid, %{})
        _ -> %{}
      end

    {:ok,
     %{
       "coingecko_id" => cgid,
       "name" => fb.name,
       "symbol" => fb.symbol,
       "current_price_usd" => Map.get(price_rec, "current_price_usd"),
       "image_url" => Map.get(price_rec, "image_url"),
       "fallback" => true,
       "address" => address
     }}
  end

  defp to_price_record(coin) do
    %{
      "coingecko_id" => coin["id"],
      "symbol" => coin["symbol"],
      "name" => coin["name"],
      "current_price_usd" => coin["current_price"],
      "price_change_24h" => coin["price_change_percentage_24h"],
      "market_cap" => coin["market_cap"],
      "image_url" => coin["image"],
      "circulating_supply" => coin["circulating_supply"],
      "max_supply" => coin["max_supply"],
      "price_change_200d" => coin["price_change_percentage_200d_in_currency"],
      "price_change_1y" => coin["price_change_percentage_1y_in_currency"]
    }
  end

  # Low-level HTTP. Req retries on 429/5xx with exponential backoff.
  defp get(path, params) do
    cfg = Application.fetch_env!(:crypto_portfolio_v3, :coingecko)

    req =
      Req.new(
        base_url: cfg[:base_url],
        receive_timeout: cfg[:timeout_ms],
        retry: :transient,
        max_retries: cfg[:max_retries],
        retry_delay: fn attempt -> trunc(1500 * :math.pow(2, attempt)) end
      )

    case Req.get(req, url: path, params: Map.to_list(params)) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.debug("CoinGecko #{path} → HTTP #{status}")
        {:error, {:http, status, body}}

      {:error, exception} ->
        Logger.warning("CoinGecko #{path} error: #{Exception.message(exception)}")
        {:error, exception}
    end
  end
end
