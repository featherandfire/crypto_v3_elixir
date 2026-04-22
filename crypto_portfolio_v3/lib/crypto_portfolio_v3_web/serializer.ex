defmodule CryptoPortfolioV3Web.Serializer do
  @moduledoc """
  JSON serialization helpers. Applies two project-wide conventions:

    * Decimals are emitted as strings (crypto-precision, not IEEE-754 doubles).
    * Timestamps are emitted as `created_at`/`updated_at` (REST convention),
      mapping from Ecto's `inserted_at`/`updated_at` internal names.
  """

  alias CryptoPortfolioV3.Accounts.User
  alias CryptoPortfolioV3.Market.Coin
  alias CryptoPortfolioV3.Portfolios.{Portfolio, Holding, Transaction}

  # ── User ────────────────────────────────────────────────────────────────────

  def user(%User{} = u) do
    %{
      id: u.id,
      username: u.username,
      email: u.email,
      is_verified: u.is_verified,
      created_at: u.inserted_at,
      updated_at: u.updated_at
    }
  end

  # ── Portfolio ──────────────────────────────────────────────────────────────

  def portfolio(%Portfolio{} = p) do
    %{
      id: p.id,
      user_id: p.user_id,
      name: p.name,
      created_at: p.inserted_at,
      updated_at: p.updated_at
    }
  end

  @doc """
  Portfolio with preloaded holdings + their coins. Computes per-holding
  `current_value_usd` / `pnl_usd` / `pnl_pct` and aggregate totals.
  Uses Decimal math throughout; strings at the serialization boundary.
  """
  def portfolio_detail(%Portfolio{holdings: holdings} = p) when is_list(holdings) do
    computed = Enum.map(holdings, &compute_holding/1)

    total_value = sum_decimals(Enum.map(computed, & &1.current_value_usd))
    total_cost = sum_decimals(Enum.map(computed, & &1.total_cost_usd))

    total_pnl =
      if total_value && total_cost, do: Decimal.sub(total_value, total_cost), else: nil

    total_pnl_pct = pct(total_pnl, total_cost)

    portfolio(p)
    |> Map.put(:holdings, Enum.map(computed, &serialize_computed_holding/1))
    |> Map.put(:total_value_usd, d_to_s(total_value))
    |> Map.put(:total_cost_usd, d_to_s(total_cost))
    |> Map.put(:total_pnl_usd, d_to_s(total_pnl))
    |> Map.put(:total_pnl_pct, d_to_s(total_pnl_pct))
  end

  # ── Holding ────────────────────────────────────────────────────────────────

  def holding(%Holding{} = h) do
    %{
      id: h.id,
      portfolio_id: h.portfolio_id,
      coin_id: h.coin_id,
      wallet_address: h.wallet_address,
      amount: d_to_s(h.amount),
      avg_buy_price: d_to_s(h.avg_buy_price),
      created_at: h.inserted_at,
      updated_at: h.updated_at
    }
  end

  def holding_with_coin(%Holding{coin: %Coin{} = c} = h) do
    Map.put(holding(h), :coin, coin(c))
  end

  # ── Coin ───────────────────────────────────────────────────────────────────

  def coin(%Coin{} = c) do
    %{
      id: c.id,
      coingecko_id: c.coingecko_id,
      symbol: c.symbol,
      name: c.name,
      current_price_usd: d_to_s(c.current_price_usd),
      price_change_24h: d_to_s(c.price_change_24h),
      market_cap: d_to_s(c.market_cap),
      image_url: c.image_url,
      last_updated: c.last_updated,
      circulating_supply: d_to_s(c.circulating_supply),
      max_supply: d_to_s(c.max_supply),
      contract_address: c.contract_address
    }
  end

  # ── Transaction ────────────────────────────────────────────────────────────

  def transaction(%Transaction{} = t) do
    %{
      id: t.id,
      holding_id: t.holding_id,
      type: t.type,
      amount: d_to_s(t.amount),
      price_usd: d_to_s(t.price_usd),
      occurred_at: t.occurred_at,
      note: t.note,
      created_at: t.inserted_at,
      updated_at: t.updated_at
    }
  end

  # ── Internals ──────────────────────────────────────────────────────────────

  defp compute_holding(%Holding{coin: %Coin{} = c} = h) do
    price = c.current_price_usd
    amount = h.amount || Decimal.new(0)
    avg_buy = h.avg_buy_price

    current_value = if price, do: Decimal.mult(amount, price), else: nil
    total_cost = if avg_buy, do: Decimal.mult(amount, avg_buy), else: nil
    pnl = if current_value && total_cost, do: Decimal.sub(current_value, total_cost), else: nil

    %{
      holding: h,
      current_value_usd: current_value,
      total_cost_usd: total_cost,
      pnl_usd: pnl,
      pnl_pct: pct(pnl, total_cost)
    }
  end

  defp serialize_computed_holding(%{holding: h} = c) do
    holding_with_coin(h)
    |> Map.put(:current_value_usd, d_to_s(c.current_value_usd))
    |> Map.put(:total_cost_usd, d_to_s(c.total_cost_usd))
    |> Map.put(:pnl_usd, d_to_s(c.pnl_usd))
    |> Map.put(:pnl_pct, d_to_s(c.pnl_pct))
  end

  defp pct(nil, _), do: nil
  defp pct(_, nil), do: nil

  defp pct(numer, denom) do
    if Decimal.gt?(denom, 0),
      do: numer |> Decimal.div(denom) |> Decimal.mult(100),
      else: nil
  end

  defp sum_decimals(values) do
    values
    |> Enum.reject(&is_nil/1)
    |> Enum.reduce(nil, fn v, nil -> v
      v, acc -> Decimal.add(acc, v)
    end)
  end

  defp d_to_s(nil), do: nil
  defp d_to_s(%Decimal{} = d), do: Decimal.to_string(d, :normal)
end
