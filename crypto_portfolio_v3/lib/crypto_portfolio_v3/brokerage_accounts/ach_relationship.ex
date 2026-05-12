defmodule CryptoPortfolioV3.BrokerageAccounts.AchRelationship do
  @moduledoc """
  Linked-bank record. Mirrors Alpaca's `ach_relationships` resource —
  the routing/account numbers themselves live at Alpaca; we only store
  the UUID, the last 4 of the account number, and the cached status.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.BrokerageAccounts.Account

  @timestamps_opts [type: :utc_datetime_usec]

  schema "ach_relationships" do
    field :alpaca_relationship_id, :string
    field :nickname, :string
    field :bank_account_type, :string
    field :bank_last4, :string
    field :status, :string
    field :is_default, :boolean, default: false
    field :last_synced_at, :utc_datetime_usec

    belongs_to :account, Account, foreign_key: :brokerage_account_id

    timestamps()
  end

  def changeset(rel, attrs) do
    rel
    |> cast(attrs, [
      :brokerage_account_id,
      :alpaca_relationship_id,
      :nickname,
      :bank_account_type,
      :bank_last4,
      :status,
      :is_default,
      :last_synced_at
    ])
    |> validate_required([:brokerage_account_id, :alpaca_relationship_id])
    |> foreign_key_constraint(:brokerage_account_id)
    |> unique_constraint(:alpaca_relationship_id)
    |> unique_constraint(:brokerage_account_id,
      name: :ach_relationships_account_default_index,
      message: "an account can have at most one default ACH relationship"
    )
  end
end
