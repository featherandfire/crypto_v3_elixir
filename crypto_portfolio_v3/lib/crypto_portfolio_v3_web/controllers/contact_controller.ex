defmodule CryptoPortfolioV3Web.ContactController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.{Emails, Mailer}

  @max_field_length 5000

  def submit(conn, params) do
    with {:ok, form} <- validate(params),
         {:ok, _} <- form |> Emails.contact_form_email() |> Mailer.deliver() do
      json(conn, %{ok: true})
    else
      {:error, :invalid, msg} ->
        conn |> put_status(:bad_request) |> json(%{error: msg})

      {:error, _reason} ->
        conn |> put_status(:bad_gateway) |> json(%{error: "delivery_failed"})
    end
  end

  defp validate(%{"name" => name, "email" => email, "subject" => subj, "message" => msg}) do
    name = trim(name)
    email = trim(email)
    subj = trim(subj)
    msg = trim(msg)

    cond do
      name == "" -> {:error, :invalid, "name required"}
      email == "" or not String.contains?(email, "@") -> {:error, :invalid, "valid email required"}
      subj == "" -> {:error, :invalid, "subject required"}
      msg == "" -> {:error, :invalid, "message required"}
      String.length(msg) > @max_field_length -> {:error, :invalid, "message too long"}
      true -> {:ok, %{name: name, email: email, subject: subj, message: msg}}
    end
  end

  defp validate(_), do: {:error, :invalid, "name, email, subject, and message required"}

  defp trim(v) when is_binary(v), do: String.trim(v)
  defp trim(_), do: ""
end
