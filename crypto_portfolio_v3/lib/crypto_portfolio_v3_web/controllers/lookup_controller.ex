defmodule CryptoPortfolioV3Web.LookupController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Chain.Lookup

  def show(conn, %{"hash" => hash}) do
    h = String.trim(hash || "")

    cond do
      h == "" ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Empty input"})

      byte_size(h) > 200 ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Input too long"})

      true ->
        json(conn, Lookup.lookup(h))
    end
  end
end
