defmodule CryptoPortfolioV3.Portfolios.Transaction do
  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Portfolios.Holding

  @timestamps_opts [type: :utc_datetime_usec]

  schema "transactions" do
    field :type, Ecto.Enum, values: [:buy, :sell]
    field :amount, :decimal
    field :price_usd, :decimal
    field :occurred_at, :utc_datetime_usec
    field :note, :string

    belongs_to :holding, Holding

    timestamps()
  end

  @doc false
  def changeset(transaction, attrs) do
    transaction
    |> cast(attrs, [:holding_id, :type, :amount, :price_usd, :occurred_at, :note])
    |> validate_required([:holding_id, :type, :amount, :price_usd, :occurred_at])
    |> validate_number(:amount, greater_than: 0)
    |> validate_number(:price_usd, greater_than_or_equal_to: 0)
    |> validate_length(:note, max: 500)
    |> foreign_key_constraint(:holding_id)
  end
end
