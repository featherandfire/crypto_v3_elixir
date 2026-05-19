defmodule Brokerage.Repo.Migrations.CreateMockAlpacaPositions do
  use Ecto.Migration

  def change do
    create table(:mock_alpaca_positions) do
      add :alpaca_account_id, :string, null: false
      add :symbol, :string, size: 32, null: false
      add :qty, :decimal, precision: 20, scale: 8, null: false
      add :avg_entry_price, :decimal, precision: 20, scale: 8, null: false

      timestamps()
    end

    create unique_index(:mock_alpaca_positions, [:alpaca_account_id, :symbol])
  end
end
