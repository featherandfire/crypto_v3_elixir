defmodule BrokerageWeb.BrokerageAllocationController do
  @moduledoc """
  Per-symbol position allocations across the user's brokerage portfolios.
  GET returns every allocation row the user owns; PUT replaces the entire
  allocation set for one symbol atomically.

  Body for PUT:
    { "allocations": { "<portfolio_id>": "<qty>", ... } }

  Entries with qty ≤ 0 are deleted; missing portfolio ids are deleted.
  Sending an empty allocations map clears the symbol entirely.
  """

  use BrokerageWeb, :controller

  alias Brokerage.BrokeragePortfolios

  action_fallback BrokerageWeb.FallbackController

  def index(conn, _params) do
    allocs = BrokeragePortfolios.list_allocations_for_user(conn.assigns.current_user.id)
    json(conn, %{allocations: Enum.map(allocs, &serialize/1)})
  end

  def update(conn, %{"symbol" => symbol, "allocations" => allocations})
      when is_map(allocations) do
    case BrokeragePortfolios.set_allocations(
           conn.assigns.current_user.id,
           normalize_symbol(symbol),
           allocations
         ) do
      {:ok, allocs} ->
        json(conn, %{
          symbol: normalize_symbol(symbol),
          allocations: Enum.map(allocs, &serialize/1)
        })

      {:error, {:invalid_portfolio_ids, ids}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "invalid_portfolio_ids", ids: ids})
    end
  end

  def update(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "expected `allocations` map in body"})
  end

  defp normalize_symbol(s) when is_binary(s), do: s |> String.trim() |> String.upcase()
  defp normalize_symbol(_), do: ""

  defp serialize(a) do
    %{
      symbol: a.symbol,
      portfolio_id: a.portfolio_id,
      qty: Decimal.to_string(a.qty, :normal)
    }
  end
end
