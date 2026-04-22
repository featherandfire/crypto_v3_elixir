defmodule CryptoPortfolioV3Web.PortfolioController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Portfolios
  alias CryptoPortfolioV3Web.Serializer

  action_fallback CryptoPortfolioV3Web.FallbackController

  def index(conn, _params) do
    portfolios = Portfolios.list_portfolios_for_user(conn.assigns.current_user.id)
    json(conn, %{portfolios: Enum.map(portfolios, &Serializer.portfolio/1)})
  end

  def create(conn, params) do
    with {:ok, p} <- Portfolios.create_portfolio(conn.assigns.current_user.id, params) do
      conn
      |> put_status(:created)
      |> json(%{portfolio: Serializer.portfolio(p)})
    end
  end

  def show(conn, %{"id" => id}) do
    case Portfolios.get_portfolio_with_holdings(conn.assigns.current_user.id, id) do
      nil -> {:error, :not_found, "portfolio"}
      p -> json(conn, %{portfolio: Serializer.portfolio_detail(p)})
    end
  end

  def delete(conn, %{"id" => id}) do
    case Portfolios.get_portfolio_for_user(conn.assigns.current_user.id, id) do
      nil ->
        {:error, :not_found, "portfolio"}

      p ->
        {:ok, _} = Portfolios.delete_portfolio(p)
        send_resp(conn, :no_content, "")
    end
  end

  def refresh(conn, %{"id" => id}) do
    case Portfolios.refresh_portfolio_prices(conn.assigns.current_user.id, id) do
      {:ok, count, portfolio} ->
        json(conn, %{
          refreshed_coins: count,
          portfolio: Serializer.portfolio_detail(portfolio)
        })

      {:error, :not_found} ->
        {:error, :not_found, "portfolio"}
    end
  end
end
