defmodule CryptoPortfolioV3.Market.Coin do
  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Portfolios.Holding

  @timestamps_opts [type: :utc_datetime_usec]

  schema "coins" do
    field :coingecko_id, :string
    field :symbol, :string
    field :name, :string
    field :current_price_usd, :decimal
    field :price_change_24h, :decimal
    field :market_cap, :decimal
    field :image_url, :string
    field :last_updated, :utc_datetime_usec
    field :circulating_supply, :decimal
    field :max_supply, :decimal
    field :contract_address, :string

    has_many :holdings, Holding

    timestamps()
  end

  @doc false
  def changeset(coin, attrs) do
    coin
    |> cast(attrs, [
      :coingecko_id,
      :symbol,
      :name,
      :current_price_usd,
      :price_change_24h,
      :market_cap,
      :image_url,
      :last_updated,
      :circulating_supply,
      :max_supply,
      :contract_address
    ])
    |> validate_required([:coingecko_id, :symbol, :name])
    |> validate_length(:coingecko_id, max: 100)
    |> validate_length(:symbol, max: 20)
    |> validate_length(:name, max: 100)
    |> validate_length(:image_url, max: 500)
    |> validate_length(:contract_address, max: 255)
    |> unique_constraint(:coingecko_id)
  end
end
