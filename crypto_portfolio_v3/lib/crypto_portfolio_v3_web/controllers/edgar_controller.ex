defmodule CryptoPortfolioV3Web.EdgarController do
  @moduledoc """
  Pass-through to `CryptoPortfolioV3.Edgar` for SEC 8-K risk findings.
  Auth-gated alongside the rest of the brokerage endpoints.
  """
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.Edgar

  def risk(conn, %{"symbols" => csv}) when is_binary(csv) do
    syms =
      csv
      |> String.split(",", trim: true)
      |> Enum.map(&(&1 |> String.trim() |> String.upcase()))
      |> Enum.reject(&(&1 == ""))
      |> Enum.take(200)

    case syms do
      [] ->
        conn |> put_status(:bad_request) |> json(%{error: "no symbols provided"})

      list ->
        case Edgar.risk(list) do
          {:ok, body} ->
            json(conn, body)

          {:error, reason} ->
            conn
            |> put_status(:bad_gateway)
            |> json(%{error: "edgar_error", reason: inspect(reason)})
        end
    end
  end

  def risk(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "missing symbols"})
end
