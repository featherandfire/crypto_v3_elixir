defmodule Mix.Tasks.Webhook.Simulate do
  @moduledoc """
  Fires a signed Alpaca-style webhook at the local Phoenix server so you
  can test the receiver without setting up ngrok.

  Usage:

      # Mark a transfer COMPLETE (uses the Alpaca transfer id stored
      # in broker_deposits.reference)
      mix webhook.simulate transfer.status_updated <transfer_id> --status=COMPLETE

      # Flip an account to ACTIVE
      mix webhook.simulate account.status_updated <alpaca_account_id> --status=ACTIVE

      # Approve an ACH relationship
      mix webhook.simulate ach_relationship.status_updated <rel_id> --status=APPROVED

  Reads `ALPACA_WEBHOOK_SECRET` from env (set in .env). POSTs to
  http://localhost:4000/api/webhooks/alpaca with a valid HMAC signature
  so the receiver verifies and ingests.
  """

  use Mix.Task

  @shortdoc "Fire a signed Alpaca-style webhook at local Phoenix"

  @impl Mix.Task
  def run(args) do
    {opts, positional, _} =
      OptionParser.parse(args, strict: [status: :string, host: :string, secret: :string])

    case positional do
      [event_type, resource_id] ->
        fire(event_type, resource_id, opts)

      _ ->
        Mix.shell().error(
          "Usage: mix webhook.simulate <event_type> <resource_id> [--status=X] [--host=URL] [--secret=...]"
        )

        System.halt(1)
    end
  end

  defp fire(event_type, resource_id, opts) do
    Application.ensure_all_started(:req)
    load_env()

    secret =
      opts[:secret] || System.get_env("ALPACA_WEBHOOK_SECRET") ||
        Mix.raise("ALPACA_WEBHOOK_SECRET not set (use --secret=... or env)")

    host = opts[:host] || "http://localhost:4000"
    url = host <> "/api/webhooks/alpaca"

    payload = build_payload(event_type, resource_id, opts[:status])
    body = Jason.encode!(payload)
    signature = :crypto.mac(:hmac, :sha256, secret, body) |> Base.encode16(case: :lower)

    Mix.shell().info("→ POST #{url}")
    Mix.shell().info("  event_type: #{event_type}")
    Mix.shell().info("  resource_id: #{resource_id}")
    if opts[:status], do: Mix.shell().info("  status: #{opts[:status]}")

    resp =
      Req.post!(url,
        body: body,
        headers: [
          {"content-type", "application/json"},
          {"x-alpaca-signature", signature}
        ]
      )

    Mix.shell().info("← HTTP #{resp.status}")
    if resp.body != "", do: Mix.shell().info("  body: #{inspect(resp.body)}")
  end

  defp build_payload(event_type, resource_id, status) do
    data =
      %{"id" => resource_id}
      |> maybe_put("status", status)

    %{
      "event_id" => "sim-" <> Base.encode16(:crypto.strong_rand_bytes(8), case: :lower),
      "event_type" => event_type,
      "at" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "data" => data
    }
  end

  defp maybe_put(map, _k, nil), do: map
  defp maybe_put(map, k, v), do: Map.put(map, k, v)

  defp load_env do
    [".env"]
    |> Enum.filter(&File.exists?/1)
    |> case do
      [] -> :ok
      files ->
        Dotenvy.source!(files)
        |> Enum.each(fn {k, v} ->
          if System.get_env(k) in [nil, ""], do: System.put_env(k, v)
        end)
    end
  end
end
