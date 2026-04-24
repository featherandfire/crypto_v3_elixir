defmodule CryptoPortfolioV3.Accounts.EmailVerification do
  @moduledoc """
  One row per verification code issued to a user. The `code_hash` field is
  a bcrypt hash — the plain 6-digit code is emailed once at creation time
  and never stored.

  `consumed_at` is set when a code is successfully redeemed. An unexpired,
  unconsumed row is what `verify_code/2` looks for.
  """
  use Ecto.Schema

  alias CryptoPortfolioV3.Accounts.User

  @timestamps_opts [type: :utc_datetime_usec]

  schema "email_verifications" do
    field :code_hash, :string, redact: true
    field :expires_at, :utc_datetime_usec
    field :consumed_at, :utc_datetime_usec
    field :attempts, :integer, default: 0

    belongs_to :user, User

    timestamps()
  end
end
