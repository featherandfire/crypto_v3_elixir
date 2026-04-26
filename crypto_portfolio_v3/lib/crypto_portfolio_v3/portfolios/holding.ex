defmodule CryptoPortfolioV3.Portfolios.Holding do
  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Market.Coin
  alias CryptoPortfolioV3.Portfolios.{Portfolio, Transaction}

  @timestamps_opts [type: :utc_datetime_usec]

  schema "holdings" do
    field :wallet_address, :string
    field :amount, :decimal, default: Decimal.new(0)
    field :avg_buy_price, :decimal
    # Chain slug the holding lives on (e.g. "eth", "polygon", "solana"). Set
    # by the wallet-import flow so the API knows which chain to query for
    # transaction history; nullable for legacy rows + manual additions.
    field :chain, :string

    belongs_to :portfolio, Portfolio
    belongs_to :coin, Coin
    has_many :transactions, Transaction

    timestamps()
  end

  @doc false
  def changeset(holding, attrs) do
    holding
    |> cast(attrs, [:portfolio_id, :coin_id, :wallet_address, :chain, :amount, :avg_buy_price])
    |> validate_required([:portfolio_id, :coin_id, :amount])
    |> validate_length(:wallet_address, max: 255)
    |> validate_length(:chain, max: 32)
    |> validate_number(:amount, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:portfolio_id)
    |> foreign_key_constraint(:coin_id)
    |> unique_constraint([:portfolio_id, :coin_id, :wallet_address],
      name: :holdings_portfolio_id_coin_id_wallet_address_index
    )
  end
end
