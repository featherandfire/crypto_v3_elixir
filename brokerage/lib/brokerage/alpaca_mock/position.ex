defmodule Brokerage.AlpacaMock.Position do
  @moduledoc """
  Persisted mock-position row. Only written by AlpacaMock.Server when
  ALPACA_MOCK=1; lets the mock survive Phoenix restarts without losing
  the positions the user built up via order fills.
  """

  use Ecto.Schema
  import Ecto.Changeset

  schema "mock_alpaca_positions" do
    field :alpaca_account_id, :string
    field :symbol, :string
    field :qty, :decimal
    field :avg_entry_price, :decimal

    timestamps()
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [:alpaca_account_id, :symbol, :qty, :avg_entry_price])
    |> validate_required([:alpaca_account_id, :symbol, :qty, :avg_entry_price])
  end
end
