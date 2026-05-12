defmodule CryptoPortfolioV3.BrokeragePortfolios.Portfolio do
  @moduledoc """
  User-defined buckets for grouping stock positions on the brokerage side.
  Distinct from `CryptoPortfolioV3.Portfolios.Portfolio`, which is the
  crypto-side concept. One row per user-named bucket; the user's main /
  starter portfolio carries `is_main: true`.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Accounts.User

  @timestamps_opts [type: :utc_datetime_usec]

  schema "brokerage_portfolios" do
    field :name, :string
    field :color, :string, default: "#b44dff"
    field :is_main, :boolean, default: false

    belongs_to :user, User

    timestamps()
  end

  def changeset(portfolio, attrs) do
    portfolio
    |> cast(attrs, [:name, :color, :is_main, :user_id])
    |> validate_required([:name, :user_id])
    |> validate_length(:name, max: 100)
    |> validate_format(:color, ~r/^#[0-9a-fA-F]{6}$/,
      message: "must be a 6-digit hex color"
    )
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:user_id, :name],
      name: :brokerage_portfolios_user_id_name_index,
      message: "you already have a portfolio with this name"
    )
  end
end
