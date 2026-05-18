defmodule Brokerage.AlpacaWebhooks.Event do
  @moduledoc """
  Idempotency log for Alpaca webhook deliveries. One row per accepted
  event keyed by Alpaca's `event_id` — duplicate deliveries are a no-op.
  `processed_at` flips when the handler finishes; `error` captures any
  exception message so we can replay later.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @timestamps_opts [type: :utc_datetime_usec]

  schema "alpaca_webhook_events" do
    field :event_id, :string
    field :event_type, :string
    field :payload, :map
    field :received_at, :utc_datetime_usec
    field :processed_at, :utc_datetime_usec
    field :error, :string

    timestamps()
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [:event_id, :event_type, :payload, :received_at, :processed_at, :error])
    |> validate_required([:event_id, :event_type, :payload, :received_at])
    |> unique_constraint(:event_id)
  end
end
