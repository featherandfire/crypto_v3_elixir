defmodule Brokerage.Repo.Migrations.CreateAlpacaWebhookEvents do
  use Ecto.Migration

  def change do
    # Every Alpaca webhook we accept lands here first. The `event_id`
    # unique index gives us idempotency — duplicate deliveries are a
    # no-op. `processed_at` flips when the handler runs successfully;
    # `error` captures the message if a handler crashes so we can
    # replay failed events later.
    create table(:alpaca_webhook_events) do
      add :event_id, :string, null: false
      add :event_type, :string, null: false
      add :payload, :map, null: false
      add :received_at, :utc_datetime_usec, null: false
      add :processed_at, :utc_datetime_usec
      add :error, :text

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:alpaca_webhook_events, [:event_id])
    create index(:alpaca_webhook_events, [:event_type])
    create index(:alpaca_webhook_events, [:processed_at])
  end
end
