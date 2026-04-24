defmodule CryptoPortfolioV3.Repo.Migrations.AddEmailVerifications do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :email_verified_at, :utc_datetime_usec
    end

    create table(:email_verifications) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :code_hash, :string, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :consumed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    # Single index covering the common lookup: "any unconsumed code for user X".
    create index(:email_verifications, [:user_id, :consumed_at])
  end
end
