defmodule CryptoPortfolioV3Web.InternalController do
  @moduledoc """
  One-off verification endpoints used during infrastructure bring-up.

  Gated by a shared secret `INTERNAL_SMOKE_TOKEN` so it isn't world-callable
  while it exists. Routes in this module should be deleted in a follow-up
  commit once the piece they verify is live.
  """
  use CryptoPortfolioV3Web, :controller

  def ses_smoke(conn, %{"to" => to} = params) do
    with :ok <- check_token(params) do
      result =
        to
        |> CryptoPortfolioV3.Emails.smoke_test()
        |> CryptoPortfolioV3.Mailer.deliver()

      json(conn, %{result: inspect(result)})
    else
      {:error, status, msg} ->
        conn |> put_status(status) |> json(%{error: msg})
    end
  end

  defp check_token(%{"token" => t}) do
    expected = System.get_env("INTERNAL_SMOKE_TOKEN")

    cond do
      is_nil(expected) or expected == "" ->
        {:error, :service_unavailable, "INTERNAL_SMOKE_TOKEN not configured"}

      Plug.Crypto.secure_compare(t, expected) ->
        :ok

      true ->
        {:error, :unauthorized, "bad token"}
    end
  end

  defp check_token(_), do: {:error, :unauthorized, "token required"}
end
