defmodule CryptoPortfolioV3Web.Plugs.Auth do
  @moduledoc "Bearer-token plug. Assigns `:current_user` or halts with 401."

  import Plug.Conn

  alias CryptoPortfolioV3.Accounts
  alias CryptoPortfolioV3.Accounts.Token

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, %{"sub" => id}} <- Token.verify(token, jwt_secret()),
         user when not is_nil(user) <- Accounts.get_user(id) do
      assign(conn, :current_user, user)
    else
      _ -> unauthorized(conn)
    end
  end

  defp unauthorized(conn) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(401, Jason.encode!(%{error: "unauthorized"}))
    |> halt()
  end

  defp jwt_secret, do: Application.fetch_env!(:crypto_portfolio_v3, :jwt_secret)
end
