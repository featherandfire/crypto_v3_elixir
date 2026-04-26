defmodule CryptoPortfolioV3.Repo.Migrations.AddAttemptsToEmailVerifications do
  use Ecto.Migration

  def change do
    alter table(:email_verifications) do
      add :attempts, :integer, null: false, default: 0
    end
  end
end
