defmodule CryptoPortfolioV3.Chain.Tron do
  @moduledoc """
  TronGrid public API client. TronGrid works unauthenticated for basic
  queries — no API key needed. We use two endpoints:

    * `GET /v1/accounts/{addr}` — native TRX balance
    * `POST /wallet/triggerconstantcontract` — TRC-20 balanceOf calls
  """

  require Logger

  alias CryptoPortfolioV3.Chain.TronAddress

  @base_url "https://api.trongrid.io"
  @balance_of_selector "balanceOf(address)"

  @spec get_trx_balance(binary()) :: {:ok, non_neg_integer()} | {:error, term()}
  def get_trx_balance(address) when is_binary(address) do
    case Req.get(@base_url <> "/v1/accounts/" <> address,
           receive_timeout: timeout_ms(),
           retry: :transient,
           max_retries: 2
         ) do
      {:ok, %Req.Response{status: 200, body: %{"data" => [acct | _]}}} ->
        {:ok, acct["balance"] || 0}

      {:ok, %Req.Response{status: 200, body: %{"data" => []}}} ->
        {:ok, 0}

      {:ok, %Req.Response{status: s, body: b}} ->
        Logger.debug("Tron /v1/accounts → HTTP #{s}: #{inspect(b)}")
        {:error, {:http, s}}

      {:error, e} ->
        Logger.warning("Tron /v1/accounts error: #{Exception.message(e)}")
        {:error, e}
    end
  end

  @doc """
  Calls `balanceOf(address)` on a TRC-20 contract via triggerconstantcontract.
  Returns the raw token integer (not yet divided by decimals).
  """
  @spec trc20_balance_of(binary(), binary()) :: {:ok, non_neg_integer()} | {:error, term()}
  def trc20_balance_of(wallet, contract) when is_binary(wallet) and is_binary(contract) do
    case TronAddress.abi_encode(wallet) do
      nil ->
        {:error, :bad_wallet_address}

      parameter ->
        body = %{
          owner_address: wallet,
          contract_address: contract,
          function_selector: @balance_of_selector,
          parameter: parameter,
          visible: true
        }

        case Req.post(@base_url <> "/wallet/triggerconstantcontract",
               json: body,
               receive_timeout: timeout_ms(),
               retry: :transient,
               max_retries: 2
             ) do
          {:ok, %Req.Response{status: 200, body: %{"constant_result" => [hex | _]}}}
          when is_binary(hex) ->
            {:ok, parse_hex_uint(hex)}

          {:ok, %Req.Response{status: 200, body: _other}} ->
            {:ok, 0}

          {:ok, %Req.Response{status: s, body: b}} ->
            Logger.debug("Tron triggerconstantcontract → HTTP #{s}: #{inspect(b)}")
            {:error, {:http, s}}

          {:error, e} ->
            Logger.warning("Tron triggerconstantcontract error: #{Exception.message(e)}")
            {:error, e}
        end
    end
  end

  defp parse_hex_uint(""), do: 0

  defp parse_hex_uint(hex) when is_binary(hex) do
    case Integer.parse(hex, 16) do
      {n, _} -> n
      :error -> 0
    end
  end

  defp timeout_ms do
    cfg = Application.get_env(:crypto_portfolio_v3, :tron, [])
    cfg[:timeout_ms] || 15_000
  end
end
