defmodule CryptoPortfolioV3.Chain.EvmRpc do
  @moduledoc """
  Thin JSON-RPC 2.0 client for EVM chains. Used to fetch transaction
  details + receipt directly from the chain's public RPC (bypassing
  Etherscan for richer data).
  """

  require Logger

  @spec call(binary(), binary(), list()) :: {:ok, any()} | {:error, term()}
  def call(rpc_url, method, params) when is_binary(rpc_url) and is_binary(method) and is_list(params) do
    body = %{jsonrpc: "2.0", id: 1, method: method, params: params}

    case Req.post(rpc_url,
           json: body,
           receive_timeout: 10_000,
           retry: :transient,
           max_retries: 2
         ) do
      {:ok, %Req.Response{status: 200, body: %{"result" => result}}} ->
        {:ok, result}

      {:ok, %Req.Response{status: 200, body: %{"error" => err}}} ->
        {:error, {:rpc, err}}

      {:ok, %Req.Response{status: s, body: b}} ->
        Logger.debug("EvmRpc #{method} → HTTP #{s}: #{inspect(b)}")
        {:error, {:http, s}}

      {:error, e} ->
        Logger.warning("EvmRpc #{method} error: #{Exception.message(e)}")
        {:error, e}
    end
  end
end
