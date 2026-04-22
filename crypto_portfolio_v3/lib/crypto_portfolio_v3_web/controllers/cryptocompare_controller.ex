defmodule CryptoPortfolioV3Web.CryptocompareController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Market

  action_fallback CryptoPortfolioV3Web.FallbackController

  def changes(conn, %{"symbols" => syms} = params) when is_binary(syms) do
    symbols = parse_list(syms, 250)
    days = parse_days(params["days"] || "548", 5)

    if symbols == [] do
      conn |> put_status(:unprocessable_entity) |> json(%{error: "symbols required"})
    else
      map = Market.fetch_pct_changes(symbols, days)
      json(conn, %{changes: stringify_values(map)})
    end
  end

  def changes(conn, _),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: "symbols required"})

  def volatility(conn, %{"symbols" => syms} = params) when is_binary(syms) do
    symbols = parse_list(syms, 200)
    days = parse_days(params["days"] || "90,180", 5)

    if symbols == [] do
      conn |> put_status(:unprocessable_entity) |> json(%{error: "symbols required"})
    else
      map = Market.fetch_volatilities(symbols, days)
      json(conn, %{volatility: stringify_values(map)})
    end
  end

  def volatility(conn, _),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: "symbols required"})

  # ── Helpers ──

  defp parse_list(s, cap) do
    s
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.take(cap)
  end

  defp parse_days(s, cap) do
    s
    |> parse_list(cap)
    |> Enum.flat_map(fn d ->
      case Integer.parse(d) do
        {n, _} when n > 0 -> [n]
        _ -> []
      end
    end)
  end

  defp stringify_values(map) do
    Map.new(map, fn {k, inner} ->
      {k, Map.new(inner, fn {days, v} -> {Integer.to_string(days), n2s(v)} end)}
    end)
  end

  defp n2s(nil), do: nil
  defp n2s(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp n2s(n) when is_integer(n), do: Integer.to_string(n)
  defp n2s(n) when is_float(n), do: Float.to_string(n)
end
