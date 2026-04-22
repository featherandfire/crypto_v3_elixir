defmodule CryptoPortfolioV3.Chain.Lookup do
  @moduledoc """
  Hash-lookup dispatcher: detects format, builds chain-match candidates,
  probes live chain state where possible. Returns:

      %{hash: _, type: _, matches: [...], summary?: _}

  Confidence tiers per match:
    * `"confirmed"` — live RPC returned a real tx on this chain
    * `"likely"` — format is consistent; this chain wasn't probed
    * `"format_only"` — format is consistent; all probes failed or N/A
  """

  alias CryptoPortfolioV3.Chain.{ChainInfo, EvmRpc, EvmTx, HashFormats, SolanaTx, TronTx, UtxoTx}

  @evm_tx_path "/tx/{hash}"
  @evm_address_path "/address/{hash}"

  @non_evm_chains %{
    "bitcoin" => %{
      chain: "bitcoin",
      chain_name: "Bitcoin",
      color: "#F7931A",
      explorer_base: "https://mempool.space",
      tx_path: "/tx/{hash}",
      address_path: "/address/{hash}"
    },
    "solana" => %{
      chain: "solana",
      chain_name: "Solana",
      color: "#9945FF",
      explorer_base: "https://solscan.io",
      tx_path: "/tx/{hash}",
      address_path: "/account/{hash}"
    },
    "tron" => %{
      chain: "tron",
      chain_name: "Tron",
      color: "#EF0027",
      explorer_base: "https://tronscan.org",
      tx_path: "/#/transaction/{hash}",
      address_path: "/#/address/{hash}"
    },
    "litecoin" => %{
      chain: "litecoin",
      chain_name: "Litecoin",
      color: "#BFBBBB",
      explorer_base: "https://blockchair.com/litecoin",
      tx_path: "/transaction/{hash}",
      address_path: "/address/{hash}"
    }
  }

  @spec lookup(binary()) :: map()
  def lookup(hash) when is_binary(hash) do
    case HashFormats.detect(hash) do
      :unknown -> %{hash: hash, type: "Unknown Format", matches: []}
      {type, display} -> build(type, display, hash)
    end
  end

  # ── Per-type builders ──

  defp build("evm_address", display, hash) do
    matches =
      ChainInfo.list() |> Enum.map(&evm_match(&1, hash, @evm_address_path, "format_only"))

    %{hash: hash, type: display, matches: matches}
  end

  defp build("evm_tx_hash", display, hash) do
    normalized = String.downcase(hash)
    {confirmed, all_failed} = probe_evm_chains(normalized)
    confirmed_set = MapSet.new(confirmed)
    all_chains = ChainInfo.list()

    matches =
      cond do
        MapSet.size(confirmed_set) > 0 ->
          confirmed_matches =
            all_chains
            |> Enum.filter(&MapSet.member?(confirmed_set, &1.slug))
            |> Enum.map(&evm_match(&1, hash, @evm_tx_path, "confirmed"))

          likely_matches =
            all_chains
            |> Enum.filter(fn c -> not c.probe end)
            |> Enum.map(&evm_match(&1, hash, @evm_tx_path, "likely"))

          confirmed_matches ++ likely_matches

        all_failed ->
          Enum.map(all_chains, &evm_match(&1, hash, @evm_tx_path, "format_only"))

        true ->
          []
      end

    base = %{hash: hash, type: display, matches: matches}

    case confirmed do
      [slug | _] ->
        case EvmTx.parse_tx_details(slug, normalized) do
          {:ok, summary} -> Map.put(base, :summary, summary)
          _ -> base
        end

      [] ->
        # No EVM chain confirmed — try Tron (same 64-hex format).
        tron_hash = String.trim_leading(hash, "0x")

        case TronTx.parse_tx_details(tron_hash) do
          {:ok, summary} ->
            base
            |> Map.put(:summary, summary)
            |> Map.put(:type, "Tron Transaction Hash")
            |> Map.put(:matches, [non_evm_match("tron", tron_hash, :tx_path, "confirmed")])

          _ ->
            base
        end
    end
  end

  defp build(type, display, hash) when type in ["btc_address", "btc_bech32_address"] do
    %{
      hash: hash,
      type: display,
      matches: [non_evm_match("bitcoin", hash, :address_path, "likely")]
    }
  end

  defp build("btc_tx_hash", display, hash) do
    # Probe BTC → LTC → Tron (all use 64-char hex for tx hashes).
    base = %{hash: hash, type: display, matches: [non_evm_match("bitcoin", hash, :tx_path, "likely")]}

    with :no_match <- try_utxo(base, "bitcoin", hash),
         :no_match <- try_utxo(base, "litecoin", hash),
         :no_match <- try_tron(base, hash) do
      base
    else
      {:ok, result} -> result
    end
  end

  defp try_utxo(base, chain_slug, hash) do
    case UtxoTx.parse_tx_details(chain_slug, hash) do
      {:ok, summary} ->
        type =
          case chain_slug do
            "bitcoin" -> "Bitcoin Transaction Hash"
            "litecoin" -> "Litecoin Transaction Hash"
          end

        {:ok,
         base
         |> Map.put(:summary, summary)
         |> Map.put(:type, type)
         |> Map.put(:matches, [non_evm_match(chain_slug, hash, :tx_path, "confirmed")])}

      _ ->
        :no_match
    end
  end

  defp try_tron(base, hash) do
    case TronTx.parse_tx_details(hash) do
      {:ok, summary} ->
        {:ok,
         base
         |> Map.put(:summary, summary)
         |> Map.put(:type, "Tron Transaction Hash")
         |> Map.put(:matches, [non_evm_match("tron", hash, :tx_path, "confirmed")])}

      _ ->
        :no_match
    end
  end

  defp build("sol_address", display, hash) do
    %{hash: hash, type: display, matches: [non_evm_match("solana", hash, :address_path, "likely")]}
  end

  defp build("sol_tx_sig", display, hash) do
    base = %{
      hash: hash,
      type: display,
      matches: [non_evm_match("solana", hash, :tx_path, "likely")]
    }

    case SolanaTx.fetch_tx_summary(hash) do
      {:ok, summary} -> Map.put(base, :summary, summary)
      _ -> base
    end
  end

  # Heuristic: Tron tx hashes are also 64-char hex but our regex classifies
  # them as evm_tx_hash. For a lookup that misses on all EVM probes, we can
  # fall through to a Tron probe — but per our current format detector, that
  # flow is already routed via evm_tx_hash → confirmed-chain check. Tron
  # isn't in our EVM chain list, so Tron txs that share hex format won't
  # auto-probe here. Users paste Tron tx hashes to our Hash Lookup by way
  # of the Tron explorer link in `matches`. (Future: add a Tron probe.)

  defp build("tron_address", display, hash) do
    %{hash: hash, type: display, matches: [non_evm_match("tron", hash, :address_path, "likely")]}
  end

  defp build(type, display, hash) when type in ["ltc_address", "ltc_bech32_address"] do
    %{
      hash: hash,
      type: display,
      matches: [non_evm_match("litecoin", hash, :address_path, "likely")]
    }
  end

  # ── Match constructors ──

  defp evm_match(chain, hash, path_template, confidence) do
    %{
      chain: chain.slug,
      chain_name: chain.name,
      color: chain.color,
      explorer_url: chain.explorer_base,
      explorer_link: chain.explorer_base <> String.replace(path_template, "{hash}", hash),
      confidence: confidence
    }
  end

  defp non_evm_match(key, hash, path_key, confidence) do
    cfg = Map.fetch!(@non_evm_chains, key)
    path = Map.fetch!(cfg, path_key)

    %{
      chain: cfg.chain,
      chain_name: cfg.chain_name,
      color: cfg.color,
      explorer_url: cfg.explorer_base,
      explorer_link: cfg.explorer_base <> String.replace(path, "{hash}", hash),
      confidence: confidence
    }
  end

  # ── EVM tx probing ──

  defp probe_evm_chains(hash) do
    probe_chains = ChainInfo.list() |> Enum.filter(& &1.probe)

    results =
      probe_chains
      |> Task.async_stream(
        fn chain ->
          case EvmRpc.call(chain.rpc_url, "eth_getTransactionByHash", [hash]) do
            {:ok, nil} -> {:no_hit, chain.slug}
            {:ok, _} -> {:hit, chain.slug}
            {:error, _} -> :error
          end
        end,
        max_concurrency: length(probe_chains),
        timeout: 5_000,
        on_timeout: :kill_task
      )
      |> Enum.to_list()

    confirmed =
      Enum.flat_map(results, fn
        {:ok, {:hit, slug}} -> [slug]
        _ -> []
      end)

    # `all_failed` means every probe errored/timed out (can't draw any conclusion);
    # distinct from "all probes returned :no_hit" (then we leave matches empty).
    all_failed =
      Enum.all?(results, fn r ->
        match?({:ok, :error}, r) or match?({:exit, :timeout}, r)
      end)

    {confirmed, all_failed}
  end
end
