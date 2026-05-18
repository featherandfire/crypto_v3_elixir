defmodule CryptoPortfolioV3.Repo.Migrations.CreateRecurringInvestments do
  use Ecto.Migration

  # User-configured "set and forget" buys. The scheduler GenServer walks
  # this table on a tick interval and fires market-buy orders for every
  # row whose next_run_at has passed and is_active = true.
  #
  # Frequencies stored as a label (daily | weekly | biweekly | monthly)
  # so the UI can render a friendly cadence; next_run_at is the source
  # of truth for when to fire (scheduler advances it by the cadence
  # after each execution).
  def change do
    create table(:recurring_investments) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :symbol, :string, null: false
      add :qty, :decimal, precision: 20, scale: 8, null: false
      add :side, :string, default: "buy", null: false
      add :order_type, :string, default: "market", null: false
      add :time_in_force, :string, default: "day", null: false
      add :limit_price, :decimal, precision: 20, scale: 8
      add :frequency, :string, null: false
      # First scheduled run + the next future run after each fill.
      add :starts_at, :utc_datetime_usec, null: false
      add :next_run_at, :utc_datetime_usec, null: false
      add :last_run_at, :utc_datetime_usec
      add :is_active, :boolean, default: true, null: false
      # Audit — IP from which the user authorized this schedule, so we
      # can prove user-direction the same way wishlist_items do.
      add :authorized_at, :utc_datetime_usec, null: false
      add :authorized_ip, :string

      timestamps(type: :utc_datetime_usec)
    end

    # Scheduler reads "active rows with next_run_at <= now" on every
    # tick — this index keeps that hot path cheap.
    create index(:recurring_investments, [:is_active, :next_run_at])
    create index(:recurring_investments, [:user_id])
  end
end
