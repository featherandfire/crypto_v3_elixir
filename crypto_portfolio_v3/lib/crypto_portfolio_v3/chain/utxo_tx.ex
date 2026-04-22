defmodule CryptoPortfolioV3.Chain.UtxoTx do
  @moduledoc """
  Bitcoin / Litecoin tx detail fetcher. Both use the mempool.space-style
  API shape (`/api/tx/{txid}`) — mempool.space for BTC, litecoinspace.org
  for LTC. Unified UTXO parser: inputs and outputs are flattened into a
  "transfers" list so the frontend renders the same card as EVM/Solana/Tron.
  """

  require Logger

  @chains %{
    "bitcoin" => %{base: "https://mempool.space", name: "Bitcoin", symbol: "BTC", decimals: 8},
    "litecoin" => %{base: "https://litecoinspace.org", name: "Litecoin", symbol: "LTC", decimals: 8}
  }

  @spec parse_tx_details(binary(), binary()) :: {:ok, map()} | {:error, atom()}
  def parse_tx_details(chain_slug, hash) when is_binary(chain_slug) and is_binary(hash) do
    case Map.get(@chains, chain_slug) do
      nil -> {:error, :unknown_chain}
      cfg -> fetch(cfg, chain_slug, hash)
    end
  end

  defp fetch(cfg, chain_slug, hash) do
    case Req.get(cfg.base <> "/api/tx/" <> hash,
           receive_timeout: 15_000,
           retry: :transient,
           max_retries: 2
         ) do
      {:ok, %Req.Response{status: 200, body: %{} = body}} ->
        {:ok, build_summary(cfg, chain_slug, body)}

      {:ok, %Req.Response{status: 404}} ->
        {:error, :not_found}

      {:ok, %Req.Response{status: s}} ->
        {:error, {:http, s}}

      {:error, e} ->
        Logger.warning("UTXO tx #{chain_slug} error: #{Exception.message(e)}")
        {:error, e}
    end
  end

  defp build_summary(cfg, chain_slug, tx) do
    vins = tx["vin"] || []
    vouts = tx["vout"] || []

    total_out =
      vouts
      |> Enum.map(&(&1["value"] || 0))
      |> Enum.sum()

    fee_sats = tx["fee"] || 0
    status = if get_in(tx, ["status", "confirmed"]) == false, do: "pending", else: "confirmed"
    block_time = get_in(tx, ["status", "block_time"])

    # Primary "from" = first input's prevout address (approximation — UTXO has many)
    from_addr = vins |> List.first() |> get_in(["prevout", "scriptpubkey_address"])
    # Primary "to" = first output (approximation)
    to_addr = vouts |> List.first() |> Map.get("scriptpubkey_address")

    transfers =
      Enum.map(vins, fn v ->
        addr = get_in(v, ["prevout", "scriptpubkey_address"]) || ""
        val = get_in(v, ["prevout", "value"]) || 0

        %{
          direction: "out",
          from: addr,
          from_short: shorten(addr),
          to: nil,
          to_short: nil,
          token: cfg.symbol,
          symbol: cfg.symbol,
          amount: sats_to_decimal(val, cfg.decimals)
        }
      end) ++
        Enum.map(vouts, fn o ->
          addr = o["scriptpubkey_address"] || ""
          val = o["value"] || 0

          %{
            direction: "in",
            from: nil,
            from_short: nil,
            to: addr,
            to_short: shorten(addr),
            token: cfg.symbol,
            symbol: cfg.symbol,
            amount: sats_to_decimal(val, cfg.decimals)
          }
        end)

    %{
      chain: chain_slug,
      chain_name: cfg.name,
      status: status,
      block_time: block_time,
      from_addr: from_addr,
      from_addr_short: shorten(from_addr),
      to_addr: to_addr,
      to_addr_short: shorten(to_addr),
      value: "#{sats_to_decimal(total_out, cfg.decimals)} #{cfg.symbol}",
      fee: "#{sats_to_decimal(fee_sats, cfg.decimals)} #{cfg.symbol}",
      router: nil,
      transfers: transfers
    }
  end

  defp sats_to_decimal(sats, decimals) when is_integer(sats) do
    Decimal.div(Decimal.new(sats), Decimal.new(Integer.pow(10, decimals)))
    |> Decimal.to_string(:normal)
  end

  defp sats_to_decimal(_, _), do: "0"

  defp shorten(nil), do: nil
  defp shorten(""), do: nil

  defp shorten(addr) when byte_size(addr) > 12,
    do: "#{String.slice(addr, 0, 6)}…#{String.slice(addr, -4, 4)}"

  defp shorten(addr), do: addr
end
