defmodule CryptoPortfolioV3.Accounts do
  @moduledoc "User registration, lookup, and password authentication."

  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.Accounts.User

  def register_user(attrs) do
    %User{}
    |> User.registration_changeset(attrs)
    |> Repo.insert()
  end

  def get_user(id), do: Repo.get(User, id)

  @doc """
  Authenticate by email or username. Always runs bcrypt (even when the user
  is not found) so response timing doesn't leak account existence.
  """
  def authenticate(identifier, password)
      when is_binary(identifier) and is_binary(password) do
    user =
      Repo.one(
        from u in User,
          where: u.email == ^identifier or u.username == ^identifier
      )

    cond do
      is_nil(user) ->
        Bcrypt.no_user_verify()
        {:error, :invalid_credentials}

      Bcrypt.verify_pass(password, user.hashed_password) ->
        {:ok, user}

      true ->
        {:error, :invalid_credentials}
    end
  end

  def authenticate(_, _), do: {:error, :invalid_credentials}
end
