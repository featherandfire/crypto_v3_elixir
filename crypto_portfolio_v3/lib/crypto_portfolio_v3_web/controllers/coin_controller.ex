defmodule CryptoPortfolioV3Web.CoinController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Market

  action_fallback CryptoPortfolioV3Web.FallbackController

  def top(conn, params) do
    limit = parse_limit(params["limit"], 50, 200)

    with {:ok, coins} <- Market.list_top_coins(limit) do
      json(conn, %{coins: Enum.map(coins, &serialize_raw_coin/1)})
    end
  end

  def yearly_ranges(conn, %{"ids" => ids}) when is_binary(ids) do
    id_list =
      ids
      |> String.split(",")
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.take(250)

    if id_list == [] do
      conn |> put_status(:unprocessable_entity) |> json(%{error: "ids required"})
    else
      map = Market.fetch_yearly_ranges(id_list)
      json(conn, %{yearly_ranges: serialize_yearly_map(map)})
    end
  end

  def yearly_ranges(conn, _),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: "ids required"})

  def supply(conn, params) do
    limit = parse_limit(params["limit"], 200, 250)

    with {:ok, map} <- Market.supply_map(limit) do
      serialized =
        Map.new(map, fn {sym, %{"circulating_supply" => c, "max_supply" => m}} ->
          {sym, %{"circulating_supply" => n2s(c), "max_supply" => n2s(m)}}
        end)

      json(conn, %{supply: serialized})
    end
  end

  def search(conn, %{"q" => q}) when is_binary(q) and q != "" do
    with {:ok, results} <- Market.search(q) do
      json(conn, %{results: results})
    end
  end

  def search(conn, _),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: "q required"})

  def history(conn, %{"coingecko_id" => id} = params) do
    days = parse_limit(params["days"], 30, 365)

    case Market.price_history(id, days) do
      {:ok, data} ->
        json(conn, data)

      {:error, {:http, 429, _}} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "CoinGecko rate limit — try again in a moment"})

      {:error, _} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "Failed to fetch price history from CoinGecko"})
    end
  end

  # ── Helpers ──

  defp parse_limit(nil, default, max), do: clamp(default, 1, max)

  defp parse_limit(s, default, max) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} -> clamp(n, 1, max)
      :error -> default
    end
  end

  defp clamp(n, lo, hi), do: n |> max(lo) |> min(hi)

  defp serialize_raw_coin(c) do
    %{
      "coingecko_id" => c["coingecko_id"],
      "symbol" => c["symbol"],
      "name" => c["name"],
      "current_price_usd" => n2s(c["current_price_usd"]),
      "price_change_24h" => n2s(c["price_change_24h"]),
      "market_cap" => n2s(c["market_cap"]),
      "image_url" => c["image_url"],
      "circulating_supply" => n2s(c["circulating_supply"]),
      "max_supply" => n2s(c["max_supply"]),
      "price_change_200d" => n2s(c["price_change_200d"]),
      "price_change_1y" => n2s(c["price_change_1y"]),
      "last_updated" => c["last_updated"]
    }
  end

  defp serialize_yearly_map(map) do
    Map.new(map, fn {id, stat} ->
      {id,
       %{
         "high_1y" => n2s(stat["high_1y"]),
         "low_1y" => n2s(stat["low_1y"]),
         "vol_90d" => n2s(stat["vol_90d"]),
         "vol_180d" => n2s(stat["vol_180d"]),
         "vol_365d" => n2s(stat["vol_365d"])
       }}
    end)
  end

  # Numeric → string per API convention (decimals-as-strings). Pass through
  # floats/ints from raw CG responses too.
  defp n2s(nil), do: nil
  defp n2s(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp n2s(n) when is_integer(n), do: Integer.to_string(n)
  defp n2s(n) when is_float(n), do: Float.to_string(n)
  defp n2s(s) when is_binary(s), do: s
end
