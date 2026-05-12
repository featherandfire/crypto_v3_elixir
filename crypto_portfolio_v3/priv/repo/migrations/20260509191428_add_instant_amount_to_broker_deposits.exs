defmodule CryptoPortfolioV3.Repo.Migrations.AddInstantAmountToBrokerDeposits do
  use Ecto.Migration

  def change do
    alter table(:broker_deposits) do
      add :instant_amount, :decimal, precision: 14, scale: 2
    end
  end
end
