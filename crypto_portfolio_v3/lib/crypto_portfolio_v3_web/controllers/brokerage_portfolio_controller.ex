defmodule CryptoPortfolioV3Web.BrokeragePortfolioController do
  @moduledoc """
  CRUD for the user's brokerage-side portfolios (the chips on Holdings).
  All actions are scoped to the authenticated user. Index auto-creates a
  starter portfolio when the user has none, so a fresh login always sees
  at least one row.
  """

  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.BrokeragePortfolios
  alias CryptoPortfolioV3.BrokeragePortfolios.Portfolio

  action_fallback CryptoPortfolioV3Web.FallbackController

  def index(conn, _params) do
    portfolios = BrokeragePortfolios.list_or_seed(conn.assigns.current_user.id)
    json(conn, %{portfolios: Enum.map(portfolios, &serialize/1)})
  end

  def create(conn, params) do
    with {:ok, p} <- BrokeragePortfolios.create(conn.assigns.current_user.id, params) do
      conn
      |> put_status(:created)
      |> json(%{portfolio: serialize(p)})
    end
  end

  def update(conn, %{"id" => id} = params) do
    case BrokeragePortfolios.get_for_user(conn.assigns.current_user.id, id) do
      nil ->
        {:error, :not_found, "portfolio"}

      %Portfolio{} = p ->
        with {:ok, updated} <- BrokeragePortfolios.update(p, params) do
          json(conn, %{portfolio: serialize(updated)})
        end
    end
  end

  def delete(conn, %{"id" => id}) do
    case BrokeragePortfolios.get_for_user(conn.assigns.current_user.id, id) do
      nil ->
        {:error, :not_found, "portfolio"}

      %Portfolio{} = p ->
        case BrokeragePortfolios.delete(p) do
          {:ok, _} ->
            send_resp(conn, :no_content, "")

          {:error, :cannot_delete_main} ->
            conn
            |> put_status(:unprocessable_entity)
            |> json(%{error: "cannot_delete_main"})
        end
    end
  end

  defp serialize(%Portfolio{} = p) do
    %{
      id: p.id,
      user_id: p.user_id,
      name: p.name,
      color: p.color,
      is_main: p.is_main,
      created_at: p.inserted_at,
      updated_at: p.updated_at
    }
  end
end
