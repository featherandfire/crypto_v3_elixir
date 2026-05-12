defmodule CryptoPortfolioV3.BrokeragePortfolios.PositionAllocation do
  @moduledoc """
  Splits a single Alpaca position across the user's brokerage portfolios.
  One row per (portfolio_id, symbol) — sum of `qty` across rows for a
  symbol equals the user's total holding for that ticker. Cascade-deleted
  with the parent portfolio.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.BrokeragePortfolios.Portfolio

  @timestamps_opts [type: :utc_datetime_usec]

  schema "position_allocations" do
    field :symbol, :string
    field :qty, :decimal

    belongs_to :portfolio, Portfolio

    timestamps()
  end

  def changeset(alloc, attrs) do
    alloc
    |> cast(attrs, [:symbol, :qty, :portfolio_id])
    |> validate_required([:symbol, :qty, :portfolio_id])
    |> validate_length(:symbol, max: 32)
    |> validate_number(:qty, greater_than_or_equal_to: 0)
    |> foreign_key_constraint(:portfolio_id)
    |> unique_constraint([:portfolio_id, :symbol])
  end
end
