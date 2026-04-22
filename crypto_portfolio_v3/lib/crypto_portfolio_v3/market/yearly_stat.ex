defmodule CryptoPortfolioV3.Market.YearlyStat do
  use Ecto.Schema
  import Ecto.Changeset

  @timestamps_opts [type: :utc_datetime_usec]

  schema "coingecko_yearly_stats" do
    field :coingecko_id, :string
    field :high_1y, :decimal
    field :low_1y, :decimal
    field :vol_90d, :decimal
    field :vol_180d, :decimal
    field :vol_365d, :decimal
    field :fetched_at, :utc_datetime_usec

    timestamps()
  end

  def changeset(stat, attrs) do
    stat
    |> cast(attrs, [
      :coingecko_id,
      :high_1y,
      :low_1y,
      :vol_90d,
      :vol_180d,
      :vol_365d,
      :fetched_at
    ])
    |> validate_required([:coingecko_id, :fetched_at])
    |> unique_constraint(:coingecko_id)
  end
end
