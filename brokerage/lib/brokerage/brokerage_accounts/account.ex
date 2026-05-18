defmodule Brokerage.BrokerageAccounts.Account do
  @moduledoc """
  Local mirror of the user's Alpaca customer account. We persist only
  pointers + cached status — never KYC data (SSN, DOB, address). Alpaca
  is the system of record for that.

  Lifecycle:
    kyc_state: pending → active   on Alpaca status flipping to ACTIVE
                       → failed    on Alpaca rejection
                       → stub      when sandbox auto-create runs without
                                   real customer KYC (test fixtures)
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Brokerage.Accounts.User
  alias Brokerage.BrokerageAccounts.AchRelationship

  @timestamps_opts [type: :utc_datetime_usec]

  schema "brokerage_accounts" do
    field :alpaca_account_id, :string
    field :alpaca_account_number, :string
    field :status, :string
    field :kyc_state, :string, default: "pending"
    field :last_synced_at, :utc_datetime_usec

    belongs_to :user, User
    has_many :ach_relationships, AchRelationship, foreign_key: :brokerage_account_id

    timestamps()
  end

  def changeset(account, attrs) do
    account
    |> cast(attrs, [
      :user_id,
      :alpaca_account_id,
      :alpaca_account_number,
      :status,
      :kyc_state,
      :last_synced_at
    ])
    |> validate_required([:user_id, :alpaca_account_id])
    |> foreign_key_constraint(:user_id)
    |> unique_constraint(:user_id)
    |> unique_constraint(:alpaca_account_id)
  end
end
