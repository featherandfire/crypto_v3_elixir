defmodule CryptoPortfolioV3.Market.PctChange do
  use Ecto.Schema
  import Ecto.Changeset

  @timestamps_opts [type: :utc_datetime_usec]

  schema "cryptocompare_pct_changes" do
    field :symbol, :string
    field :days, :integer
    field :pct_change, :decimal
    field :fetched_at, :utc_datetime_usec

    timestamps()
  end

  def changeset(rec, attrs) do
    rec
    |> cast(attrs, [:symbol, :days, :pct_change, :fetched_at])
    |> validate_required([:symbol, :days, :fetched_at])
    |> update_change(:symbol, &upcase/1)
    |> unique_constraint([:symbol, :days], name: :cryptocompare_pct_changes_symbol_days_index)
  end

  defp upcase(nil), do: nil
  defp upcase(s) when is_binary(s), do: String.upcase(s)
end
