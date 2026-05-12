defmodule CryptoPortfolioV3Web.BrokerFundingController do
  @moduledoc """
  Stub Broker API funding endpoints. Persists deposit intent locally
  so the frontend can exercise the eventual Alpaca Broker flow without
  any real money movement.

  Routes:
    POST /api/broker/funding/deposits  — record a deposit intent
    GET  /api/broker/funding/deposits  — list this user's deposits
  """

  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.BrokerFunding
  alias CryptoPortfolioV3.BrokerFunding.{BrokerApi, Client}

  @methods ~w(ach wire instant)
  @max_amount Decimal.new(1_000_000)

  def create(conn, params) do
    user_id = conn.assigns.current_user.id

    with {:ok, amount} <- parse_amount(params["amount"]),
         {:ok, method} <- validate_method(params["method"]),
         bank_label <- (params["bank_label"] || "Chase ••••1234") |> to_string() |> String.trim(),
         note <- (params["note"] || "") |> to_string() |> String.trim() do
      attrs = %{
        "amount" => amount,
        "method" => method,
        "bank_label" => if(bank_label == "", do: "Linked bank", else: bank_label),
        "note" => if(note == "", do: nil, else: note)
      }

      case BrokerFunding.create_deposit(user_id, attrs) do
        {:ok, deposit} ->
          conn
          |> put_status(:created)
          |> json(serialize(deposit))

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{error: "invalid_deposit", details: changeset_errors(changeset)})
      end
    else
      {:error, msg} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: msg})
    end
  end

  def index(conn, _params) do
    user_id = conn.assigns.current_user.id
    deposits = BrokerFunding.list_deposits(user_id) |> Enum.map(&serialize/1)
    json(conn, %{deposits: deposits})
  end

  @doc """
  Verifies the Alpaca Broker API sandbox is reachable with the configured
  credentials. Returns:
    { configured: true, reachable: true, accounts_visible: <count> }
  on success.

  Use to confirm B2B_API_KEY / B2B_API_SECRET are correct without having
  to create a full transfer flow.
  """
  def verify(conn, _params) do
    cond do
      not BrokerApi.configured?() ->
        json(conn, %{
          configured: false,
          reachable: false,
          base_url: BrokerApi.base_url(),
          message: "B2B_API_KEY / B2B_API_SECRET not set"
        })

      true ->
        case Client.list_accounts() do
          {:ok, accounts} when is_list(accounts) ->
            json(conn, %{
              configured: true,
              reachable: true,
              base_url: BrokerApi.base_url(),
              accounts_visible: length(accounts)
            })

          {:ok, %{} = body} ->
            json(conn, %{
              configured: true,
              reachable: true,
              base_url: BrokerApi.base_url(),
              response: body
            })

          {:error, {:http_error, status, body}} ->
            conn
            |> put_status(:bad_gateway)
            |> json(%{
              configured: true,
              reachable: false,
              base_url: BrokerApi.base_url(),
              status: status,
              error: body
            })

          {:error, reason} ->
            conn
            |> put_status(:bad_gateway)
            |> json(%{
              configured: true,
              reachable: false,
              base_url: BrokerApi.base_url(),
              error: inspect(reason)
            })
        end
    end
  end

  # ── helpers ─────────────────────────────────────────────────────────────

  defp parse_amount(amount) do
    case to_decimal(amount) do
      {:ok, d} ->
        cond do
          Decimal.compare(d, Decimal.new(0)) != :gt -> {:error, "amount must be greater than zero"}
          Decimal.compare(d, @max_amount) == :gt -> {:error, "amount exceeds limit"}
          true -> {:ok, d}
        end

      :error ->
        {:error, "amount must be a positive number"}
    end
  end

  defp to_decimal(v) when is_binary(v) do
    case Decimal.parse(v) do
      {d, ""} -> {:ok, d}
      _ -> :error
    end
  end

  defp to_decimal(v) when is_integer(v), do: {:ok, Decimal.new(v)}
  defp to_decimal(v) when is_float(v), do: {:ok, Decimal.from_float(v)}
  defp to_decimal(_), do: :error

  defp validate_method(m) when m in @methods, do: {:ok, m}
  defp validate_method(nil), do: {:ok, "ach"}
  defp validate_method(_), do: {:error, "method must be one of: ach, wire, instant"}

  defp serialize(d) do
    %{
      id: d.id,
      amount: Decimal.to_string(d.amount, :normal),
      method: d.method,
      bank_label: d.bank_label,
      reference: d.reference,
      status: d.status,
      note: d.note,
      instant_amount: d.instant_amount && Decimal.to_string(d.instant_amount, :normal),
      created_at: d.inserted_at,
      updated_at: d.updated_at
    }
  end

  defp changeset_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
