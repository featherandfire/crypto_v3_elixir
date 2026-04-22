defmodule CryptoPortfolioV3.Chain.SolanaTx do
  @moduledoc """
  Solana transaction parsers:

    * `fetch_tx_summary/1` — compact display summary (used by /api/lookup)
    * `fetch_last_buy_fees/3` — scans recent signatures for the most recent
      buy of a target mint and returns a full fee breakdown.

  Reads `jsonParsed`-encoded tx data from the Solana RPC, walking
  `preTokenBalances` / `postTokenBalances` deltas per owner.
  """

  alias CryptoPortfolioV3.Chain.{SolanaMints, SolanaRpc}

  @min_change Decimal.new("0.000000001")
  @counterparty_threshold Decimal.from_float(0.2)
  @lamports_per_sol Decimal.new(1_000_000_000)

  # ── Public API ──

  @spec fetch_tx_summary(binary()) :: {:ok, map()} | {:error, term()}
  def fetch_tx_summary(signature) when is_binary(signature) do
    case SolanaRpc.get_transaction(signature) do
      {:ok, nil} -> {:error, :not_found}
      {:ok, raw} when is_map(raw) -> {:ok, parse_summary(raw)}
      {:error, _} = err -> err
    end
  end

  @spec fetch_last_buy_fees(binary(), binary(), keyword()) ::
          {:ok, map()} | {:error, :no_recent_buy | term()}
  def fetch_last_buy_fees(wallet, mint, opts \\ []) do
    lookback = Keyword.get(opts, :lookback, default_lookback())

    with {:ok, sigs} <- SolanaRpc.get_signatures_for_address(wallet, limit: lookback) do
      case find_matching_buy(sigs, wallet, mint) do
        nil -> {:error, :no_recent_buy}
        result -> {:ok, result}
      end
    end
  end

  # ── Matching loop ──

  defp find_matching_buy([], _wallet, _mint), do: nil

  defp find_matching_buy([sig_info | rest], wallet, mint) do
    sig = sig_info["signature"]
    block_time = sig_info["blockTime"]

    case SolanaRpc.get_transaction(sig) do
      {:ok, raw} when is_map(raw) ->
        case parse_structured(raw, wallet) do
          %{received: %{mint: ^mint}} = parsed ->
            build_last_buy_fees(parsed, sig, block_time || raw["blockTime"])

          _ ->
            find_matching_buy(rest, wallet, mint)
        end

      _ ->
        find_matching_buy(rest, wallet, mint)
    end
  end

  defp build_last_buy_fees(parsed, signature, block_time) do
    spread = spread_usd(parsed)
    fee_pct = fee_pct(parsed)

    %{
      signature: signature,
      block_time: block_time,
      router: parsed.router,
      routers: parsed.routers,
      fee_sol: parsed.fee_sol,
      fee_display: parsed.fee_display,
      sent: format_flow(parsed.sent),
      received: format_flow(parsed.received),
      fee_parties: parsed.fee_parties,
      spread_usd: spread,
      fee_pct: fee_pct
    }
  end

  defp spread_usd(%{sent: sent, received: received, fee_parties: parties})
       when not is_nil(sent) and not is_nil(received) do
    if SolanaMints.stable?(sent.mint) and SolanaMints.stable?(received.mint) do
      explicit_in_sent =
        parties
        |> Enum.filter(&(&1.mint == sent.mint))
        |> Enum.reduce(Decimal.new(0), fn p, acc -> Decimal.add(acc, p.amount) end)

      reached_pool = Decimal.sub(sent.amount, explicit_in_sent)
      diff = Decimal.sub(reached_pool, received.amount)
      if Decimal.gt?(diff, 0), do: diff, else: Decimal.new(0)
    end
  end

  defp spread_usd(_), do: nil

  defp fee_pct(%{sent: nil}), do: nil

  defp fee_pct(%{sent: sent, fee_parties: parties}) do
    if Decimal.gt?(sent.amount, 0) do
      in_sent =
        parties
        |> Enum.filter(&(&1.mint == sent.mint))
        |> Enum.reduce(Decimal.new(0), fn p, acc -> Decimal.add(acc, p.amount) end)

      in_sent |> Decimal.div(sent.amount) |> Decimal.mult(100)
    end
  end

  # ── parse_summary (for /api/lookup) ──

  defp parse_summary(tx) do
    meta = tx["meta"] || %{}
    msg = get_in(tx, ["transaction", "message"]) || %{}
    keys = Map.get(msg, "accountKeys", [])

    payer = get_in(Enum.at(keys, 0) || %{}, ["pubkey"]) || ""
    fee_sol = lamports_to_sol(meta["fee"] || 0)

    pre_tok = index_tokens(meta["preTokenBalances"] || [])
    post_tok = index_tokens(meta["postTokenBalances"] || [])
    all_idx = merged_indexes(pre_tok, post_tok)

    pre_bals = meta["preBalances"] || []
    post_bals = meta["postBalances"] || []

    {sol_sent, sol_received} = native_sol_delta(pre_bals, post_bals, fee_sol)

    {sent_items, recv_items, actor} =
      changes_for_actor(payer, keys, all_idx, pre_tok, post_tok)
      |> fallback_to_signer(keys, all_idx, pre_tok, post_tok, payer)

    router = detect_router(keys)
    fee_display = build_fee_display(recv_items, actor, all_idx, pre_tok, post_tok)

    to_addr = first_recipient(actor, all_idx, pre_tok, post_tok) || actor

    sent_part = first_display(sent_items, sol_sent, "SOL")
    recv_part = first_display(recv_items, sol_received, "SOL")

    value =
      case {sent_part, recv_part} do
        {nil, nil} -> nil
        {s, nil} -> s
        {nil, r} -> r
        {s, r} -> "#{s} → #{r}"
      end

    %{
      chain: "Solana",
      status: if(meta["err"], do: "failed", else: "success"),
      block_time: tx["blockTime"],
      from_addr: actor,
      from_addr_short: shorten(actor),
      to_addr: to_addr,
      to_addr_short: shorten(to_addr),
      value: value,
      fee_sol: "#{format_amount(fee_sol)} SOL",
      payer: payer,
      payer_short: shorten(payer),
      router: router,
      fee_display: fee_display
    }
  end

  # First try changes on payer; if none, fall through to each signer.
  defp fallback_to_signer({[], []}, keys, all_idx, pre_tok, post_tok, payer) do
    signer =
      keys
      |> Enum.drop(1)
      |> Enum.find(fn k -> k["signer"] == true end)

    case signer do
      nil ->
        {[], [], payer}

      %{"pubkey" => pk} ->
        {s, r} = changes_for_actor(pk, keys, all_idx, pre_tok, post_tok)

        if s == [] and r == [] do
          {[], [], payer}
        else
          {s, r, pk}
        end
    end
  end

  defp fallback_to_signer({sent, recv}, _keys, _idx, _pre, _post, payer),
    do: {sent, recv, payer}

  defp first_display([], zero, sym) do
    if Decimal.gt?(zero, @min_change), do: "#{format_amount(zero)} #{sym}"
  end

  defp first_display([first | _], _zero, _sym), do: "#{format_amount(first.amount)} #{first.symbol}"

  defp first_recipient(actor, all_idx, pre_tok, post_tok) do
    Enum.find_value(all_idx, fn idx ->
      pe = Map.get(pre_tok, idx)
      po = Map.get(post_tok, idx)
      ref = po || pe

      with %{"owner" => owner} when owner != actor <- ref,
           pre_amt = ui_amount(pe),
           post_amt = ui_amount(po),
           delta = Decimal.sub(post_amt, pre_amt),
           true <- Decimal.gt?(delta, @min_change) do
        owner
      else
        _ -> nil
      end
    end)
  end

  defp build_fee_display([], _actor, _all_idx, _pre_tok, _post_tok), do: nil

  defp build_fee_display([first | _], actor, all_idx, pre_tok, post_tok) do
    recv_mint = first.mint
    recv_amount = first.amount

    fee_gained =
      Enum.reduce(all_idx, Decimal.new(0), fn idx, acc ->
        pe = Map.get(pre_tok, idx)
        po = Map.get(post_tok, idx)
        ref = po || pe
        owner = if ref, do: ref["owner"], else: nil
        mint = if ref, do: ref["mint"], else: nil

        if owner && owner != actor && mint == recv_mint do
          pre_amt = ui_amount(pe)
          post_amt = ui_amount(po)
          delta = Decimal.sub(post_amt, pre_amt)
          if Decimal.gt?(delta, @min_change), do: Decimal.add(acc, delta), else: acc
        else
          acc
        end
      end)

    if Decimal.gt?(fee_gained, @min_change) do
      total = Decimal.add(recv_amount, fee_gained)

      pct =
        if Decimal.gt?(total, 0),
          do: fee_gained |> Decimal.div(total) |> Decimal.mult(100),
          else: nil

      fee_str =
        if SolanaMints.stable?(recv_mint) do
          "$#{Decimal.to_string(Decimal.round(fee_gained, 2), :normal)}"
        else
          "#{format_amount(fee_gained)} #{first.symbol}"
        end

      if pct, do: "#{fee_str} (#{Decimal.to_string(Decimal.round(pct, 2), :normal)}%)", else: fee_str
    end
  end

  # ── parse_structured (for last-buy-fees) ──

  defp parse_structured(tx, wallet) do
    meta = tx["meta"] || %{}
    msg = get_in(tx, ["transaction", "message"]) || %{}
    keys = Map.get(msg, "accountKeys", [])
    fee_sol = lamports_to_sol(meta["fee"] || 0)

    pre_tok = index_tokens(meta["preTokenBalances"] || [])
    post_tok = index_tokens(meta["postTokenBalances"] || [])
    all_idx = merged_indexes(pre_tok, post_tok)
    pre_bals = meta["preBalances"] || []
    post_bals = meta["postBalances"] || []

    actors =
      [wallet | Enum.flat_map(keys, fn k -> if k["signer"], do: [k["pubkey"]], else: [] end)]
      |> Enum.uniq()
      |> MapSet.new()

    received_flows =
      flows_for(wallet, keys, all_idx, pre_tok, post_tok, pre_bals, post_bals, fee_sol).recv

    if received_flows == [] do
      nil
    else
      all_sent =
        actors
        |> Enum.flat_map(fn actor ->
          flows_for(actor, keys, all_idx, pre_tok, post_tok, pre_bals, post_bals, fee_sol).sent
        end)

      sorted_sent = collapse_and_sort_sent(all_sent)

      [first_received | _] = received_flows
      received_mint = first_received.mint

      mints_of_interest =
        MapSet.new([received_mint | Enum.map(sorted_sent, & &1.mint)])

      fee_parties =
        compute_fee_parties(all_idx, pre_tok, post_tok, actors, mints_of_interest, sorted_sent)

      routers = detect_all_routers(keys)

      %{
        router: List.first(routers),
        routers: routers,
        fee_sol: "#{format_amount(fee_sol)} SOL",
        fee_display: build_fee_display(received_flows, wallet, all_idx, pre_tok, post_tok),
        sent: List.first(sorted_sent),
        received: first_received,
        fee_parties: fee_parties
      }
    end
  end

  defp collapse_and_sort_sent(sent) do
    sent
    |> Enum.reduce(%{}, fn s, acc ->
      case Map.get(acc, s.mint) do
        nil -> Map.put(acc, s.mint, s)
        %{amount: existing} when existing < s.amount -> Map.put(acc, s.mint, s)
        _ -> acc
      end
    end)
    |> Map.values()
    |> Enum.sort(fn a, b ->
      cond do
        a.mint == "SOL" and b.mint != "SOL" -> false
        b.mint == "SOL" and a.mint != "SOL" -> true
        true -> Decimal.compare(a.amount, b.amount) == :gt
      end
    end)
  end

  defp compute_fee_parties(all_idx, pre_tok, post_tok, actors, mints_of_interest, sorted_sent) do
    all_idx
    |> Enum.reduce(%{}, fn idx, acc ->
      pe = Map.get(pre_tok, idx)
      po = Map.get(post_tok, idx)
      ref = po || pe
      owner = if ref, do: ref["owner"], else: nil
      mint = if ref, do: ref["mint"], else: nil

      cond do
        is_nil(owner) -> acc
        MapSet.member?(actors, owner) -> acc
        is_nil(mint) or not MapSet.member?(mints_of_interest, mint) -> acc
        true ->
          pre_amt = ui_amount(pe)
          post_amt = ui_amount(po)
          delta = Decimal.sub(post_amt, pre_amt)

          if Decimal.gt?(delta, @min_change) do
            Map.update(acc, {owner, mint}, delta, &Decimal.add(&1, delta))
          else
            acc
          end
      end
    end)
    |> Enum.map(fn {{owner, mint}, amount} ->
      %{
        address_short: "#{String.slice(owner, 0, 4)}…#{String.slice(owner, -4, 4)}",
        amount: amount,
        symbol: mint_symbol(mint),
        mint: mint,
        is_stable: SolanaMints.stable?(mint)
      }
    end)
    |> Enum.reject(fn p ->
      # Swap counterparty: received > 20% of same-mint sent amount → pool, not fee.
      case Enum.find(sorted_sent, &(&1.mint == p.mint)) do
        %{amount: sent_amt} ->
          Decimal.compare(p.amount, Decimal.mult(sent_amt, @counterparty_threshold)) == :gt

        _ ->
          false
      end
    end)
    |> Enum.sort(fn a, b -> Decimal.compare(a.amount, b.amount) == :gt end)
  end

  # ── Flows (per owner) ──

  defp flows_for(owner, keys, all_idx, pre_tok, post_tok, pre_bals, post_bals, fee_sol) do
    token_flows =
      Enum.reduce(all_idx, %{sent: [], recv: []}, fn idx, acc ->
        pe = Map.get(pre_tok, idx)
        po = Map.get(post_tok, idx)
        ref = po || pe

        if ref && ref["owner"] == owner do
          mint = ref["mint"]
          delta = Decimal.sub(ui_amount(po), ui_amount(pe))
          change = %{mint: mint, symbol: mint_symbol(mint), amount: Decimal.abs(delta)}

          cond do
            Decimal.lt?(delta, Decimal.negate(@min_change)) ->
              %{acc | sent: [change | acc.sent]}

            Decimal.gt?(delta, @min_change) ->
              %{acc | recv: [change | acc.recv]}

            true ->
              acc
          end
        else
          acc
        end
      end)

    sol_leg = native_sol_for_owner(owner, keys, pre_bals, post_bals, fee_sol)

    %{sent: token_flows.sent ++ sol_leg.sent, recv: token_flows.recv ++ sol_leg.recv}
  end

  defp native_sol_for_owner(owner, keys, pre_bals, post_bals, fee_sol) do
    idx = Enum.find_index(keys, &(&1["pubkey"] == owner))

    with i when not is_nil(i) <- idx,
         pre = Enum.at(pre_bals, i),
         post = Enum.at(post_bals, i),
         true <- is_integer(pre) and is_integer(post) do
      net_lamports = post - pre
      fee_adj = if i == 0, do: Decimal.mult(fee_sol, @lamports_per_sol), else: Decimal.new(0)
      net_sol_lamports = Decimal.add(Decimal.new(net_lamports), fee_adj)
      net_sol = Decimal.div(net_sol_lamports, @lamports_per_sol)

      cond do
        Decimal.lt?(net_sol, Decimal.negate(@min_change)) ->
          %{sent: [%{mint: "SOL", symbol: "SOL", amount: Decimal.abs(net_sol)}], recv: []}

        Decimal.gt?(net_sol, @min_change) ->
          %{sent: [], recv: [%{mint: "SOL", symbol: "SOL", amount: net_sol}]}

        true ->
          %{sent: [], recv: []}
      end
    else
      _ -> %{sent: [], recv: []}
    end
  end

  defp native_sol_delta(pre_bals, post_bals, fee_sol) do
    with [pre | _] <- pre_bals,
         [post | _] <- post_bals,
         true <- is_integer(pre) and is_integer(post) do
      fee_lamports = Decimal.mult(fee_sol, @lamports_per_sol)
      net_lamports = Decimal.new(post - pre)
      net_sol_lamports = Decimal.add(net_lamports, fee_lamports)
      net_sol = Decimal.div(net_sol_lamports, @lamports_per_sol)

      cond do
        Decimal.lt?(net_sol, Decimal.negate(@min_change)) -> {Decimal.abs(net_sol), Decimal.new(0)}
        Decimal.gt?(net_sol, @min_change) -> {Decimal.new(0), net_sol}
        true -> {Decimal.new(0), Decimal.new(0)}
      end
    else
      _ -> {Decimal.new(0), Decimal.new(0)}
    end
  end

  defp changes_for_actor(actor, _keys, all_idx, pre_tok, post_tok) do
    Enum.reduce(all_idx, {[], []}, fn idx, {sent, recv} ->
      pe = Map.get(pre_tok, idx)
      po = Map.get(post_tok, idx)
      ref = po || pe

      if ref && ref["owner"] == actor do
        mint = ref["mint"]
        delta = Decimal.sub(ui_amount(po), ui_amount(pe))
        change = %{mint: mint, symbol: mint_symbol(mint), amount: Decimal.abs(delta)}

        cond do
          Decimal.lt?(delta, Decimal.negate(@min_change)) -> {[change | sent], recv}
          Decimal.gt?(delta, @min_change) -> {sent, [change | recv]}
          true -> {sent, recv}
        end
      else
        {sent, recv}
      end
    end)
  end

  # ── Low-level helpers ──

  defp index_tokens(list) do
    Enum.reduce(list, %{}, fn entry, acc ->
      case entry["accountIndex"] do
        nil -> acc
        i -> Map.put(acc, i, entry)
      end
    end)
  end

  defp merged_indexes(pre, post),
    do: pre |> Map.keys() |> MapSet.new() |> MapSet.union(MapSet.new(Map.keys(post)))

  defp ui_amount(nil), do: Decimal.new(0)

  defp ui_amount(%{"uiTokenAmount" => %{"amount" => raw, "decimals" => dec}})
       when is_binary(raw) and is_integer(dec) do
    case Integer.parse(raw) do
      {int, _} when int >= 0 ->
        Decimal.div(Decimal.new(int), Decimal.new(Integer.pow(10, dec)))

      _ ->
        Decimal.new(0)
    end
  end

  defp ui_amount(_), do: Decimal.new(0)

  defp mint_symbol(mint) do
    case SolanaMints.known(mint) do
      nil -> shorten_short(mint)
      sym -> sym
    end
  end

  defp shorten_short(addr), do: "#{String.slice(addr, 0, 6)}...#{String.slice(addr, -4, 4)}"

  defp shorten(""), do: ""
  defp shorten(addr), do: "#{String.slice(addr, 0, 6)}...#{String.slice(addr, -4, 4)}"

  defp detect_router(keys) do
    Enum.find_value(keys, fn k ->
      case k["pubkey"] do
        nil -> nil
        pk -> SolanaMints.router(pk)
      end
    end)
  end

  defp detect_all_routers(keys) do
    keys
    |> Enum.flat_map(fn k ->
      case SolanaMints.router(k["pubkey"] || "") do
        nil -> []
        r -> [r]
      end
    end)
    |> Enum.uniq()
  end

  defp lamports_to_sol(lamports) when is_integer(lamports),
    do: Decimal.div(Decimal.new(lamports), @lamports_per_sol)

  defp format_amount(%Decimal{} = amt) do
    amt
    |> Decimal.round(9)
    |> Decimal.to_string(:normal)
    |> trim_trailing_zeros()
  end

  defp trim_trailing_zeros(s) do
    if String.contains?(s, ".") do
      s |> String.trim_trailing("0") |> String.trim_trailing(".")
    else
      s
    end
  end

  defp format_flow(nil), do: nil
  defp format_flow(%{amount: amt, symbol: sym}), do: "#{format_amount(amt)} #{sym}"

  defp default_lookback,
    do: Application.fetch_env!(:crypto_portfolio_v3, :solana)[:last_buy_lookback]
end
