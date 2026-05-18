defmodule CryptoPortfolioV3.BrokerFunding.Deposit do
  @moduledoc """
  Stub record of a customer-initiated deposit. Holds the *intent* —
  amount, source-bank label, and method — until the real Broker API
  integration replaces it with a live transfer call.

  status transitions: pending → completed | failed (no real ACH yet, so
  rows stay pending unless we mark them otherwise from a future job).
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Accounts.User

  @timestamps_opts [type: :utc_datetime_usec]

  @methods ~w(ach wire instant)
  @statuses ~w(pending completed failed)
  @directions ~w(INCOMING OUTGOING)

  schema "broker_deposits" do
    field :amount, :decimal
    field :method, :string
    field :bank_label, :string
    field :reference, :string
    field :status, :string, default: "pending"
    field :note, :string
    # INCOMING = deposit (user → brokerage), OUTGOING = withdrawal
    # (brokerage → user). Both flow through the same Alpaca endpoint
    # so we keep them in one table and filter by direction.
    field :direction, :string, default: "INCOMING"
    # Portion of the deposit Alpaca made available immediately (instant
    # funding). Null when not eligible or not applicable.
    field :instant_amount, :decimal

    belongs_to :user, User

    timestamps()
  end

  def changeset(deposit, attrs) do
    deposit
    |> cast(attrs, [
      :user_id,
      :amount,
      :method,
      :bank_label,
      :reference,
      :status,
      :note,
      :direction,
      :instant_amount
    ])
    |> validate_required([:user_id, :amount, :method, :bank_label, :reference])
    |> validate_inclusion(:method, @methods)
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:direction, @directions)
    |> validate_number(:amount, greater_than: 0)
    |> assoc_constraint(:user)
  end
end
