defmodule CryptoPortfolioV3.Repo.Migrations.AddDirectionToBrokerDeposits do
  use Ecto.Migration

  # Broker transfers go both ways — the same Alpaca endpoint
  # (POST /v1/accounts/{id}/transfers) handles deposits (INCOMING) and
  # withdrawals (OUTGOING) via a `direction` field. We were only writing
  # deposits, so existing rows are all INCOMING. Add the column with a
  # default so the schema can persist withdrawals in the same table.
  def change do
    alter table(:broker_deposits) do
      add :direction, :string, null: false, default: "INCOMING"
    end

    # Filter every list-by-direction query through an index — small table
    # today but it scales the same way the by-user queries do.
    create index(:broker_deposits, [:user_id, :direction])
  end
end
