defmodule CryptoPortfolioV3.BrokerFunding.Client do
  @moduledoc """
  Authenticated HTTP client for Alpaca Broker API. Wraps Req with the
  Basic-auth header derived from B2B_API_KEY / B2B_API_SECRET.

  Surface area covers customer onboarding, funding, and per-account trading:

    Customer accounts:
    - list_accounts/1               sanity check / partner-account discovery
    - get_account/1                 fetch a single customer account
    - post_account/1                create a new customer account (KYC)

    Linked banks + transfers:
    - list_ach_relationships/1      list a customer's linked banks
    - post_ach_relationship/2       link a new bank to a customer account
    - create_transfer/2             initiate an ACH/wire/instant deposit

    Trading (executes the customer's instruction on their own account):
    - get_trading_account/1         cash, equity, buying power
    - list_positions/1              open positions on this customer's account
    - list_orders/2                 order history filtered by status
    - place_order/2                 self-directed order; customer authorized via UI
    - cancel_order/2                cancel an open order on this customer's account

  All functions return `{:ok, decoded_body}` or `{:error, reason}` where
  reason is one of:
    :missing_credentials   B2B_API_KEY/B2B_API_SECRET not set
    {:http_error, status, body}  Alpaca returned a non-2xx response
    {:request_error, exception}  network or transport failure
  """

  require Logger

  alias CryptoPortfolioV3.BrokerFunding.BrokerApi

  @timeout_ms 15_000

  def list_accounts(opts \\ []) do
    query = Keyword.take(opts, [:query, :status, :created_before, :created_after])
    get("/v1/accounts", params: Keyword.get(query, :query, []))
  end

  def get_account(account_id) when is_binary(account_id) do
    get("/v1/accounts/#{account_id}")
  end

  @doc """
  Creates an Alpaca customer account. `payload` is the full KYC body
  per Alpaca's POST /v1/accounts docs — contact, identity, disclosures,
  agreements.
  """
  def post_account(payload) when is_map(payload) do
    post("/v1/accounts", payload)
  end

  @doc """
  Lists ACH relationships for an Alpaca customer account.
  """
  def list_ach_relationships(account_id) when is_binary(account_id) do
    get("/v1/accounts/#{account_id}/ach_relationships")
  end

  @doc """
  Creates an ACH relationship (linked bank) on a customer account.
  `payload` needs `:account_owner_name`, `:bank_account_type`,
  `:bank_account_number`, `:bank_routing_number`, and optionally
  `:nickname`.
  """
  def post_ach_relationship(account_id, payload)
      when is_binary(account_id) and is_map(payload) do
    post("/v1/accounts/#{account_id}/ach_relationships", payload)
  end

  @doc """
  Initiates a transfer (deposit) for an Alpaca customer account.
  `params` should include `:amount`, `:direction` ("INCOMING" for deposits),
  and either `:bank_id` (for ACH) or `:fee_payer` (wire) per Alpaca's docs.
  """
  def create_transfer(account_id, params) when is_binary(account_id) and is_map(params) do
    post("/v1/accounts/#{account_id}/transfers", params)
  end

  # ── Trading endpoints (per-customer-account) ────────────────────────────

  @doc """
  Fetches the customer's trading account — cash, equity, buying power.
  Per-user via the Broker API.
  """
  def get_trading_account(account_id) when is_binary(account_id) do
    get("/v1/trading/accounts/#{account_id}/account")
  end

  @doc """
  Lists open positions on the customer's account.
  """
  def list_positions(account_id) when is_binary(account_id) do
    get("/v1/trading/accounts/#{account_id}/positions")
  end

  @doc """
  Lists orders on the customer's account. `opts` accepts `:status`,
  `:limit`, `:after`, etc. — passed through as query params.
  """
  def list_orders(account_id, opts \\ []) when is_binary(account_id) and is_list(opts) do
    get("/v1/trading/accounts/#{account_id}/orders", params: opts)
  end

  @doc """
  Places a self-directed order on the customer's account. The customer
  authorized the order via the UI; we're just passing their instruction
  to Alpaca. `params` mirrors Alpaca's order body (symbol, qty, side,
  type, time_in_force, limit_price, etc.).
  """
  def place_order(account_id, params) when is_binary(account_id) and is_map(params) do
    post("/v1/trading/accounts/#{account_id}/orders", params)
  end

  @doc """
  Cancels an open order on the customer's account. No body required.
  """
  def cancel_order(account_id, order_id)
      when is_binary(account_id) and is_binary(order_id) do
    delete("/v1/trading/accounts/#{account_id}/orders/#{order_id}")
  end

  # ── helpers ──────────────────────────────────────────────────────────

  defp get(path, opts \\ []) do
    request(:get, path, opts)
  end

  defp post(path, body, opts \\ []) do
    request(:post, path, Keyword.put(opts, :json, body))
  end

  defp delete(path, opts \\ []) do
    request(:delete, path, opts)
  end

  # When the AlpacaMock GenServer is running (started by Application when
  # ALPACA_MOCK=1), route every Req call through the in-process plug
  # instead of hitting Alpaca. The HTTP layer (auth header, JSON
  # parsing, status handling) still runs — only the network is bypassed.
  defp maybe_use_mock_plug(req_opts) do
    if CryptoPortfolioV3.AlpacaMock.Server.enabled?() do
      Keyword.put(req_opts, :plug, CryptoPortfolioV3.AlpacaMock.Plug)
    else
      req_opts
    end
  end

  defp request(method, path, opts) do
    with {:ok, headers} <- BrokerApi.auth_header() do
      url = BrokerApi.base_url() <> path

      req_opts =
        opts
        |> Keyword.put(:method, method)
        |> Keyword.put(:url, url)
        |> Keyword.put(:headers, headers ++ Keyword.get(opts, :headers, []))
        |> Keyword.put_new(:receive_timeout, @timeout_ms)
        |> maybe_use_mock_plug()

      try do
        case Req.request(req_opts) do
          {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
            {:ok, body}

          {:ok, %Req.Response{status: status, body: body}} ->
            Logger.warning("Broker API #{method} #{path} -> #{status}: #{inspect(body)}")
            {:error, {:http_error, status, body}}

          {:error, %{__exception__: true} = e} ->
            {:error, {:request_error, e}}
        end
      rescue
        e -> {:error, {:request_error, e}}
      end
    end
  end
end
