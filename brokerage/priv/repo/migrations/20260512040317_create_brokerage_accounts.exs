defmodule Brokerage.Repo.Migrations.CreateBrokerageAccounts do
  use Ecto.Migration

  def change do
    # The user → Alpaca customer-account mapping. One row per user; never
    # store KYC data (SSN, DOB, etc.) here — Alpaca is the system of record
    # for that. We only persist references + cached status.
    create table(:brokerage_accounts) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :alpaca_account_id, :string, null: false
      # Alpaca account number ("252797520") — shown to the user; not the UUID.
      add :alpaca_account_number, :string
      # Most recent status seen from Alpaca: SUBMITTED, APPROVED, ACTIVE, ...
      add :status, :string
      # Internal lifecycle: stub, pending, active, failed
      add :kyc_state, :string, null: false, default: "pending"
      add :last_synced_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:brokerage_accounts, [:user_id])
    create unique_index(:brokerage_accounts, [:alpaca_account_id])
    create index(:brokerage_accounts, [:status])

    # Linked banks (one Alpaca ach_relationships row each). Cascade with
    # the parent so deleting a brokerage account cleans up the children.
    create table(:ach_relationships) do
      add :brokerage_account_id, references(:brokerage_accounts, on_delete: :delete_all),
        null: false

      add :alpaca_relationship_id, :string, null: false
      add :nickname, :string
      add :bank_account_type, :string
      # Last 4 of the bank account number — safe to store, useful for UI labels.
      add :bank_last4, :string
      add :status, :string
      add :is_default, :boolean, null: false, default: false
      add :last_synced_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:ach_relationships, [:alpaca_relationship_id])
    create index(:ach_relationships, [:brokerage_account_id])
    # At most one default relationship per account.
    create unique_index(:ach_relationships, [:brokerage_account_id],
             where: "is_default",
             name: :ach_relationships_account_default_index
           )
  end
end
