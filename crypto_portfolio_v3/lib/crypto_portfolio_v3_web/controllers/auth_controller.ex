defmodule CryptoPortfolioV3Web.AuthController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Accounts
  alias CryptoPortfolioV3.Accounts.{Token, User}
  alias CryptoPortfolioV3Web.Serializer

  def register(conn, params) do
    case Accounts.register_user(params) do
      {:ok, user} ->
        conn
        |> put_status(:created)
        |> json(%{user: Serializer.user(user), token: issue_token(user)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: translate_errors(cs)})
    end
  end

  def login(conn, %{"identifier" => id, "password" => pw}) do
    case Accounts.authenticate(id, pw) do
      {:ok, user} ->
        json(conn, %{user: Serializer.user(user), token: issue_token(user)})

      {:error, :invalid_credentials} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid_credentials"})
    end
  end

  def login(conn, _) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "missing identifier or password"})
  end

  def me(conn, _) do
    json(conn, %{user: Serializer.user(conn.assigns.current_user)})
  end

  defp issue_token(%User{id: id}) do
    Token.sign(
      %{"sub" => id},
      Application.fetch_env!(:crypto_portfolio_v3, :jwt_secret),
      Application.fetch_env!(:crypto_portfolio_v3, :jwt_ttl_seconds)
    )
  end

  defp translate_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
