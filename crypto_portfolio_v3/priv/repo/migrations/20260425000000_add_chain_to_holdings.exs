defmodule CryptoPortfolioV3.Repo.Migrations.AddChainToHoldings do
  use Ecto.Migration

  def change do
    alter table(:holdings) do
      add :chain, :string
    end
  end
end
