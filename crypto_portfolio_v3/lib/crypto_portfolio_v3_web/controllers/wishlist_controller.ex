defmodule CryptoPortfolioV3Web.WishlistController do
  @moduledoc """
  CRUD for the authenticated user's wishlist. Each write path captures
  the caller's IP (`conn.remote_ip`) as the audit `authorized_ip` so we
  can prove user authorization later when the auto-execute worker fires
  orders.

  Routes:
    GET    /api/wishlist            list user's items
    POST   /api/wishlist            add or update (idempotent on symbol)
    DELETE /api/wishlist/:id        remove one row
    POST   /api/wishlist/reorder    full reorder of row ids
  """

  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.WishlistItems
  alias CryptoPortfolioV3.WishlistItems.Item

  action_fallback CryptoPortfolioV3Web.FallbackController

  def index(conn, _params) do
    items = WishlistItems.list_for_user(conn.assigns.current_user.id)
    json(conn, %{items: Enum.map(items, &serialize/1)})
  end

  def create(conn, params) do
    attrs =
      params
      |> Map.take(["symbol", "qty", "side", "order_type", "limit_price", "time_in_force"])
      |> Map.put("authorized_ip", remote_ip(conn))

    with {:ok, %Item{} = item} <- WishlistItems.upsert(conn.assigns.current_user.id, attrs) do
      conn
      |> put_status(:created)
      |> json(%{item: serialize(item)})
    else
      {:error, :symbol_required} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "symbol_required"})
    end
  end

  def delete(conn, %{"id" => id}) do
    case Integer.parse(to_string(id)) do
      {int_id, _} ->
        case WishlistItems.delete(conn.assigns.current_user.id, int_id) do
          {:ok, _} -> send_resp(conn, :no_content, "")
          {:error, :not_found} -> {:error, :not_found, "wishlist_item"}
        end

      :error ->
        conn |> put_status(:bad_request) |> json(%{error: "invalid_id"})
    end
  end

  def reorder(conn, %{"ids" => ids}) when is_list(ids) do
    int_ids =
      Enum.map(ids, fn
        id when is_integer(id) -> id
        id when is_binary(id) -> elem(Integer.parse(id), 0)
      end)

    case WishlistItems.reorder(conn.assigns.current_user.id, int_ids) do
      {:ok, items} ->
        json(conn, %{items: Enum.map(items, &serialize/1)})

      {:error, :id_set_mismatch} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "id_set_mismatch"})
    end
  end

  def reorder(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "ids array required"})

  defp serialize(%Item{} = i) do
    %{
      id: i.id,
      symbol: i.symbol,
      qty: Decimal.to_string(i.qty, :normal),
      side: i.side,
      order_type: i.order_type,
      limit_price: i.limit_price && Decimal.to_string(i.limit_price, :normal),
      time_in_force: i.time_in_force,
      position: i.position,
      status: i.status,
      authorized_at: i.authorized_at,
      executed_at: i.executed_at,
      executed_order_id: i.executed_order_id,
      created_at: i.inserted_at,
      updated_at: i.updated_at
    }
  end

  # IPv4 and v6 both serialize cleanly via :inet.ntoa. Falls back to
  # stringified inspect for the rare malformed tuple.
  defp remote_ip(conn) do
    case conn.remote_ip do
      ip when is_tuple(ip) ->
        case :inet.ntoa(ip) do
          {:error, _} -> inspect(ip)
          chars -> List.to_string(chars)
        end

      _ ->
        nil
    end
  end
end
