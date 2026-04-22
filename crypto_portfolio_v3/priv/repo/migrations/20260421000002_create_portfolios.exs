defmodule CryptoPortfolioV3.Repo.Migrations.CreatePortfolios do
  use Ecto.Migration

  def change do
    create table(:portfolios) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :name, :string, size: 100, null: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:portfolios, [:user_id, :name])
  end
end
