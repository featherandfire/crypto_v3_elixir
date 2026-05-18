defmodule BrokerageWeb.RecurringInvestmentController do
  @moduledoc """
  CRUD for the authenticated user's recurring investments. Captures
  `conn.remote_ip` as the authorization audit on writes (same model as
  the wishlist controller).

  Routes:
    GET    /api/recurring-investments        list user's schedules
    POST   /api/recurring-investments        create a schedule
    PATCH  /api/recurring-investments/:id    update / pause / resume
    DELETE /api/recurring-investments/:id    hard delete (use PATCH to pause)
  """

  use BrokerageWeb, :controller

  alias Brokerage.RecurringInvestments
  alias Brokerage.RecurringInvestments.Investment

  action_fallback BrokerageWeb.FallbackController

  def index(conn, _params) do
    items = RecurringInvestments.list_for_user(conn.assigns.current_user.id)
    json(conn, %{items: Enum.map(items, &serialize/1)})
  end

  def create(conn, params) do
    attrs =
      params
      |> Map.take([
        "symbol",
        "qty",
        "side",
        "order_type",
        "time_in_force",
        "limit_price",
        "frequency",
        "starts_at"
      ])

    case RecurringInvestments.create(
           conn.assigns.current_user.id,
           attrs,
           authorized_ip: remote_ip(conn)
         ) do
      {:ok, investment} ->
        conn |> put_status(:created) |> json(%{item: serialize(investment)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "invalid", details: changeset_errors(cs)})
    end
  end

  def update(conn, %{"id" => id} = params) do
    case RecurringInvestments.get_for_user(conn.assigns.current_user.id, to_int(id)) do
      nil ->
        {:error, :not_found, "recurring_investment"}

      %Investment{} = investment ->
        case RecurringInvestments.update(investment, Map.drop(params, ["id"])) do
          {:ok, updated} ->
            json(conn, %{item: serialize(updated)})

          {:error, %Ecto.Changeset{} = cs} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "invalid", details: changeset_errors(cs)})
        end
    end
  end

  def delete(conn, %{"id" => id}) do
    case RecurringInvestments.get_for_user(conn.assigns.current_user.id, to_int(id)) do
      nil ->
        {:error, :not_found, "recurring_investment"}

      %Investment{} = investment ->
        {:ok, _} = RecurringInvestments.delete(investment)
        send_resp(conn, :no_content, "")
    end
  end

  # ── helpers ────────────────────────────────────────────────────────────

  defp serialize(%Investment{} = i) do
    %{
      id: i.id,
      symbol: i.symbol,
      qty: Decimal.to_string(i.qty, :normal),
      side: i.side,
      order_type: i.order_type,
      time_in_force: i.time_in_force,
      limit_price: i.limit_price && Decimal.to_string(i.limit_price, :normal),
      frequency: i.frequency,
      starts_at: i.starts_at,
      next_run_at: i.next_run_at,
      last_run_at: i.last_run_at,
      is_active: i.is_active,
      authorized_at: i.authorized_at,
      created_at: i.inserted_at,
      updated_at: i.updated_at
    }
  end

  defp to_int(id) when is_binary(id) do
    case Integer.parse(id) do
      {n, _} -> n
      _ -> 0
    end
  end

  defp to_int(id) when is_integer(id), do: id

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

  defp changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
