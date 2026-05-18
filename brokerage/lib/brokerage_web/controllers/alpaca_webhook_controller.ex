defmodule BrokerageWeb.AlpacaWebhookController do
  @moduledoc """
  Receives signed webhook deliveries from Alpaca's Broker API.

  - Unauthenticated route (Alpaca doesn't carry our JWT); secured by
    HMAC-SHA256 over the raw request body using `ALPACA_WEBHOOK_SECRET`.
  - Idempotent on Alpaca's `event_id` — re-deliveries during outages
    don't double-apply.
  - Always returns 2xx after verification; downstream handler errors
    are logged and persisted on the event row for later replay.
  """

  use BrokerageWeb, :controller

  require Logger

  alias Brokerage.AlpacaWebhooks

  # Alpaca uses one of a few header names depending on event format —
  # check all the documented variants. Lowercased because Plug normalizes.
  @signature_headers ~w(x-alpaca-signature x-webhook-signature alpaca-signature)

  def create(conn, _params) do
    with {:ok, raw_body} <- fetch_raw_body(conn),
         {:ok, signature} <- fetch_signature(conn),
         {:ok, secret} <- fetch_secret(),
         :ok <- AlpacaWebhooks.verify_signature(raw_body, signature, secret),
         {:ok, payload} <- Jason.decode(raw_body) do
      AlpacaWebhooks.ingest(payload)
      send_resp(conn, :ok, "")
    else
      {:error, :missing_secret} ->
        Logger.error("Webhook hit but ALPACA_WEBHOOK_SECRET is unset")
        send_resp(conn, :service_unavailable, "")

      {:error, :no_raw_body} ->
        # CacheBodyReader didn't fire — endpoint mis-wired.
        Logger.error("Webhook raw body unavailable; check CacheBodyReader plug")
        send_resp(conn, :internal_server_error, "")

      {:error, :missing_signature} ->
        send_resp(conn, :unauthorized, "")

      {:error, :invalid_signature} ->
        Logger.warning("Webhook signature mismatch")
        send_resp(conn, :unauthorized, "")

      {:error, %Jason.DecodeError{} = e} ->
        Logger.warning("Webhook body not valid JSON: #{Exception.message(e)}")
        send_resp(conn, :bad_request, "")
    end
  end

  defp fetch_raw_body(%{assigns: %{raw_body: body}}) when is_binary(body), do: {:ok, body}
  defp fetch_raw_body(_), do: {:error, :no_raw_body}

  defp fetch_signature(conn) do
    sig =
      Enum.find_value(@signature_headers, fn header ->
        case Plug.Conn.get_req_header(conn, header) do
          [v | _] when is_binary(v) and v != "" -> v
          _ -> nil
        end
      end)

    if sig, do: {:ok, sig}, else: {:error, :missing_signature}
  end

  defp fetch_secret do
    case System.get_env("ALPACA_WEBHOOK_SECRET") do
      s when is_binary(s) and s != "" -> {:ok, s}
      _ -> {:error, :missing_secret}
    end
  end
end
