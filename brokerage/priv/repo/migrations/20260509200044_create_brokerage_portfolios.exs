defmodule Brokerage.Repo.Migrations.CreateBrokeragePortfolios do
  use Ecto.Migration

  def change do
    create table(:brokerage_portfolios) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :name, :string, null: false
      add :color, :string, null: false, default: "#b44dff"
      # The user's "main" / starter portfolio. Hidden from the chip strip
      # in the UI and the destination for external Add-Funds deposits.
      # Auto-created on first GET by the index endpoint when the user has
      # zero portfolios.
      add :is_main, :boolean, null: false, default: false

      timestamps(type: :utc_datetime_usec)
    end

    create index(:brokerage_portfolios, [:user_id])

    create unique_index(:brokerage_portfolios, [:user_id, :name],
             name: :brokerage_portfolios_user_id_name_index)

    # At most one main portfolio per user — enforced at the DB level so
    # the auto-create-on-empty path can't double-seed under a race.
    create unique_index(:brokerage_portfolios, [:user_id],
             where: "is_main",
             name: :brokerage_portfolios_user_id_main_index)
  end
end
