defmodule CryptoPortfolioV3.Repo.Migrations.CreateBrokerDeposits do
  use Ecto.Migration

  def change do
    create table(:broker_deposits) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :amount, :decimal, precision: 14, scale: 2, null: false
      add :method, :string, null: false
      add :bank_label, :string, null: false
      add :reference, :string, null: false
      add :status, :string, null: false, default: "pending"
      add :note, :string

      timestamps(type: :utc_datetime_usec)
    end

    create index(:broker_deposits, [:user_id])
    create index(:broker_deposits, [:status])
  end
end
