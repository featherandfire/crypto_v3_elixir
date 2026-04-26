defmodule CryptoPortfolioV3.Chain.Etherscan do
  @moduledoc """
  Etherscan V2 multi-chain HTTP client. All calls return `{:ok, data}` or
  `{:error, reason}`. Etherscan's `status: "0"` (no data) is mapped to
  empty-but-successful results, not errors — many wallets legitimately
  have no tokens on a given chain.
  """

  require Logger

  @eth_sentinel "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

  def eth_sentinel, do: @eth_sentinel

  @doc "Native token balance in Decimal. Zero on no-data / error."
  @spec native_balance(pos_integer(), binary()) :: {:ok, Decimal.t()}
  def native_balance(chain_id, address) do
    case get(chain_id, %{module: "account", action: "balance", address: address, tag: "latest"}) do
      {:ok, %{"status" => "1", "result" => raw}} ->
        {:ok, decimal_from_raw(raw, 18)}

      _ ->
        {:ok, Decimal.new(0)}
    end
  end

  @doc """
  Enumerates all ERC-20 contracts the wallet has ever sent or received,
  via the last 1000 token transfers. Returns a dedup'd list of contract
  metadata (address, symbol, name, decimals).
  """
  @spec token_contracts(pos_integer(), binary()) :: {:ok, [map()]}
  def token_contracts(chain_id, address) do
    params = %{
      module: "account",
      action: "tokentx",
      address: address,
      startblock: 0,
      endblock: 99_999_999,
      sort: "desc",
      page: 1,
      offset: 1000
    }

    case get(chain_id, params) do
      {:ok, %{"status" => "1", "result" => txs}} when is_list(txs) ->
        contracts =
          txs
          |> Enum.reduce(%{}, fn tx, acc ->
            ca = (tx["contractAddress"] || "") |> String.downcase()

            if ca == "" or Map.has_key?(acc, ca) do
              acc
            else
              Map.put(acc, ca, %{
                contract_address: ca,
                symbol: tx["tokenSymbol"] || "",
                name: tx["tokenName"] || "",
                decimals: parse_int(tx["tokenDecimal"], 18)
              })
            end
          end)
          |> Map.values()

        {:ok, contracts}

      _ ->
        {:ok, []}
    end
  end

  @doc """
  Lists ERC-20 transfer history for a wallet, optionally filtered by
  contract. Used by the last-buy-fees flow to find the most recent
  incoming transfer of a target token.

  Options: `:contract_address` (filter), `:offset` (1..1000, default 20),
  `:sort` ("asc" | "desc", default "desc").
  """
  @spec list_token_txs(pos_integer(), binary(), keyword()) :: {:ok, [map()]}
  def list_token_txs(chain_id, wallet, opts \\ []) do
    params = %{
      module: "account",
      action: "tokentx",
      address: wallet,
      sort: Keyword.get(opts, :sort, "desc"),
      page: 1,
      offset: Keyword.get(opts, :offset, 20)
    }

    params =
      case Keyword.get(opts, :contract_address) do
        nil -> params
        ca -> Map.put(params, :contractaddress, ca)
      end

    case get(chain_id, params) do
      {:ok, %{"status" => "1", "result" => txs}} when is_list(txs) -> {:ok, txs}
      _ -> {:ok, []}
    end
  end

  @doc """
  Current balance of a specific ERC-20 token for this wallet. Returns
  `{:ok, contract_map_with_balance}` or `:zero` / `:error`.
  """
  @spec token_balance(pos_integer(), binary(), map()) ::
          {:ok, map()} | :zero | :error
  def token_balance(chain_id, address, %{contract_address: ca, decimals: dec} = contract) do
    params = %{
      module: "account",
      action: "tokenbalance",
      contractaddress: ca,
      address: address,
      tag: "latest"
    }

    case get(chain_id, params) do
      {:ok, %{"status" => "1", "result" => raw}} ->
        bal = decimal_from_raw(raw, dec)
        if Decimal.gt?(bal, 0), do: {:ok, Map.put(contract, :balance, bal)}, else: :zero

      _ ->
        :error
    end
  end

  # ── Internals ──────────────────────────────────────────────────────────────

  defp get(chain_id, params) do
    cfg = Application.fetch_env!(:crypto_portfolio_v3, :etherscan)

    params =
      params
      |> Map.put(:chainid, chain_id)
      |> maybe_add_api_key(cfg[:api_key])

    req =
      Req.new(
        base_url: cfg[:base_url],
        receive_timeout: cfg[:timeout_ms],
        # `:safe_transient` catches 429 in addition to connect errors and 5xx —
        # crucial for the multi-chain fan-out where parallel requests easily
        # exceed Etherscan's free-tier 5 req/sec budget.
        retry: :safe_transient,
        max_retries: 3,
        retry_delay: fn attempt -> trunc(1000 * :math.pow(2, attempt)) end
      )

    case Req.get(req, params: Map.to_list(params)) do
      {:ok, %Req.Response{status: 200, body: body}} ->
        {:ok, body}

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.debug("Etherscan chain=#{chain_id} → HTTP #{status}")
        {:error, {:http, status, body}}

      {:error, exception} ->
        Logger.warning("Etherscan chain=#{chain_id} error: #{Exception.message(exception)}")
        {:error, exception}
    end
  end

  defp maybe_add_api_key(params, nil), do: params
  defp maybe_add_api_key(params, ""), do: params
  defp maybe_add_api_key(params, key), do: Map.put(params, :apikey, key)

  # Raw Solidity integer (string) → Decimal, divided by 10^decimals.
  # Elixir integers are arbitrary precision, so no BigInt lib needed.
  defp decimal_from_raw(nil, _), do: Decimal.new(0)
  defp decimal_from_raw("", _), do: Decimal.new(0)

  defp decimal_from_raw(raw, decimals) when is_binary(raw) do
    case Integer.parse(raw) do
      {int, _} -> decimal_from_raw(int, decimals)
      :error -> Decimal.new(0)
    end
  end

  defp decimal_from_raw(raw, decimals) when is_integer(raw) and is_integer(decimals) do
    divisor = Decimal.new(Integer.pow(10, decimals))
    Decimal.div(Decimal.new(raw), divisor)
  end

  defp parse_int(nil, default), do: default
  defp parse_int("", default), do: default

  defp parse_int(s, default) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} when n > 0 -> n
      _ -> default
    end
  end

  defp parse_int(_, default), do: default
end
