defmodule CryptoPortfolioV3Web.WalletController do
  use CryptoPortfolioV3Web, :controller

  alias CryptoPortfolioV3.{Chain, Market}
  alias CryptoPortfolioV3.Market.Fallbacks

  @evm_address_re ~r/^0x[0-9a-fA-F]{40}$/
  @sol_address_re ~r/^[1-9A-HJ-NP-Za-km-z]{32,44}$/
  @tron_address_re ~r/^T[1-9A-HJ-NP-Za-km-z]{33}$/

  action_fallback CryptoPortfolioV3Web.FallbackController

  def chains(conn, _) do
    chains =
      Chain.list_chains()
      |> Enum.map(fn c ->
        %{
          "slug" => c.slug,
          "name" => c.name,
          "native_symbol" => c.native_symbol
        }
      end)

    json(conn, %{chains: chains})
  end

  def chain_balances(conn, %{"chain" => chain, "address" => address}) do
    cond do
      not Regex.match?(@evm_address_re, address) ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Invalid EVM address format"})

      true ->
        # EVM addresses are case-insensitive — normalize for consistency.
        case Chain.fetch_wallet_balances(String.downcase(address), chain) do
          {:ok, balances} ->
            json(conn, %{balances: Enum.map(balances, &serialize_enriched/1)})

          {:error, :unknown_chain} ->
            conn
            |> put_status(:not_found)
            |> json(%{error: "Unsupported chain: #{chain}"})
        end
    end
  end

  @doc """
  GET /api/wallet/:chain/:address/last-buy-fees?coingecko_id=…&contract_address=…
  Resolves target token via `contract_address` (direct) or `coingecko_id`
  (DB lookup → CG backfill), then parses the most recent buy tx for fees.
  """
  def last_buy_fees(conn, %{"chain" => chain, "address" => address} = params) do
    cond do
      not Regex.match?(@evm_address_re, address) ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Invalid EVM address"})

      is_nil(Chain.list_chains() |> Enum.find(&(&1.slug == chain))) ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Unsupported chain: #{chain}"})

      true ->
        wallet = String.downcase(address)

        case resolve_contract(params, chain) do
          {:error, :no_contract} ->
            conn
            |> put_status(:not_found)
            |> json(%{error: "No contract_address known for this coin"})

          {:ok, contract} ->
            case Chain.last_buy_fees(chain, wallet, contract) do
              {:ok, result} ->
                json(conn, %{fees: serialize_fees(result)})

              {:error, :no_recent_buy} ->
                conn
                |> put_status(:not_found)
                |> json(%{error: "No recent buy found"})

              {:error, reason} ->
                conn
                |> put_status(:bad_gateway)
                |> json(%{error: "Chain error: #{inspect(reason)}"})
            end
        end
    end
  end

  # Direct contract_address wins; else resolve from CoinGecko + backfill to DB.
  defp resolve_contract(%{"contract_address" => ca}, _chain) when is_binary(ca) and ca != "",
    do: {:ok, String.downcase(ca)}

  defp resolve_contract(%{"coingecko_id" => cgid}, chain_slug) when is_binary(cgid) and cgid != "" do
    case Market.get_coin_by_coingecko_id(cgid) do
      %{contract_address: ca} when is_binary(ca) and ca != "" ->
        {:ok, String.downcase(ca)}

      _ ->
        cg_platform = chain_cg_platform(chain_slug)

        case Market.resolve_contract_address(cgid, cg_platform) do
          {:ok, ca} -> {:ok, String.downcase(ca)}
          _ -> {:error, :no_contract}
        end
    end
  end

  defp resolve_contract(_, _), do: {:error, :no_contract}

  defp chain_cg_platform(slug) do
    case Chain.list_chains() |> Enum.find(&(&1.slug == slug)) do
      %{cg_platform: p} -> p
      _ -> nil
    end
  end

  def solana_last_buy_fees(conn, %{"address" => address} = params) do
    cond do
      not Regex.match?(@sol_address_re, address) ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Invalid Solana address"})

      true ->
        case resolve_solana_mint(params) do
          {:ok, mint} ->
            case Chain.solana_last_buy_fees(address, mint) do
              {:ok, result} ->
                json(conn, %{fees: serialize_sol_fees(result)})

              {:error, :no_recent_buy} ->
                conn |> put_status(:not_found) |> json(%{error: "No recent buy found"})

              {:error, reason} ->
                conn
                |> put_status(:bad_gateway)
                |> json(%{error: "Solana RPC error: #{inspect(reason)}"})
            end

          :error ->
            conn
            |> put_status(:not_found)
            |> json(%{error: "Unknown SPL mint — cannot resolve fees for this holding"})
        end
    end
  end

  defp resolve_solana_mint(%{"mint" => mint}) when is_binary(mint) and mint != "", do: {:ok, mint}

  defp resolve_solana_mint(%{"coingecko_id" => cgid}) when is_binary(cgid) and cgid != "" do
    case Fallbacks.solana_mint_for_cg_id(cgid) do
      nil -> :error
      mint -> {:ok, mint}
    end
  end

  defp resolve_solana_mint(_), do: :error

  defp serialize_sol_fees(r) do
    %{
      "signature" => r.signature,
      "block_time" => r.block_time,
      "router" => r.router,
      "routers" => r.routers,
      "fee_sol" => r.fee_sol,
      "fee_display" => r.fee_display,
      "sent" => r.sent,
      "received" => r.received,
      "fee_parties" => Enum.map(r.fee_parties, &serialize_sol_fee_party/1),
      "spread_usd" => d2s(r.spread_usd),
      "fee_pct" => d2s(r.fee_pct)
    }
  end

  defp serialize_sol_fee_party(p) do
    %{
      "address_short" => p.address_short,
      "amount" => Decimal.to_string(p.amount, :normal),
      "symbol" => p.symbol,
      "mint" => p.mint,
      "is_stable" => p.is_stable
    }
  end

  def solana_balances(conn, %{"address" => address}) do
    if Regex.match?(@sol_address_re, address) do
      case Chain.fetch_solana_wallet_balances(address) do
        {:ok, balances} ->
          json(conn, %{balances: Enum.map(balances, &serialize_enriched/1)})

        {:error, reason} ->
          conn
          |> put_status(:bad_gateway)
          |> json(%{error: "Solana RPC error: #{inspect(reason)}"})
      end
    else
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{error: "Invalid Solana address format"})
    end
  end

  def all(conn, %{"address" => address}) do
    cond do
      Regex.match?(@evm_address_re, address) ->
        {:ok, balances} = Chain.fetch_wallet_balances_all_evm(String.downcase(address))
        json(conn, %{balances: Enum.map(balances, &serialize_enriched/1)})

      # Tron uses T-prefix base58 (34 chars) — check before Solana since Solana
      # also uses base58 and a T-prefixed 34-char string would match both regexes.
      Regex.match?(@tron_address_re, address) ->
        {:ok, balances} = Chain.fetch_tron_wallet_balances(address)
        json(conn, %{balances: Enum.map(balances, &serialize_enriched/1)})

      Regex.match?(@sol_address_re, address) ->
        case Chain.fetch_solana_wallet_balances(address) do
          {:ok, balances} ->
            json(conn, %{balances: Enum.map(balances, &serialize_enriched/1)})

          {:error, reason} ->
            conn
            |> put_status(:bad_gateway)
            |> json(%{error: "Solana RPC error: #{inspect(reason)}"})
        end

      true ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "Invalid address format (expected EVM 0x… / Tron T… / Solana base58)"
        })
    end
  end

  def tron_balances(conn, %{"address" => address}) do
    if Regex.match?(@tron_address_re, address) do
      {:ok, balances} = Chain.fetch_tron_wallet_balances(address)
      json(conn, %{balances: Enum.map(balances, &serialize_enriched/1)})
    else
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{error: "Invalid Tron address format"})
    end
  end

  def from_tx(conn, %{"hash" => hash}) do
    case Chain.resolve_from_tx(String.trim(hash)) do
      {:ok, result} ->
        json(conn, result)

      {:error, :unsupported_format} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "Unsupported transaction hash format"})

      {:error, :not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "Transaction not found on any supported chain"})
    end
  end

  defp serialize_enriched(b) do
    %{
      "coingecko_id" => b.coingecko_id,
      "contract_address" => b.contract_address,
      "chain" => b.chain,
      "chain_name" => b.chain_name,
      "symbol" => b.symbol,
      "name" => b.name,
      "amount" => Decimal.to_string(b.amount, :normal),
      "decimals" => b.decimals,
      "current_price_usd" => n2s(b.current_price_usd),
      "image_url" => b.image_url,
      "matched" => b.matched
    }
  end

  defp n2s(nil), do: nil
  defp n2s(%Decimal{} = d), do: Decimal.to_string(d, :normal)
  defp n2s(n) when is_integer(n), do: Integer.to_string(n)
  defp n2s(n) when is_float(n), do: Float.to_string(n)
  defp n2s(s) when is_binary(s), do: s

  defp serialize_fees(r) do
    %{
      "signature" => r.signature,
      "block_time" => r.block_time,
      "router" => r.router,
      "routers" => r.routers,
      "fee_sol" => r.fee_sol,
      "fee_display" => r.fee_display,
      "sent" => r.sent,
      "received" => r.received,
      "fee_parties" => Enum.map(r.fee_parties, &serialize_fee_party/1),
      "spread_usd" => r.spread_usd,
      "fee_pct" => d2s(r.fee_pct)
    }
  end

  defp serialize_fee_party(p) do
    %{
      "address_short" => p.address_short,
      "amount" => Decimal.to_string(p.amount, :normal),
      "symbol" => p.symbol,
      "mint" => p.mint,
      "is_stable" => p.is_stable
    }
  end

  defp d2s(nil), do: nil
  defp d2s(%Decimal{} = d), do: Decimal.to_string(d, :normal)
end
