defmodule BrokerageWeb.SpaFallback do
  @moduledoc """
  Serves `priv/static/index.html` for any GET request the API router
  didn't claim. Two consumers:

    * `/` — the page load
    * any deep-link path the SPA might be navigated to directly
      (refresh on a non-root URL, bookmark, share link)

  Non-GET methods and anything under `/api` pass through untouched so
  the API router can 404 normally.
  """

  import Plug.Conn

  def init(opts), do: opts

  # Anything under /api that reached us has no matching route — 404.
  def call(%Plug.Conn{request_path: "/api" <> _} = conn, _opts) do
    conn |> send_resp(404, ~s({"error":"not_found"})) |> halt()
  end

  def call(%Plug.Conn{method: "GET"} = conn, _opts), do: send_index(conn)
  def call(conn, _opts), do: conn |> send_resp(404, "") |> halt()

  # Resolve at runtime — priv_dir at compile time points at the build
  # tree, which doesn't exist in the release image.
  defp index_path do
    Path.join(:code.priv_dir(:brokerage) |> to_string(), "static/index.html")
  end

  defp send_index(conn) do
    case File.read(index_path()) do
      {:ok, html} ->
        conn
        |> put_resp_content_type("text/html")
        |> send_resp(200, html)
        |> halt()

      {:error, _} ->
        # Image was built without the frontend (or running under `mix
        # phx.server` from source). Send a 404 — returning the conn
        # unchanged would crash the request pipeline.
        conn
        |> send_resp(404, "")
        |> halt()
    end
  end
end
