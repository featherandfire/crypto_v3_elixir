defmodule Brokerage.BrokerFunding.BrokerApi do
  @moduledoc """
  Thin wrapper over Alpaca Broker API credentials + base URL. Reads from
  environment so swapping sandbox → live is a config change.

  Env vars (see .env.example). Reader accepts either casing — uppercase
  is the convention but lowercase is supported because the .env happens
  to use that here.
    b2b_api_key          — Alpaca Broker partner key
    b2b_api_secret       — Alpaca Broker partner secret
    b2b_broker_base_url  — sandbox or live Broker API host

  When credentials are not yet set (pre-approval), `configured?/0`
  returns false and `BrokerFunding.create_deposit/2` skips the live
  API call, recording the deposit intent locally only.
  """

  def api_key, do: env("b2b_api_key", "B2B_API_KEY")
  def api_secret, do: env("b2b_api_secret", "B2B_API_SECRET")

  def base_url do
    env("b2b_broker_base_url", "B2B_BROKER_BASE_URL") ||
      "https://broker-api.sandbox.alpaca.markets"
  end

  defp env(primary, fallback) do
    case System.get_env(primary) do
      v when is_binary(v) and v != "" -> v
      _ -> System.get_env(fallback)
    end
  end

  def configured? do
    is_binary(api_key()) and api_key() != "" and
      is_binary(api_secret()) and api_secret() != ""
  end

  @doc """
  Builds the HTTP Basic auth header expected by Alpaca Broker. Returns
  `{:error, :missing_credentials}` if either env var is unset so callers
  can short-circuit instead of failing the request.
  """
  def auth_header do
    if configured?() do
      encoded = Base.encode64("#{api_key()}:#{api_secret()}")
      {:ok, [{"authorization", "Basic #{encoded}"}, {"accept", "application/json"}]}
    else
      {:error, :missing_credentials}
    end
  end
end
