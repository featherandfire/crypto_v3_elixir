defmodule CryptoPortfolioV3.Repo.Migrations.CreateUsers do
  use Ecto.Migration

  def change do
    create table(:users) do
      add :username, :string, size: 50, null: false
      add :email, :string, size: 255, null: false
      add :hashed_password, :string, size: 255, null: false
      add :is_verified, :boolean, null: false, default: false

      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:users, [:username])
    create unique_index(:users, [:email])
  end
end
