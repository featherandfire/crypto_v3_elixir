defmodule CryptoPortfolioV3Web.AlpacaController do
  @moduledoc """
  Thin pass-through to Alpaca. Two underlying clients:

    * Account-scoped trading (account, positions, orders) routes through
      the Broker API to the *user's own* Alpaca customer account. The
      user must have an ACTIVE brokerage_account (KYC complete) — calls
      from un-onboarded users return empty results for reads and 412
      for writes.

    * Market data (quotes, bars, snapshots, dividends, etc.) stays on
      the shared `Alpaca` paper data API — no per-user concept applies.

  All routes are gated behind the authenticated pipeline; credentials
  never travel to the frontend.
  """
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Alpaca
  alias CryptoPortfolioV3.BrokerageAccounts
  alias CryptoPortfolioV3.BrokerFunding.Client, as: BrokerClient

  def account(conn, _params), do: with_account(conn, &BrokerClient.get_trading_account/1)

  def positions(conn, _params) do
    case BrokerageAccounts.active_alpaca_account_id(conn.assigns.current_user.id) do
      {:ok, account_id} -> render_result(conn, BrokerClient.list_positions(account_id))
      # Un-onboarded users see empty lists rather than errors so the
      # brokerage page renders cleanly while they sit on the KYC redirect.
      {:error, _} -> json(conn, [])
    end
  end

  def quote(conn, %{"symbol" => symbol}) when is_binary(symbol) do
    render_result(conn, Alpaca.latest_quote(String.upcase(symbol)))
  end

  def quote(conn, _), do: bad_request(conn, "missing symbol")

  def bars(conn, %{"symbol" => symbol} = params) do
    days =
      case Integer.parse(params["days"] || "365") do
        {n, _} when n > 0 and n <= 1825 -> n
        _ -> 365
      end

    render_result(conn, Alpaca.daily_bars(String.upcase(symbol), days))
  end

  def snapshots(conn, %{"symbols" => csv}) when is_binary(csv) do
    case parse_symbols(csv) do
      [] -> bad_request(conn, "no symbols provided")
      syms -> render_result(conn, Alpaca.snapshots(syms))
    end
  end

  def snapshots(conn, _), do: bad_request(conn, "missing symbols")

  def dividends(conn, %{"symbols" => csv}) when is_binary(csv) do
    case parse_symbols(csv) do
      [] -> bad_request(conn, "no symbols provided")
      syms -> render_result(conn, Alpaca.cash_dividends(syms))
    end
  end

  def dividends(conn, _), do: bad_request(conn, "missing symbols")

  def assets(conn, %{"symbols" => csv}) when is_binary(csv) do
    case parse_symbols(csv) do
      [] -> bad_request(conn, "no symbols provided")
      syms -> render_result(conn, Alpaca.assets(syms))
    end
  end

  def assets(conn, _), do: bad_request(conn, "missing symbols")

  # Shared CSV → uppercase symbol-list pipeline. Capped at 500 to match
  # the Alpaca controller's batch limits.
  defp parse_symbols(csv) when is_binary(csv) do
    csv
    |> String.split(",", trim: true)
    |> Enum.map(&(&1 |> String.trim() |> String.upcase()))
    |> Enum.reject(&(&1 == ""))
    |> Enum.take(500)
  end

  def changes(conn, params) do
    days =
      case Integer.parse(params["days"] || "1460") do
        {n, _} when n > 0 and n <= 1825 -> n
        _ -> 1460
      end

    pairs = parse_change_pairs(params["pairs"] || params["symbols"] || "")

    if pairs == [] do
      bad_request(conn, "no symbols provided")
    else
      render_result(conn, Alpaca.bars_changes(pairs, days))
    end
  end

  # Accepts either "stock:bench,stock:bench,..." (pairs) or plain comma-
  # separated symbols (no benchmark — bench_pct will come back nil).
  defp parse_change_pairs(csv) when is_binary(csv) do
    csv
    |> String.split(",", trim: true)
    |> Enum.map(fn entry ->
      case String.split(entry, ":", parts: 2) do
        [s, b] -> {String.trim(s) |> String.upcase(), String.trim(b) |> String.upcase()}
        [s] -> {String.trim(s) |> String.upcase(), nil}
      end
    end)
    |> Enum.reject(fn
      {"", _} -> true
      {s, b} when b in [nil, ""] -> s == ""
      _ -> false
    end)
    |> Enum.map(fn
      {s, ""} -> {s, nil}
      pair -> pair
    end)
    |> Enum.take(500)
  end

  def dividend_activities(conn, _params) do
    render_result(conn, Alpaca.dividend_activities())
  end

  @order_keys ~w(symbol qty notional side type time_in_force limit_price stop_price extended_hours)

  def list_orders(conn, params) do
    case BrokerageAccounts.active_alpaca_account_id(conn.assigns.current_user.id) do
      {:ok, account_id} ->
        opts =
          Enum.filter(
            [status: params["status"] || "all", limit: params["limit"] || 50],
            fn {_, v} -> v != nil end
          )

        render_result(conn, BrokerClient.list_orders(account_id, opts))

      {:error, _} ->
        json(conn, [])
    end
  end

  def create_order(conn, params) do
    body =
      params
      |> Map.take(@order_keys)
      |> Enum.reject(fn {_, v} -> v in [nil, ""] end)
      |> Map.new()

    cond do
      body["symbol"] in [nil, ""] ->
        bad_request(conn, "symbol required")

      body["side"] not in ["buy", "sell"] ->
        bad_request(conn, "side must be buy or sell")

      true ->
        case BrokerageAccounts.active_alpaca_account_id(conn.assigns.current_user.id) do
          {:ok, account_id} ->
            render_result(conn, BrokerClient.place_order(account_id, body))

          {:error, reason} ->
            conn
            |> put_status(:precondition_failed)
            |> json(%{error: "onboarding_required", reason: to_string(reason)})
        end
    end
  end

  def cancel_order(conn, %{"id" => id}) when is_binary(id) do
    case BrokerageAccounts.active_alpaca_account_id(conn.assigns.current_user.id) do
      {:ok, account_id} ->
        render_result(conn, BrokerClient.cancel_order(account_id, id))

      {:error, reason} ->
        conn
        |> put_status(:precondition_failed)
        |> json(%{error: "onboarding_required", reason: to_string(reason)})
    end
  end

  # Resolves the authenticated user's Alpaca account_id then invokes the
  # given Broker-API client fn. Returns an empty `nil`/200 for un-onboarded
  # users so dashboards render without surfacing an error before KYC.
  defp with_account(conn, fun) when is_function(fun, 1) do
    case BrokerageAccounts.active_alpaca_account_id(conn.assigns.current_user.id) do
      {:ok, account_id} -> render_result(conn, fun.(account_id))
      {:error, _} -> json(conn, nil)
    end
  end

  defp render_result(conn, {:ok, body}), do: json(conn, body)

  defp render_result(conn, {:error, :missing_credentials}) do
    conn
    |> put_status(:service_unavailable)
    |> json(%{error: "alpaca_not_configured"})
  end

  defp render_result(conn, {:error, {:http, status, body}}) do
    conn
    |> put_status(status)
    |> json(%{error: "alpaca_http_#{status}", body: body})
  end

  # Broker API client uses {:http_error, status, body}; same surface.
  defp render_result(conn, {:error, {:http_error, status, body}}) do
    conn
    |> put_status(status)
    |> json(%{error: "alpaca_http_#{status}", body: body})
  end

  defp render_result(conn, {:error, reason}) do
    conn
    |> put_status(:bad_gateway)
    |> json(%{error: "alpaca_error", reason: inspect(reason)})
  end

  defp bad_request(conn, msg) do
    conn |> put_status(:bad_request) |> json(%{error: msg})
  end
end
