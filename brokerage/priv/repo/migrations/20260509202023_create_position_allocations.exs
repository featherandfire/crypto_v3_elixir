defmodule Brokerage.Repo.Migrations.CreatePositionAllocations do
  use Ecto.Migration

  def change do
    create table(:position_allocations) do
      add :portfolio_id, references(:brokerage_portfolios, on_delete: :delete_all), null: false
      add :symbol, :string, null: false, size: 32
      # 20.8 covers any reasonable share count, including Alpaca's 9-digit
      # fractional shares for high-priced names.
      add :qty, :decimal, precision: 20, scale: 8, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:position_allocations, [:portfolio_id, :symbol])
    create index(:position_allocations, [:symbol])
  end
end
