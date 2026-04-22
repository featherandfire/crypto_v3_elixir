defmodule CryptoPortfolioV3.Accounts.Token do
  @moduledoc """
  Hand-rolled HS256 JWT. Claims: `sub` (user id), `iat`, `exp`.
  """

  @alg "HS256"

  @spec sign(map(), binary(), non_neg_integer()) :: binary()
  def sign(claims, secret, ttl_seconds)
      when is_map(claims) and is_binary(secret) and is_integer(ttl_seconds) do
    now = System.system_time(:second)
    payload = Map.merge(claims, %{"iat" => now, "exp" => now + ttl_seconds})

    header_b64 = encode_json(%{"alg" => @alg, "typ" => "JWT"})
    payload_b64 = encode_json(payload)
    signing_input = header_b64 <> "." <> payload_b64
    sig = :crypto.mac(:hmac, :sha256, secret, signing_input) |> b64url()
    signing_input <> "." <> sig
  end

  @spec verify(binary(), binary()) :: {:ok, map()} | {:error, :invalid_token | :expired}
  def verify(token, secret) when is_binary(token) and is_binary(secret) do
    with [h, p, s] <- String.split(token, "."),
         signing_input = h <> "." <> p,
         expected_sig = :crypto.mac(:hmac, :sha256, secret, signing_input) |> b64url(),
         true <- Plug.Crypto.secure_compare(s, expected_sig),
         {:ok, payload_json} <- Base.url_decode64(p, padding: false),
         {:ok, claims} <- Jason.decode(payload_json) do
      if valid_exp?(claims), do: {:ok, claims}, else: {:error, :expired}
    else
      _ -> {:error, :invalid_token}
    end
  end

  def verify(_, _), do: {:error, :invalid_token}

  defp encode_json(data), do: data |> Jason.encode!() |> b64url()
  defp b64url(binary), do: Base.url_encode64(binary, padding: false)
  defp valid_exp?(%{"exp" => exp}) when is_integer(exp), do: System.system_time(:second) < exp
  defp valid_exp?(_), do: false
end
