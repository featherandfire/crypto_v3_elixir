defmodule CryptoPortfolioV3.Emails do
  @moduledoc """
  Builders for the transactional emails the app sends. Each function returns
  a %Swoosh.Email{} — no side effects. Delivery happens via Mailer.deliver/1.
  """

  import Swoosh.Email

  @from_name "abcoins"
  @from_address "noreply@abcoins.xyz"

  @doc """
  Sanity-check email used to verify the SES pipeline before real features
  depend on it. Call from iex or via `bin/crypto_portfolio_v3 eval`:

      CryptoPortfolioV3.Emails.smoke_test("hotheadheather@gmail.com")
      |> CryptoPortfolioV3.Mailer.deliver()
  """
  @spec smoke_test(binary()) :: Swoosh.Email.t()
  def smoke_test(recipient) when is_binary(recipient) do
    new()
    |> to(recipient)
    |> from({@from_name, @from_address})
    |> subject("abcoins — SES smoke test")
    |> text_body("""
    If you're reading this, Amazon SES is wired up correctly.

    — abcoins
    """)
  end

  @doc """
  Email verification — sent after registration. The token is single-use and
  expires after 24 hours; the recipient clicks the link to confirm ownership.
  """
  @spec verification_email(map(), binary()) :: Swoosh.Email.t()
  def verification_email(%{email: email, username: username}, token)
      when is_binary(email) and is_binary(token) do
    link = "https://www.abcoins.xyz/verify?token=#{URI.encode_www_form(token)}"

    new()
    |> to(email)
    |> from({@from_name, @from_address})
    |> subject("abcoins — confirm your email")
    |> text_body("""
    Hi #{username},

    Confirm your email address to finish setting up your abcoins account:

    #{link}

    This link expires in 24 hours. If you didn't sign up, you can ignore this.

    — abcoins
    """)
  end

  @doc """
  Login verification code — sent after a correct password on login. 6-digit
  numeric code, valid for 10 minutes, single-use.
  """
  @spec login_code_email(map(), binary()) :: Swoosh.Email.t()
  def login_code_email(%{email: email, username: username}, code)
      when is_binary(email) and is_binary(code) do
    new()
    |> to(email)
    |> from({@from_name, @from_address})
    |> subject("abcoins — your login code")
    |> text_body("""
    Hi #{username},

    Your login code is: #{code}

    It expires in 10 minutes. If you didn't try to log in, someone may have
    your password — change it immediately.

    — abcoins
    """)
  end
end
