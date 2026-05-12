defmodule CryptoPortfolioV3.AlpacaWebhooks do
  @moduledoc """
  Ingests Alpaca-signed webhook deliveries. Three responsibilities:

    1. Verify the HMAC signature against `ALPACA_WEBHOOK_SECRET`.
    2. Persist the event keyed by Alpaca's `event_id` — duplicate
       deliveries (Alpaca retries on non-2xx) become a no-op.
    3. Dispatch the payload to the right downstream context based on
       the `event_type` prefix (`transfer.*`, `account.*`, `ach_*`).

  The controller hands us the *raw* request body — we recompute the HMAC
  against the same bytes Alpaca signed before doing anything else with
  the payload. Verifying against a re-encoded JSON wouldn't work because
  whitespace/key-order differences would invalidate the signature.
  """

  require Logger
  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.AlpacaWebhooks.Event
  alias CryptoPortfolioV3.{BrokerFunding, BrokerageAccounts}

  @doc """
  HMAC-SHA256 verify the raw body against the provided signature.
  Returns `:ok` or `{:error, reason}`. `signature_hex` is the value of
  Alpaca's signature header (case-insensitive hex).
  """
  def verify_signature(raw_body, signature_hex, secret)
      when is_binary(raw_body) and is_binary(signature_hex) and is_binary(secret) do
    expected = :crypto.mac(:hmac, :sha256, secret, raw_body) |> Base.encode16(case: :lower)
    received = String.downcase(signature_hex)

    if Plug.Crypto.secure_compare(expected, received) do
      :ok
    else
      {:error, :invalid_signature}
    end
  end

  def verify_signature(_, _, _), do: {:error, :invalid_signature}

  @doc """
  Records the event (idempotent on `event_id`) and dispatches to the
  appropriate handler. Returns `:ok` whether the event is freshly
  processed, already processed, or unrecognized — Alpaca only retries
  on non-2xx, so we want to acknowledge everything we accepted.
  """
  def ingest(%{"event_id" => eid, "event_type" => etype} = payload)
      when is_binary(eid) and is_binary(etype) do
    case Repo.get_by(Event, event_id: eid) do
      %Event{processed_at: %DateTime{}} ->
        # Already handled — Alpaca retried after our 2xx didn't get through.
        :ok

      existing ->
        record = existing || insert_event(eid, etype, payload)
        process(record)
    end
  end

  # Some Alpaca events use `id` instead of `event_id`. Normalize.
  def ingest(%{"id" => eid} = payload) when is_binary(eid) do
    payload
    |> Map.put("event_id", eid)
    |> Map.put_new("event_type", payload["type"] || "unknown")
    |> ingest()
  end

  def ingest(payload) do
    Logger.warning("Webhook payload missing event_id: #{inspect(payload)}")
    {:error, :missing_event_id}
  end

  defp insert_event(eid, etype, payload) do
    case %Event{}
         |> Event.changeset(%{
           event_id: eid,
           event_type: etype,
           payload: payload,
           received_at: DateTime.utc_now()
         })
         |> Repo.insert() do
      {:ok, e} ->
        e

      # Race: another worker inserted between our get_by and insert.
      # Re-fetch — the winner's row is fine.
      {:error, _cs} ->
        Repo.get_by!(Event, event_id: eid)
    end
  end

  defp process(%Event{} = event) do
    try do
      dispatch(event.event_type, event.payload)
      mark_processed(event)
      :ok
    rescue
      e ->
        Logger.error("Webhook handler crashed for #{event.event_type}: #{inspect(e)}")
        mark_failed(event, Exception.message(e))
        :ok
    end
  end

  # Route by event-type prefix so we tolerate minor name shifts from
  # Alpaca (e.g. `transfer.status_changed` vs `transfer.status_updated`).
  defp dispatch("transfer." <> _ = _type, payload) do
    BrokerFunding.handle_webhook(payload)
  end

  defp dispatch("account." <> _ = _type, payload) do
    BrokerageAccounts.handle_account_webhook(payload)
  end

  defp dispatch("ach_relationship." <> _ = _type, payload) do
    BrokerageAccounts.handle_ach_webhook(payload)
  end

  defp dispatch(type, _payload) do
    Logger.info("Unhandled Alpaca webhook event_type: #{type}")
    :ok
  end

  defp mark_processed(%Event{} = e) do
    e
    |> Event.changeset(%{processed_at: DateTime.utc_now(), error: nil})
    |> Repo.update!()
  end

  defp mark_failed(%Event{} = e, msg) do
    e
    |> Event.changeset(%{error: msg})
    |> Repo.update!()
  end

  @doc """
  Lists recent events for an admin/debug view. Defaults to 50 most-recent
  rows; not exposed publicly.
  """
  def list_recent(limit \\ 50) do
    Repo.all(from e in Event, order_by: [desc: e.received_at], limit: ^limit)
  end
end
