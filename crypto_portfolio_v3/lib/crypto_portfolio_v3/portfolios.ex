defmodule CryptoPortfolioV3.Portfolios do
  @moduledoc """
  Portfolios + holdings + transactions. All queries are scoped to the
  authenticated user via explicit `user_id`.
  """

  import Ecto.Query

  alias CryptoPortfolioV3.{Repo, Market}
  alias CryptoPortfolioV3.Portfolios.{Portfolio, Holding, Transaction}

  @evm_address_re ~r/^0x[0-9a-fA-F]+$/

  # ── Portfolios ──────────────────────────────────────────────────────────────

  def list_portfolios_for_user(user_id) do
    Repo.all(from p in Portfolio, where: p.user_id == ^user_id, order_by: [asc: p.id])
  end

  def create_portfolio(user_id, attrs) when is_map(attrs) do
    attrs = Map.put(stringify(attrs), "user_id", user_id)

    %Portfolio{}
    |> Portfolio.changeset(attrs)
    |> Repo.insert()
  end

  def get_portfolio_for_user(user_id, id) do
    Repo.one(from p in Portfolio, where: p.id == ^id and p.user_id == ^user_id)
  end

  def get_portfolio_with_holdings(user_id, id) do
    Repo.one(
      from p in Portfolio,
        where: p.id == ^id and p.user_id == ^user_id,
        preload: [holdings: :coin]
    )
  end

  def delete_portfolio(%Portfolio{} = p), do: Repo.delete(p)

  @doc """
  Busts the price cache for every coin in the portfolio's holdings, re-fetches
  from CoinGecko, and persists. Returns the refreshed portfolio preloaded
  for immediate detail-rendering.
  """
  def refresh_portfolio_prices(user_id, portfolio_id) do
    case get_portfolio_with_holdings(user_id, portfolio_id) do
      nil ->
        {:error, :not_found}

      portfolio ->
        cg_ids =
          portfolio.holdings
          |> Enum.map(& &1.coin.coingecko_id)
          |> Enum.reject(&is_nil/1)
          |> Enum.uniq()

        {:ok, count} = Market.refresh_prices(cg_ids)
        refreshed = get_portfolio_with_holdings(user_id, portfolio_id)
        {:ok, count, refreshed}
    end
  end

  # ── Holdings ────────────────────────────────────────────────────────────────

  @doc """
  Creates a holding in the given portfolio. The coin must already exist in
  the DB (looked up by `coingecko_id`). Returns `{:error, :coin_not_found}`
  if not — on-demand coin creation arrives with the Market context.
  """
  def create_holding(portfolio_id, attrs) when is_map(attrs) do
    attrs = stringify(attrs)

    with cgid when is_binary(cgid) <- Map.get(attrs, "coingecko_id"),
         fallback = take_fallback(attrs),
         {:ok, coin} <- Market.get_or_create_coin(cgid, fallback) do
      changeset_attrs = %{
        "portfolio_id" => portfolio_id,
        "coin_id" => coin.id,
        "wallet_address" => normalize_wallet(Map.get(attrs, "wallet_address")),
        "chain" => Map.get(attrs, "chain"),
        "amount" => Map.get(attrs, "amount"),
        "avg_buy_price" => Map.get(attrs, "avg_buy_price")
      }

      %Holding{}
      |> Holding.changeset(changeset_attrs)
      |> Repo.insert()
      |> case do
        {:ok, h} -> {:ok, Repo.preload(h, :coin)}
        {:error, cs} -> {:error, cs}
      end
    else
      nil -> {:error, :missing_coingecko_id}
      {:error, reason} -> {:error, reason}
    end
  end

  # Optional caller-supplied metadata for unlisted tokens (e.g. imported
  # from a wallet contract read). Used only when CG 404s on this id.
  defp take_fallback(attrs) do
    %{}
    |> maybe_put(:symbol, Map.get(attrs, "symbol"))
    |> maybe_put(:name, Map.get(attrs, "name"))
    |> maybe_put(:image_url, Map.get(attrs, "image_url"))
    |> maybe_put(:contract_address, Map.get(attrs, "contract_address"))
  end

  defp maybe_put(map, _k, nil), do: map
  defp maybe_put(map, _k, ""), do: map
  defp maybe_put(map, k, v), do: Map.put(map, k, v)

  def get_holding_for_user(user_id, portfolio_id, holding_id) do
    Repo.one(
      from h in Holding,
        join: p in Portfolio,
        on: p.id == h.portfolio_id,
        where: h.id == ^holding_id and p.id == ^portfolio_id and p.user_id == ^user_id,
        preload: [:coin]
    )
  end

  def update_holding(%Holding{} = h, attrs) do
    attrs = stringify(attrs)
    # Lock down which fields can be patched — the changeset itself casts
    # portfolio_id/coin_id, so filter them out here to prevent client from
    # moving a holding to a different portfolio/coin via PATCH.
    allowed = Map.take(attrs, ["amount", "avg_buy_price"])

    h
    |> Holding.changeset(allowed)
    |> Repo.update()
  end

  def delete_holding(%Holding{} = h), do: Repo.delete(h)

  # ── Transactions ────────────────────────────────────────────────────────────

  def create_transaction(holding_id, attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify()
      |> Map.put("holding_id", holding_id)
      |> Map.put_new("occurred_at", DateTime.utc_now())

    %Transaction{}
    |> Transaction.changeset(attrs)
    |> Repo.insert()
  end

  def list_transactions_for_holding(holding_id) do
    Repo.all(
      from t in Transaction,
        where: t.holding_id == ^holding_id,
        order_by: [desc: t.occurred_at]
    )
  end

  # ── Helpers ─────────────────────────────────────────────────────────────────

  # EVM addresses (0x…hex) are case-insensitive — normalize for dedup.
  # Solana base58 is case-sensitive — preserve as-is.
  defp normalize_wallet(nil), do: nil
  defp normalize_wallet(""), do: nil

  defp normalize_wallet(addr) when is_binary(addr) do
    if Regex.match?(@evm_address_re, addr), do: String.downcase(addr), else: addr
  end

  defp normalize_wallet(_), do: nil

  # Accept both string- and atom-keyed maps; normalize to string keys for
  # Ecto's `cast/3`.
  defp stringify(%{} = m) do
    Map.new(m, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end
end
