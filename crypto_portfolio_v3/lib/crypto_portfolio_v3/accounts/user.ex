defmodule CryptoPortfolioV3.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Portfolios.Portfolio

  @timestamps_opts [type: :utc_datetime_usec]

  schema "users" do
    field :username, :string
    field :email, :string
    field :password, :string, virtual: true, redact: true
    field :hashed_password, :string, redact: true
    field :is_verified, :boolean, default: false

    has_many :portfolios, Portfolio

    timestamps()
  end

  @doc """
  Changeset for registration. Accepts the virtual `:password`, validates,
  and hashes it into `:hashed_password`.
  """
  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :email, :password])
    |> validate_required([:username, :email, :password])
    |> validate_length(:username, min: 3, max: 50)
    |> validate_length(:email, max: 255)
    |> validate_format(:email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    |> validate_length(:password, min: 8, max: 72)
    |> unique_constraint(:username)
    |> unique_constraint(:email)
    |> put_password_hash()
  end

  @doc "Profile changeset — no password changes. Use `change_password_changeset/2` for that."
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :email, :is_verified])
    |> validate_required([:username, :email])
    |> validate_length(:username, min: 3, max: 50)
    |> validate_length(:email, max: 255)
    |> validate_format(:email, ~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    |> unique_constraint(:username)
    |> unique_constraint(:email)
  end

  defp put_password_hash(%Ecto.Changeset{valid?: true, changes: %{password: pw}} = cs) do
    cs
    |> put_change(:hashed_password, Bcrypt.hash_pwd_salt(pw))
    |> delete_change(:password)
  end

  defp put_password_hash(cs), do: cs
end
