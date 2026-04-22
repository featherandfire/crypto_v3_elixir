defmodule CryptoPortfolioV3.Repo.Migrations.CreateCoingeckoYearlyStats do
  use Ecto.Migration

  def change do
    create table(:coingecko_yearly_stats) do
      add :coingecko_id, :string, size: 100, null: false
      add :high_1y, :decimal, precision: 38, scale: 8
      add :low_1y, :decimal, precision: 38, scale: 8
      add :vol_90d, :decimal, precision: 18, scale: 6
      add :vol_180d, :decimal, precision: 18, scale: 6
      add :vol_365d, :decimal, precision: 18, scale: 6
      add :fetched_at, :utc_datetime_usec, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:coingecko_yearly_stats, [:coingecko_id])
  end
end
