defmodule CryptoPortfolioV3Web.HoldingController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Portfolios
  alias CryptoPortfolioV3Web.Serializer

  action_fallback CryptoPortfolioV3Web.FallbackController

  def create(conn, %{"portfolio_id" => pid} = params) do
    user_id = conn.assigns.current_user.id

    with p when not is_nil(p) <- Portfolios.get_portfolio_for_user(user_id, pid),
         {:ok, holding} <- Portfolios.create_holding(p.id, params) do
      conn
      |> put_status(:created)
      |> json(%{holding: Serializer.holding_with_coin(holding)})
    else
      nil -> {:error, :not_found, "portfolio"}
      {:error, reason} -> {:error, reason}
    end
  end

  def update(conn, %{"portfolio_id" => pid, "id" => hid} = params) do
    user_id = conn.assigns.current_user.id

    with h when not is_nil(h) <- Portfolios.get_holding_for_user(user_id, pid, hid),
         {:ok, updated} <- Portfolios.update_holding(h, Map.drop(params, ["portfolio_id", "id"])) do
      json(conn, %{holding: Serializer.holding_with_coin(Map.put(updated, :coin, h.coin))})
    else
      nil -> {:error, :not_found, "holding"}
      {:error, reason} -> {:error, reason}
    end
  end

  def delete(conn, %{"portfolio_id" => pid, "id" => hid}) do
    user_id = conn.assigns.current_user.id

    case Portfolios.get_holding_for_user(user_id, pid, hid) do
      nil ->
        {:error, :not_found, "holding"}

      h ->
        {:ok, _} = Portfolios.delete_holding(h)
        send_resp(conn, :no_content, "")
    end
  end
end
