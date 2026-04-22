defmodule CryptoPortfolioV3Web.FallbackController do
  @moduledoc """
  Translates `{:error, _}` tuples returned from controllers into HTTP
  responses. Wired via `action_fallback/1` in controllers.
  """

  use CryptoPortfolioV3Web, :controller

  def call(conn, {:error, :not_found}),
    do: conn |> put_status(:not_found) |> json(%{error: "not_found"})

  def call(conn, {:error, :not_found, resource}),
    do: conn |> put_status(:not_found) |> json(%{error: "#{resource} not found"})

  def call(conn, {:error, :coin_not_found}) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "coin not found — import or create it first"})
  end

  def call(conn, {:error, :missing_coingecko_id}) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "coingecko_id is required"})
  end

  def call(conn, {:error, %Ecto.Changeset{} = cs}) do
    status = if unique_violation?(cs), do: :conflict, else: :unprocessable_entity

    conn
    |> put_status(status)
    |> json(%{errors: translate_errors(cs)})
  end

  defp unique_violation?(cs) do
    Enum.any?(cs.errors, fn {_f, {_m, opts}} ->
      Keyword.get(opts, :constraint) == :unique
    end)
  end

  defp translate_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
