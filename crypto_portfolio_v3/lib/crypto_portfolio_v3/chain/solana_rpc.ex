defmodule CryptoPortfolioV3.Chain.SolanaRpc do
  @moduledoc """
  Thin JSON-RPC 2.0 client for Solana. Default endpoint is the free public
  mainnet-beta node — heavily rate-limited (~1 req/s), good enough for dev.
  Override via `SOLANA_RPC_URL` for paid endpoints (Helius, QuickNode, etc.)
  """

  require Logger

  @spec get_balance(binary()) :: {:ok, non_neg_integer()} | {:error, term()}
  def get_balance(address) when is_binary(address) do
    case call("getBalance", [address]) do
      {:ok, %{"value" => lamports}} when is_integer(lamports) -> {:ok, lamports}
      {:ok, _} -> {:ok, 0}
      {:error, _} = err -> err
    end
  end

  @spec get_token_accounts_by_owner(binary(), binary()) :: {:ok, [map()]} | {:error, term()}
  def get_token_accounts_by_owner(address, program_id)
      when is_binary(address) and is_binary(program_id) do
    params = [address, %{"programId" => program_id}, %{"encoding" => "jsonParsed"}]

    case call("getTokenAccountsByOwner", params) do
      {:ok, %{"value" => accts}} when is_list(accts) -> {:ok, accts}
      {:ok, _} -> {:ok, []}
      {:error, _} = err -> err
    end
  end

  @spec get_signatures_for_address(binary(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def get_signatures_for_address(address, opts \\ []) when is_binary(address) do
    limit = Keyword.get(opts, :limit, 30)

    case call("getSignaturesForAddress", [address, %{"limit" => limit}]) do
      {:ok, sigs} when is_list(sigs) -> {:ok, sigs}
      {:ok, _} -> {:ok, []}
      {:error, _} = err -> err
    end
  end

  @spec get_transaction(binary()) :: {:ok, map() | nil} | {:error, term()}
  def get_transaction(signature) when is_binary(signature) do
    params = [signature, %{"encoding" => "jsonParsed", "maxSupportedTransactionVersion" => 0}]
    call("getTransaction", params)
  end

  # ── Internals ──

  defp call(method, params) do
    cfg = Application.fetch_env!(:crypto_portfolio_v3, :solana)
    body = %{jsonrpc: "2.0", id: 1, method: method, params: params}

    case Req.post(cfg[:rpc_url],
           json: body,
           receive_timeout: cfg[:timeout_ms],
           retry: :transient,
           max_retries: 2
         ) do
      {:ok, %Req.Response{status: 200, body: %{"result" => result}}} ->
        {:ok, result}

      {:ok, %Req.Response{status: 200, body: %{"error" => err}}} ->
        Logger.debug("Solana RPC #{method} → RPC error: #{inspect(err)}")
        {:error, {:rpc, err}}

      {:ok, %Req.Response{status: s, body: b}} ->
        Logger.debug("Solana RPC #{method} → HTTP #{s}: #{inspect(b)}")
        {:error, {:http, s}}

      {:error, e} ->
        Logger.warning("Solana RPC #{method} error: #{Exception.message(e)}")
        {:error, e}
    end
  end
end
