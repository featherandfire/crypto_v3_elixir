defmodule CryptoPortfolioV3.Portfolios.Portfolio do
  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Accounts.User
  alias CryptoPortfolioV3.Portfolios.Holding

  @timestamps_opts [type: :utc_datetime_usec]

  schema "portfolios" do
    field :name, :string

    belongs_to :user, User
    has_many :holdings, Holding

    timestamps()
  end

  @doc false
  def changeset(portfolio, attrs) do
    portfolio
    |> cast(attrs, [:name, :user_id])
    |> validate_required([:name, :user_id])
    |> validate_length(:name, max: 100)
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:user_id, :name], name: :portfolios_user_id_name_index)
  end
end
