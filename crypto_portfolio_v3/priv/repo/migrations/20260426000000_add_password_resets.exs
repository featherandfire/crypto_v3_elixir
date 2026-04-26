defmodule CryptoPortfolioV3.Repo.Migrations.AddPasswordResets do
  use Ecto.Migration

  def change do
    create table(:password_resets) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :code_hash, :string, null: false
      add :expires_at, :utc_datetime_usec, null: false
      add :consumed_at, :utc_datetime_usec
      add :attempts, :integer, null: false, default: 0

      timestamps(type: :utc_datetime_usec)
    end

    create index(:password_resets, [:user_id, :consumed_at])
  end
end
