defmodule CryptoPortfolioV3.Repo.Migrations.CreateCoins do
  use Ecto.Migration

  def change do
    create table(:coins) do
      add :coingecko_id, :string, size: 100, null: false
      add :symbol, :string, size: 20, null: false
      add :name, :string, size: 100, null: false
      add :current_price_usd, :decimal, precision: 38, scale: 8
      add :price_change_24h, :decimal, precision: 38, scale: 8
      add :market_cap, :decimal, precision: 38, scale: 2
      add :image_url, :string, size: 500
      add :last_updated, :utc_datetime_usec
      add :circulating_supply, :decimal, precision: 38, scale: 8
      add :max_supply, :decimal, precision: 38, scale: 8
      add :contract_address, :string, size: 255

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:coins, [:coingecko_id])
    create index(:coins, [:symbol])
  end
end
