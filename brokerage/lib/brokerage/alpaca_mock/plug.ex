defmodule Brokerage.AlpacaMock.Plug do
  @moduledoc """
  Plug that intercepts Alpaca Broker API requests when `ALPACA_MOCK=1`.

  Wired in via Req's `plug:` option from
  `Brokerage.BrokerFunding.Client.request/3` — the request never
  leaves the process, the plug responds inline.

  Only routes the endpoints exercised by the E2E suite. Any unmatched
  path returns 501 so we notice immediately if a new caller appears.
  """

  use Plug.Router

  alias Brokerage.AlpacaMock.Server

  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason

  plug :match
  plug :dispatch

  # ── Customer accounts ───────────────────────────────────────────────────

  post "/v1/accounts" do
    {:ok, account} = Server.create_account(conn.body_params)
    json(conn, 201, account)
  end

  get "/v1/accounts/:id" do
    case Server.get_account(id) do
      {:ok, account} -> json(conn, 200, account)
      {:not_found, _} -> json(conn, 404, %{"code" => 40410000, "message" => "account not found"})
    end
  end

  # ── ACH relationships ───────────────────────────────────────────────────

  post "/v1/accounts/:account_id/ach_relationships" do
    {:ok, rel} = Server.create_ach(account_id, conn.body_params)
    json(conn, 201, rel)
  end

  get "/v1/accounts/:account_id/ach_relationships" do
    {:ok, rels} = Server.list_ach(account_id)
    json(conn, 200, rels)
  end

  # ── Transfers ───────────────────────────────────────────────────────────

  post "/v1/accounts/:account_id/transfers" do
    case Server.create_transfer(account_id, conn.body_params) do
      {:ok, transfer} -> json(conn, 201, transfer)
      # Insufficient cash on withdrawals returns a 422 mirroring Alpaca's
      # validation error format.
      {:error, err} -> json(conn, 422, err)
    end
  end

  # ── Trading (per-customer) ──────────────────────────────────────────────

  get "/v1/trading/accounts/:account_id/account" do
    case Server.get_trading_account(account_id) do
      {:ok, ta} ->
        json(conn, 200, ta)

      {:not_found, _} ->
        json(conn, 404, %{"code" => 40410000, "message" => "trading account not found"})
    end
  end

  get "/v1/trading/accounts/:account_id/orders" do
    {:ok, orders} = Server.list_orders(account_id)
    json(conn, 200, orders)
  end

  get "/v1/trading/accounts/:account_id/positions" do
    {:ok, positions} = Server.list_positions(account_id)
    json(conn, 200, positions)
  end

  get "/v1/accounts/:account_id/activities" do
    {:ok, activities} = Server.list_activities(account_id)
    json(conn, 200, activities)
  end

  get "/v1/trading/accounts/:account_id/account/portfolio/history" do
    {:ok, history} = Server.get_portfolio_history(account_id)
    json(conn, 200, history)
  end

  post "/v1/trading/accounts/:account_id/orders" do
    case Server.place_order(account_id, conn.body_params) do
      {:ok, order} -> json(conn, 200, order)
      # 403 with the buying-power message matches what Alpaca's sandbox
      # returns. Our controllers + the order_placement spec key off this.
      {:error, %{"message" => "insufficient buying power"} = err} -> json(conn, 403, err)
      {:error, err} -> json(conn, 422, err)
    end
  end

  # ── Fallback ────────────────────────────────────────────────────────────

  match _ do
    json(conn, 501, %{
      "code" => 50100000,
      "message" => "AlpacaMock has not implemented #{conn.method} #{conn.request_path}"
    })
  end

  defp json(conn, status, body) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(status, Jason.encode!(body))
  end
end
