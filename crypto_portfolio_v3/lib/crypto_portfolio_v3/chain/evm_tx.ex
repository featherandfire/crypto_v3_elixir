defmodule CryptoPortfolioV3.Chain.EvmTx do
  @moduledoc """
  Parses a wallet's most recent incoming token transfer and returns a
  structured breakdown: sent, received, gas fee, explicit fee parties,
  router identification.

  Data sources:
    * Etherscan `tokentx?contractaddress=…` → find the incoming tx hash
    * Chain's public JSON-RPC → full tx + receipt for log parsing
    * Market.fetch_prices/1 → native-token USD for gas conversion
  """

  require Logger

  alias CryptoPortfolioV3.Chain.{ChainInfo, Etherscan, EvmRpc, Routers}
  alias CryptoPortfolioV3.Market

  @transfer_topic "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  @counterparty_threshold Decimal.from_float(0.2)

  # Common stablecoin contracts (6 decimals). Other tokens default to 18 in
  # tx-detail summaries — good enough for display; user clicks explorer for exact.
  @known_decimals %{
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" => 6,
    "0xdac17f958d2ee523a2206206994597c13d831ec7" => 6,
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" => 6,
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f" => 6,
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831" => 6,
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" => 6,
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85" => 6,
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" => 6,
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" => 6,
    "0x55d398326f99059ff775485246999027b3197955" => 6
  }

  @doc """
  Wallet-agnostic tx detail summary — used by `/api/lookup/:hash`.
  Returns structured from/to/value/fee/router + all Transfer-log flows.
  """
  @spec parse_tx_details(binary(), binary()) :: {:ok, map()} | {:error, atom()}
  def parse_tx_details(chain_slug, hash) when is_binary(chain_slug) and is_binary(hash) do
    case ChainInfo.get(chain_slug) do
      nil ->
        {:error, :unknown_chain}

      chain ->
        case fetch_tx_and_receipt(chain.rpc_url, hash) do
          {:ok, tx, receipt} -> {:ok, build_details_summary(chain, chain_slug, tx, receipt)}
          err -> err
        end
    end
  end

  defp build_details_summary(chain, chain_slug, tx, receipt) do
    transfers_raw = parse_transfer_logs(receipt["logs"] || [])

    transfers =
      Enum.map(transfers_raw, fn t ->
        dec = Map.get(@known_decimals, t.token, 18)
        amount = Decimal.div(Decimal.new(t.amount), Decimal.new(Integer.pow(10, dec)))

        %{
          from: t.from,
          from_short: shorten(t.from),
          to: t.to,
          to_short: shorten(t.to),
          token: t.token,
          symbol: (t.token == "" && "TOKEN") || "TOKEN",
          amount: Decimal.to_string(amount, :normal)
        }
      end)

    gas_native = compute_gas_native(tx, receipt)
    gas_usd = gas_native_to_usd(gas_native, chain.native_cg_id)
    native_value = decimal_from_raw(hex_to_int(tx["value"] || "0x0"), 18)

    %{
      chain: chain_slug,
      chain_name: chain.name,
      status: evm_status(receipt),
      block_time: nil,
      from_addr: tx["from"],
      from_addr_short: shorten(tx["from"]),
      to_addr: tx["to"],
      to_addr_short: shorten(tx["to"]),
      value: native_value_display(native_value, chain.native_symbol),
      fee: format_gas(gas_native, chain.native_symbol, gas_usd),
      router: Routers.name(tx["to"]),
      transfers: transfers
    }
  end

  defp evm_status(%{"status" => "0x1"}), do: "success"
  defp evm_status(%{"status" => "0x0"}), do: "failed"
  defp evm_status(_), do: "success"

  defp shorten(nil), do: nil
  defp shorten(""), do: nil

  defp shorten(addr) when is_binary(addr) and byte_size(addr) > 10,
    do: "#{String.slice(addr, 0, 6)}…#{String.slice(addr, -4, 4)}"

  defp shorten(addr), do: addr

  defp native_value_display(%Decimal{} = amt, sym) do
    if Decimal.gt?(amt, 0), do: "#{Decimal.to_string(amt, :normal)} #{sym}", else: nil
  end

  @spec fetch_last_buy_fees(binary(), binary(), binary()) ::
          {:ok, map()} | {:error, atom()}
  def fetch_last_buy_fees(chain_slug, wallet, contract)
      when is_binary(chain_slug) and is_binary(wallet) and is_binary(contract) do
    case ChainInfo.get(chain_slug) do
      nil -> {:error, :unknown_chain}
      chain -> do_fetch(chain, String.downcase(wallet), String.downcase(contract))
    end
  end

  # ── Orchestration ──────────────────────────────────────────────────────────

  defp do_fetch(chain, wallet, contract) do
    with {:ok, tx_entry} <- find_incoming_tx(chain, wallet, contract),
         {:ok, tx, receipt} <- fetch_tx_and_receipt(chain.rpc_url, tx_entry["hash"]) do
      transfers = parse_transfer_logs(receipt["logs"] || [])
      deltas = token_deltas(transfers, wallet)

      target_decimals = parse_int(tx_entry["tokenDecimal"], 18)
      target_symbol = tx_entry["tokenSymbol"] || "TOKEN"
      received = received_amount(deltas, contract, target_decimals)

      {sent_symbol, sent_amount, sent_contract} =
        determine_sent(tx, wallet, deltas, contract, chain)

      fee_parties =
        fee_parties(transfers, wallet, contract, sent_contract, sent_amount,
          target_decimals: target_decimals,
          target_symbol: target_symbol
        )

      gas_native = compute_gas_native(tx, receipt)
      gas_usd = gas_native_to_usd(gas_native, chain.native_cg_id)
      fee_pct = compute_fee_pct(fee_parties, sent_contract, sent_amount)

      {:ok,
       %{
         signature: tx_entry["hash"],
         block_time: parse_int(tx_entry["timeStamp"], nil),
         router: Routers.name(tx["to"]),
         routers: if(Routers.name(tx["to"]), do: [Routers.name(tx["to"])], else: []),
         fee_sol: format_gas(gas_native, chain.native_symbol, gas_usd),
         # Structured numeric gas data — frontend formats however it wants.
         gas_usd: gas_usd,
         gas_native: gas_native,
         gas_native_symbol: chain.native_symbol,
         fee_display: nil,
         sent: format_amount(sent_amount, sent_symbol),
         received: format_amount(received, target_symbol),
         fee_parties: fee_parties,
         spread_usd: nil,
         fee_pct: fee_pct
       }}
    end
  end

  defp find_incoming_tx(chain, wallet, contract) do
    {:ok, txs} =
      Etherscan.list_token_txs(chain.chain_id, wallet,
        contract_address: contract,
        sort: "desc",
        offset: 20
      )

    case Enum.find(txs, fn t -> String.downcase(t["to"] || "") == wallet end) do
      nil -> {:error, :no_recent_buy}
      entry -> {:ok, entry}
    end
  end

  defp fetch_tx_and_receipt(rpc_url, hash) do
    [tx_task, receipt_task] = [
      Task.async(fn -> EvmRpc.call(rpc_url, "eth_getTransactionByHash", [hash]) end),
      Task.async(fn -> EvmRpc.call(rpc_url, "eth_getTransactionReceipt", [hash]) end)
    ]

    with {:ok, tx} when is_map(tx) <- Task.await(tx_task, 15_000),
         {:ok, receipt} when is_map(receipt) <- Task.await(receipt_task, 15_000) do
      {:ok, tx, receipt}
    else
      _ -> {:error, :tx_fetch_failed}
    end
  end

  # ── Log parsing ────────────────────────────────────────────────────────────

  defp parse_transfer_logs(logs) do
    Enum.flat_map(logs, fn log ->
      case log do
        %{"topics" => [@transfer_topic, from_topic, to_topic | _], "address" => addr, "data" => data} ->
          [
            %{
              token: String.downcase(addr),
              from: addr_from_topic(from_topic),
              to: addr_from_topic(to_topic),
              amount: hex_to_int(data)
            }
          ]

        _ ->
          []
      end
    end)
  end

  defp token_deltas(transfers, wallet) do
    Enum.reduce(transfers, %{}, fn t, acc ->
      if t.from != wallet and t.to != wallet do
        acc
      else
        entry = Map.get(acc, t.token, %{token: t.token, in: 0, out: 0})
        entry = if t.to == wallet, do: Map.update!(entry, :in, &(&1 + t.amount)), else: entry
        entry = if t.from == wallet, do: Map.update!(entry, :out, &(&1 + t.amount)), else: entry
        Map.put(acc, t.token, entry)
      end
    end)
  end

  # ── Amount calculations ────────────────────────────────────────────────────

  defp received_amount(deltas, contract, decimals) do
    case Map.get(deltas, contract) do
      %{in: amt} when amt > 0 -> decimal_from_raw(amt, decimals)
      _ -> Decimal.new(0)
    end
  end

  defp determine_sent(tx, wallet, deltas, contract, chain) do
    native_raw = hex_to_int(tx["value"] || "0x0")
    native_amount = decimal_from_raw(native_raw, 18)
    from = String.downcase(tx["from"] || "")

    cond do
      Decimal.gt?(native_amount, 0) and from == wallet ->
        {chain.native_symbol, native_amount, nil}

      true ->
        max_out =
          deltas
          |> Map.values()
          |> Enum.reject(fn d -> d.token == contract end)
          |> Enum.filter(fn d -> d.out > 0 end)
          |> Enum.max_by(fn d -> d.out end, fn -> nil end)

        case max_out do
          nil -> {chain.native_symbol, Decimal.new(0), nil}
          %{token: t, out: amt} -> {"TOKEN", decimal_from_raw(amt, 18), t}
        end
    end
  end

  defp fee_parties(transfers, wallet, contract, sent_contract, sent_amount, opts) do
    target_decimals = Keyword.fetch!(opts, :target_decimals)
    target_symbol = Keyword.fetch!(opts, :target_symbol)

    relevant? = fn t ->
      t.token == contract or (not is_nil(sent_contract) and t.token == sent_contract)
    end

    transfers
    |> Enum.filter(fn t ->
      t.to != wallet and t.from != wallet and relevant?.(t)
    end)
    |> Enum.reduce(%{}, fn t, acc ->
      Map.update(acc, {t.to, t.token}, t.amount, &(&1 + t.amount))
    end)
    |> Enum.map(fn {{owner, token}, raw} ->
      decimals = if token == contract, do: target_decimals, else: 18
      amount = decimal_from_raw(raw, decimals)

      %{
        address_short: "#{String.slice(owner, 0, 6)}…#{String.slice(owner, -4, 4)}",
        amount: amount,
        symbol: if(token == contract, do: target_symbol, else: "TOKEN"),
        mint: token,
        is_stable: false
      }
    end)
    |> Enum.reject(fn p ->
      # Swap counterparty: received > 20% of sent amount (not a fee, the other side of the trade).
      not is_nil(sent_contract) and p.mint == sent_contract and
        not Decimal.eq?(sent_amount, 0) and
        Decimal.compare(p.amount, Decimal.mult(sent_amount, @counterparty_threshold)) == :gt
    end)
    |> Enum.sort_by(& &1.amount, {:desc, Decimal})
  end

  defp compute_gas_native(tx, receipt) do
    gas_used = hex_to_int(receipt["gasUsed"])
    gas_price = hex_to_int(receipt["effectiveGasPrice"] || tx["gasPrice"] || "0x0")
    decimal_from_raw(gas_used * gas_price, 18)
  end

  defp gas_native_to_usd(gas_native, cg_id) do
    case Market.fetch_prices([cg_id]) do
      {:ok, map} ->
        case Map.get(map, cg_id) do
          %{"current_price_usd" => price} when is_number(price) ->
            Decimal.mult(gas_native, to_decimal(price))

          _ ->
            nil
        end

      _ ->
        nil
    end
  end

  defp compute_fee_pct(_fee_parties, nil, _), do: nil

  defp compute_fee_pct(fee_parties, sent_contract, sent_amount) do
    if Decimal.gt?(sent_amount, 0) do
      fee_in_sent =
        fee_parties
        |> Enum.filter(fn p -> p.mint == sent_contract end)
        |> Enum.reduce(Decimal.new(0), fn p, acc -> Decimal.add(acc, p.amount) end)

      fee_in_sent |> Decimal.div(sent_amount) |> Decimal.mult(100)
    else
      nil
    end
  end

  # ── Formatting helpers ─────────────────────────────────────────────────────

  defp format_amount(%Decimal{} = amt, symbol) do
    if Decimal.gt?(amt, 0), do: "#{Decimal.to_string(amt, :normal)} #{symbol}", else: nil
  end

  defp format_gas(%Decimal{} = gas_native, symbol, nil),
    do: "#{Decimal.to_string(Decimal.round(gas_native, 6), :normal)} #{symbol}"

  defp format_gas(%Decimal{} = gas_native, symbol, %Decimal{} = gas_usd) do
    "#{Decimal.to_string(Decimal.round(gas_native, 6), :normal)} #{symbol} ($#{Decimal.to_string(Decimal.round(gas_usd, 4), :normal)})"
  end

  # ── Low-level helpers ──────────────────────────────────────────────────────

  defp hex_to_int(nil), do: 0
  defp hex_to_int("0x"), do: 0
  defp hex_to_int("0x" <> rest), do: String.to_integer(rest, 16)
  defp hex_to_int(""), do: 0
  defp hex_to_int(s) when is_binary(s), do: String.to_integer(s, 16)

  defp addr_from_topic("0x" <> rest), do: "0x" <> String.downcase(String.slice(rest, -40, 40))

  defp decimal_from_raw(raw, decimals) when is_integer(raw) and is_integer(decimals) do
    Decimal.div(Decimal.new(raw), Decimal.new(Integer.pow(10, decimals)))
  end

  defp parse_int(nil, default), do: default
  defp parse_int("", default), do: default

  defp parse_int(s, default) when is_binary(s) do
    case Integer.parse(s) do
      {n, _} -> n
      _ -> default
    end
  end

  defp parse_int(_, default), do: default

  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp to_decimal(s) when is_binary(s), do: Decimal.new(s)
end
