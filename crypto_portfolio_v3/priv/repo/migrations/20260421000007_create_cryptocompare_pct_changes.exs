defmodule CryptoPortfolioV3.Repo.Migrations.CreateCryptocomparePctChanges do
  use Ecto.Migration

  def change do
    create table(:cryptocompare_pct_changes) do
      add :symbol, :string, size: 20, null: false
      add :days, :integer, null: false
      add :pct_change, :decimal, precision: 18, scale: 4
      add :fetched_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:cryptocompare_pct_changes, [:symbol, :days])
  end
end
