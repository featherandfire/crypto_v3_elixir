defmodule Brokerage.Repo.Migrations.DropCryptoTables do
  use Ecto.Migration

  def change do
    drop_if_exists table(:transactions)
    drop_if_exists table(:holdings)
    drop_if_exists table(:coingecko_yearly_stats)
    drop_if_exists table(:cryptocompare_pct_changes)
    drop_if_exists table(:portfolios)
    drop_if_exists table(:coins)
  end
end
