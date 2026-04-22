defmodule CryptoPortfolioV3.Chain.TronTx do
  @moduledoc """
  Tron tx detail fetcher via TronGrid. Uses `gettransactionbyid` for the
  raw tx (sender, native value, contract type) and `gettransactioninfobyid`
  for receipt/logs (TRC-20 Transfer events).
  """

  require Logger

  alias CryptoPortfolioV3.Chain.TronAddress

  @base_url "https://api.trongrid.io"
  @transfer_topic "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

  @known_decimals %{
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" => 6,
    "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" => 6,
    "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR" => 6,
    "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9" => 18
  }

  @spec parse_tx_details(binary()) :: {:ok, map()} | {:error, atom()}
  def parse_tx_details(hash) when is_binary(hash) do
    with {:ok, tx} <- get_tx(hash),
         {:ok, info} <- get_tx_info(hash) do
      {:ok, build_summary(tx, info)}
    end
  end

  defp get_tx(hash) do
    case Req.post(@base_url <> "/wallet/gettransactionbyid",
           json: %{value: hash, visible: true},
           receive_timeout: 15_000,
           retry: :transient,
           max_retries: 2
         ) do
      {:ok, %Req.Response{status: 200, body: %{} = body}} when map_size(body) > 0 ->
        {:ok, body}

      {:ok, %Req.Response{status: 200}} ->
        {:error, :not_found}

      {:ok, %Req.Response{status: s}} ->
        {:error, {:http, s}}

      {:error, e} ->
        Logger.warning("Tron gettransactionbyid error: #{Exception.message(e)}")
        {:error, e}
    end
  end

  defp get_tx_info(hash) do
    case Req.post(@base_url <> "/wallet/gettransactioninfobyid",
           json: %{value: hash, visible: true},
           receive_timeout: 15_000,
           retry: :transient,
           max_retries: 2
         ) do
      {:ok, %Req.Response{status: 200, body: %{} = body}} -> {:ok, body}
      {:ok, %Req.Response{status: s}} -> {:error, {:http, s}}
      {:error, e} -> {:error, e}
    end
  end

  defp build_summary(tx, info) do
    contract = get_in(tx, ["raw_data", "contract", Access.at(0)]) || %{}
    type = contract["type"]
    value = contract["parameter"]["value"] || %{}

    from_addr = value["owner_address"] || ""
    native_amount = value["amount"] || 0

    to_addr =
      case type do
        "TransferContract" -> value["to_address"] || ""
        "TriggerSmartContract" -> value["contract_address"] || ""
        _ -> ""
      end

    fee_sun = info["fee"] || 0
    logs = info["log"] || []
    transfers = Enum.flat_map(logs, &parse_log/1)

    receipt_result = get_in(info, ["receipt", "result"]) || "SUCCESS"
    status = if receipt_result == "SUCCESS", do: "success", else: "failed"

    %{
      chain: "tron",
      chain_name: "Tron",
      status: status,
      block_time: info["blockTimeStamp"],
      from_addr: from_addr,
      from_addr_short: shorten(from_addr),
      to_addr: if(to_addr == "", do: nil, else: to_addr),
      to_addr_short: if(to_addr == "", do: nil, else: shorten(to_addr)),
      value: native_display(native_amount),
      fee: fee_display(fee_sun),
      router: nil,
      transfers: transfers
    }
  end

  defp parse_log(%{"topics" => [@transfer_topic, from_topic, to_topic | _], "address" => addr, "data" => data})
       when is_binary(addr) do
    # Log addresses come without the 0x41 prefix (20 hex = 40 chars)
    contract_hex = "41" <> String.downcase(addr)
    from_hex = "41" <> addr_from_topic(from_topic)
    to_hex = "41" <> addr_from_topic(to_topic)

    contract_base58 = TronAddress.to_base58("0x" <> contract_hex)
    from_base58 = TronAddress.to_base58("0x" <> from_hex)
    to_base58 = TronAddress.to_base58("0x" <> to_hex)

    raw = hex_to_int(data)
    dec = Map.get(@known_decimals, contract_base58 || "", 18)
    amount = Decimal.div(Decimal.new(raw), Decimal.new(Integer.pow(10, dec)))

    [
      %{
        from: from_base58 || from_hex,
        from_short: shorten(from_base58 || from_hex),
        to: to_base58 || to_hex,
        to_short: shorten(to_base58 || to_hex),
        token: contract_base58 || contract_hex,
        symbol: "TOKEN",
        amount: Decimal.to_string(amount, :normal)
      }
    ]
  end

  defp parse_log(_), do: []

  defp addr_from_topic(hex) do
    String.slice(hex, -40, 40) |> String.downcase()
  end

  defp hex_to_int(nil), do: 0
  defp hex_to_int(""), do: 0

  defp hex_to_int(s) when is_binary(s) do
    clean = String.trim_leading(s, "0x")
    if clean == "", do: 0, else: String.to_integer(clean, 16)
  rescue
    _ -> 0
  end

  defp native_display(0), do: nil

  defp native_display(sun) when is_integer(sun) do
    trx = Decimal.div(Decimal.new(sun), Decimal.new(1_000_000))
    "#{Decimal.to_string(trx, :normal)} TRX"
  end

  defp native_display(_), do: nil

  defp fee_display(0), do: nil

  defp fee_display(sun) when is_integer(sun) do
    trx = Decimal.div(Decimal.new(sun), Decimal.new(1_000_000))
    "#{Decimal.to_string(trx, :normal)} TRX"
  end

  defp fee_display(_), do: nil

  defp shorten(nil), do: nil
  defp shorten(""), do: nil

  defp shorten(addr) when byte_size(addr) > 10,
    do: "#{String.slice(addr, 0, 6)}…#{String.slice(addr, -4, 4)}"

  defp shorten(addr), do: addr
end
