defmodule CryptoPortfolioV3Web.TransactionController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Portfolios
  alias CryptoPortfolioV3Web.Serializer

  action_fallback CryptoPortfolioV3Web.FallbackController

  def index(conn, %{"portfolio_id" => pid, "holding_id" => hid}) do
    user_id = conn.assigns.current_user.id

    case Portfolios.get_holding_for_user(user_id, pid, hid) do
      nil ->
        {:error, :not_found, "holding"}

      h ->
        transactions = Portfolios.list_transactions_for_holding(h.id)
        json(conn, %{transactions: Enum.map(transactions, &Serializer.transaction/1)})
    end
  end

  def create(conn, %{"portfolio_id" => pid, "holding_id" => hid} = params) do
    user_id = conn.assigns.current_user.id

    with h when not is_nil(h) <- Portfolios.get_holding_for_user(user_id, pid, hid),
         {:ok, tx} <- Portfolios.create_transaction(h.id, Map.drop(params, ["portfolio_id", "holding_id"])) do
      conn
      |> put_status(:created)
      |> json(%{transaction: Serializer.transaction(tx)})
    else
      nil -> {:error, :not_found, "holding"}
      {:error, reason} -> {:error, reason}
    end
  end
end
