defmodule CryptoPortfolioV3.Repo.Migrations.CreateTransactions do
  use Ecto.Migration

  def change do
    create table(:transactions) do
      add :holding_id, references(:holdings, on_delete: :delete_all), null: false
      add :type, :string, null: false
      add :amount, :decimal, precision: 38, scale: 18, null: false
      add :price_usd, :decimal, precision: 38, scale: 8, null: false
      add :occurred_at, :utc_datetime_usec, null: false
      add :note, :string, size: 500

      timestamps(type: :utc_datetime_usec)
    end

    create index(:transactions, [:holding_id])
    create index(:transactions, [:occurred_at])
  end
end
