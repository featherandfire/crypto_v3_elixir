defmodule CryptoPortfolioV3Web.AuthController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.{Accounts, Emails, Mailer}
  alias CryptoPortfolioV3.Accounts.{Token, User}
  alias CryptoPortfolioV3Web.Serializer

  require Logger

  def register(conn, params) do
    case Accounts.register_user(params) do
      {:ok, user} ->
        send_verification_code(user)

        conn
        |> put_status(:created)
        |> json(%{
          user: Serializer.user(user),
          message: "Account created. Check your email for a 6-digit verification code."
        })

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: translate_errors(cs)})
    end
  end

  def verify_email(conn, %{"identifier" => id, "code" => code})
      when is_binary(id) and is_binary(code) do
    user = Accounts.get_user_by_identifier(id)

    case user && Accounts.verify_code(user, code) do
      {:ok, verified_user} ->
        json(conn, %{user: Serializer.user(verified_user), token: issue_token(verified_user)})

      {:error, :expired} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "code_expired"})

      {:error, :too_many_attempts} ->
        conn
        |> put_status(:too_many_requests)
        |> json(%{error: "too_many_attempts"})

      {:error, :already_verified} ->
        conn
        |> put_status(:conflict)
        |> json(%{error: "already_verified"})

      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid_code"})
    end
  end

  def verify_email(conn, _) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "missing identifier or code"})
  end

  def resend_code(conn, %{"identifier" => id}) when is_binary(id) do
    case Accounts.resend_verification_code(id) do
      {:ok, code, user} ->
        user |> Emails.verification_email(code) |> Mailer.deliver()
        json(conn, %{message: "Verification code sent."})

      {:error, :already_verified} ->
        conn
        |> put_status(:conflict)
        |> json(%{error: "already_verified"})

      {:error, {:throttled, seconds}} ->
        conn
        |> put_status(:too_many_requests)
        |> put_resp_header("retry-after", Integer.to_string(seconds))
        |> json(%{error: "throttled", retry_after: seconds})

      # :user_not_found collapses into the same generic 200 response to avoid
      # account-enumeration via the resend endpoint.
      {:error, :user_not_found} ->
        json(conn, %{message: "Verification code sent."})

      {:error, _} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: "resend_failed"})
    end
  end

  def resend_code(conn, _) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "missing identifier"})
  end

  def login(conn, %{"identifier" => id, "password" => pw}) do
    case Accounts.authenticate(id, pw) do
      {:ok, %User{is_verified: false}} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "email_not_verified"})

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

  defp send_verification_code(%User{} = user) do
    with {:ok, code, _} <- Accounts.create_verification_code(user),
         {:ok, _} <- user |> Emails.verification_email(code) |> Mailer.deliver() do
      :ok
    else
      {:error, reason} ->
        Logger.error("Failed to send verification email for user #{user.id}: #{inspect(reason)}")
        :error
    end
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
