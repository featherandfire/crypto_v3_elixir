defmodule CryptoPortfolioV3.Repo.Migrations.CreateHoldings do
  use Ecto.Migration

  def change do
    create table(:holdings) do
      add :portfolio_id, references(:portfolios, on_delete: :delete_all), null: false
      add :coin_id, references(:coins, on_delete: :delete_all), null: false
      add :wallet_address, :string, size: 255
      add :amount, :decimal, precision: 38, scale: 18, null: false, default: 0
      add :avg_buy_price, :decimal, precision: 38, scale: 8

      timestamps(type: :utc_datetime_usec)
    end

    # NULLS NOT DISTINCT: treat missing wallet_address as a value, so a single
    # "no wallet" holding is enforced per (portfolio, coin). Postgres 15+.
    create unique_index(
             :holdings,
             [:portfolio_id, :coin_id, :wallet_address],
             nulls_distinct: false
           )

    create index(:holdings, [:coin_id])
  end
end
