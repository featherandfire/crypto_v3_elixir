defmodule CryptoPortfolioV3.Accounts.PasswordReset do
  @moduledoc """
  One row per password-reset code issued to a user. `code_hash` is a bcrypt
  hash — the plain 6-digit code is emailed once at creation and never stored.
  `consumed_at` is set when the code is successfully redeemed and the password
  rotated.
  """
  use Ecto.Schema

  alias CryptoPortfolioV3.Accounts.User

  @timestamps_opts [type: :utc_datetime_usec]

  schema "password_resets" do
    field :code_hash, :string, redact: true
    field :expires_at, :utc_datetime_usec
    field :consumed_at, :utc_datetime_usec
    field :attempts, :integer, default: 0

    belongs_to :user, User

    timestamps()
  end
end
