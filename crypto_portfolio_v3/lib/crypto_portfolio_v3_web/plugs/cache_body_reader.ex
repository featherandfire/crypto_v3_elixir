defmodule CryptoPortfolioV3Web.Plugs.CacheBodyReader do
  @moduledoc """
  Custom `Plug.Parsers` body reader that stashes the raw request body
  in `conn.assigns[:raw_body]` *before* JSON decoding. Required for
  webhook endpoints that verify an HMAC signature over the unparsed
  bytes — once Phoenix decodes the body, the byte-exact original is
  unrecoverable.

  Scoped to webhook paths via `Plug.Parsers`'s `body_reader` option +
  a path check, so the rest of the app pays no overhead.
  """

  @webhook_path_prefix "/api/webhooks/"

  def read_body(conn, opts) do
    {:ok, body, conn} = Plug.Conn.read_body(conn, opts)

    conn =
      if String.starts_with?(conn.request_path, @webhook_path_prefix) do
        Plug.Conn.assign(conn, :raw_body, body)
      else
        conn
      end

    {:ok, body, conn}
  end
end
