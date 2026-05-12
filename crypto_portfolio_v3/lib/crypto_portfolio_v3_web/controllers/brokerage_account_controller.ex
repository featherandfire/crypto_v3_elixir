defmodule CryptoPortfolioV3Web.BrokerageAccountController do
  @moduledoc """
  KYC submission + account status for the authenticated user.

  Routes:
    GET  /api/brokerage/account     — current user's account (or 404)
    POST /api/brokerage/account     — submit KYC, creates Alpaca account

  The POST body mirrors Alpaca's identity/contact/disclosure shape but
  flat (no nesting) — the context handles the translation. None of the
  KYC fields are ever persisted locally; Alpaca holds them.
  """

  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.BrokerageAccounts
  alias CryptoPortfolioV3.BrokerageAccounts.Account

  action_fallback CryptoPortfolioV3Web.FallbackController

  def show(conn, _params) do
    case BrokerageAccounts.get_for_user(conn.assigns.current_user.id) do
      nil -> {:error, :not_found, "brokerage_account"}
      %Account{} = a -> json(conn, %{account: serialize(a)})
    end
  end

  def create(conn, params) do
    case BrokerageAccounts.submit_kyc(conn.assigns.current_user.id, params) do
      {:ok, %Account{} = account} ->
        conn |> put_status(:created) |> json(%{account: serialize(account)})

      {:error, :already_exists} ->
        conn
        |> put_status(:conflict)
        |> json(%{error: "account_already_exists"})

      {:error, :broker_api_not_configured} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{error: "broker_api_not_configured"})

      {:error, {:validation, missing}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "missing_fields", fields: missing})

      {:error, {:alpaca_error, {:http_error, status, %{"message" => msg}}}} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "alpaca_rejected", status: status, message: msg})

      {:error, {:alpaca_error, reason}} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "alpaca_error", reason: inspect(reason)})

      {:error, :user_not_found} ->
        {:error, :not_found, "user"}
    end
  end

  defp serialize(%Account{} = a) do
    %{
      id: a.id,
      alpaca_account_id: a.alpaca_account_id,
      alpaca_account_number: a.alpaca_account_number,
      status: a.status,
      kyc_state: a.kyc_state,
      last_synced_at: a.last_synced_at,
      created_at: a.inserted_at,
      updated_at: a.updated_at
    }
  end
end
