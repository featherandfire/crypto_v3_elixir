defmodule CryptoPortfolioV3.Market do
  @moduledoc """
  Market-data context: coins, prices, and long-lived stats (yearly ranges,
  pct changes). Read path is DB-first; live CoinGecko calls happen on:

    * `/api/coins/top` — returns merged live + stored fields, upserts on success
    * `/api/coins/search` — live only (not cached)
    * `/api/coins/:id/history` — cached per (id, days)
    * `get_or_create_coin/2` — DB first, then CG, then stored-row fallback
  """

  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.Market.{Coin, CoinGecko, Fallbacks, PctChange, PriceCache, YearlyStat}

  # ── Coin lookups ───────────────────────────────────────────────────────────

  def get_coin_by_coingecko_id(id) when is_binary(id), do: Repo.get_by(Coin, coingecko_id: id)
  def get_coin_by_coingecko_id(_), do: nil

  @doc "Batched price fetch with PriceCache. Thin wrapper over the CG client."
  @spec fetch_prices([binary()]) :: {:ok, %{binary() => map()}}
  def fetch_prices(coingecko_ids), do: CoinGecko.list_prices(coingecko_ids)

  @doc """
  Busts the short-lived PriceCache for the given ids, re-fetches live from
  CoinGecko, and upserts into the `coins` table. Returns `{:ok, count}` with
  the number of rows updated/inserted. Used by `POST /api/portfolios/:id/refresh`.
  """
  @spec refresh_prices([binary()]) :: {:ok, non_neg_integer()}
  def refresh_prices([]), do: {:ok, 0}

  def refresh_prices(coingecko_ids) when is_list(coingecko_ids) do
    Enum.each(coingecko_ids, fn id -> PriceCache.delete({:price, id}) end)

    {:ok, price_map} = fetch_prices(coingecko_ids)
    upsert_from_price_records(price_map)
  end

  def get_coin_by_symbol(sym) when is_binary(sym) do
    Repo.one(from c in Coin, where: fragment("lower(?)", c.symbol) == ^String.downcase(sym), limit: 1)
  end

  @doc """
  DB → CoinGecko → fallback-metadata chain. If CG is down but the coin
  exists in DB, returns the stored row. If DB miss AND CG fails AND no
  fallback metadata, returns `{:error, :coin_not_found}`.
  """
  @spec get_or_create_coin(binary(), map()) :: {:ok, Coin.t()} | {:error, atom()}
  def get_or_create_coin(coingecko_id, fallback \\ %{}) when is_binary(coingecko_id) do
    case get_coin_by_coingecko_id(coingecko_id) do
      %Coin{} = coin ->
        {:ok, coin}

      nil ->
        case CoinGecko.list_prices([coingecko_id]) do
          {:ok, map} when is_map_key(map, coingecko_id) ->
            upsert_coin_from_cg(coingecko_id, Map.fetch!(map, coingecko_id), fallback)

          _ ->
            # CG missed — fall back to caller-supplied metadata (e.g. from an
            # unlisted ERC-20 contract read). No fallback → give up.
            insert_coin_from_fallback(coingecko_id, fallback)
        end
    end
  end

  # ── /api/coins/top ─────────────────────────────────────────────────────────

  @doc """
  Fetches top coins from CG, upserts into the `coins` table, and returns
  the merged result (storable fields + non-stored long-range changes).
  Falls back to DB on CG failure.
  """
  def list_top_coins(limit) when is_integer(limit) and limit > 0 do
    case CoinGecko.list_top(limit) do
      {:ok, raw} ->
        upsert_coins(raw)

        merged =
          Enum.map(raw, fn coin ->
            %{
              "coingecko_id" => coin["id"],
              "symbol" => coin["symbol"],
              "name" => coin["name"],
              "current_price_usd" => coin["current_price"],
              "price_change_24h" => coin["price_change_percentage_24h"],
              "market_cap" => coin["market_cap"],
              "image_url" => coin["image"],
              "circulating_supply" => coin["circulating_supply"],
              "max_supply" => coin["max_supply"],
              "price_change_200d" => coin["price_change_percentage_200d_in_currency"],
              "price_change_1y" => coin["price_change_percentage_1y_in_currency"],
              "last_updated" => DateTime.utc_now()
            }
          end)

        {:ok, merged}

      {:error, _reason} ->
        # DB fallback — numeric columns already Decimals; caller serializes.
        rows =
          Repo.all(
            from c in Coin,
              where: not is_nil(c.last_updated),
              order_by: [desc_nulls_last: c.market_cap],
              limit: ^limit
          )

        {:ok, Enum.map(rows, &coin_to_map/1)}
    end
  end

  # ── /api/coins/supply ──────────────────────────────────────────────────────

  def supply_map(limit) do
    with {:ok, raw} <- CoinGecko.list_top(limit) do
      map =
        raw
        |> Enum.reduce(%{}, fn c, acc ->
          Map.put(acc, String.upcase(c["symbol"] || ""), %{
            "circulating_supply" => c["circulating_supply"],
            "max_supply" => c["max_supply"]
          })
        end)

      {:ok, map}
    end
  end

  # ── /api/coins/:id/history ─────────────────────────────────────────────────

  def price_history(coingecko_id, days) do
    with {:ok, raw} <- CoinGecko.market_chart(coingecko_id, days) do
      prices = Enum.map(raw, fn [ts, price] -> %{"timestamp" => ts, "price" => price} end)
      {:ok, %{"coingecko_id" => coingecko_id, "prices" => prices}}
    end
  end

  # ── /api/coins/search ──────────────────────────────────────────────────────

  def search(query), do: CoinGecko.search(query)

  # ── /api/coins/yearly-ranges ───────────────────────────────────────────────

  def fetch_yearly_ranges(coingecko_ids) when is_list(coingecko_ids) do
    rows =
      Repo.all(
        from y in YearlyStat,
          where: y.coingecko_id in ^coingecko_ids
      )

    Map.new(rows, fn y ->
      {y.coingecko_id,
       %{
         "high_1y" => y.high_1y,
         "low_1y" => y.low_1y,
         "vol_90d" => y.vol_90d,
         "vol_180d" => y.vol_180d,
         "vol_365d" => y.vol_365d
       }}
    end)
  end

  # ── /api/cryptocompare/changes ─────────────────────────────────────────────

  def fetch_pct_changes(symbols, days_list) do
    upsyms = Enum.map(symbols, &String.upcase/1)

    rows =
      Repo.all(
        from p in PctChange,
          where: p.symbol in ^upsyms and p.days in ^days_list
      )

    Enum.reduce(rows, %{}, fn p, acc ->
      Map.update(acc, p.symbol, %{p.days => p.pct_change}, &Map.put(&1, p.days, p.pct_change))
    end)
  end

  # ── /api/cryptocompare/volatility ──────────────────────────────────────────
  #
  # Sourced from CoinGecko yearly stats, keyed by symbol via a JOIN on coins.

  def fetch_volatilities(symbols, days_list) do
    upsyms = Enum.map(symbols, &String.upcase/1)

    rows =
      Repo.all(
        from y in YearlyStat,
          join: c in Coin,
          on: c.coingecko_id == y.coingecko_id,
          where: fragment("upper(?)", c.symbol) in ^upsyms,
          select: {fragment("upper(?)", c.symbol), y}
      )

    Enum.reduce(rows, %{}, fn {sym, y}, acc ->
      all = %{90 => y.vol_90d, 180 => y.vol_180d, 365 => y.vol_365d}
      filtered = Map.take(all, days_list)
      Map.put(acc, sym, filtered)
    end)
  end

  # ── Contract lookups (used by Chain context) ───────────────────────────────

  @doc """
  Looks up CG metadata for each contract address on the given platform.
  Bounded concurrency = 3. Addresses that CG doesn't know return no entry.
  """
  def match_tokens_by_contract(addresses, platform) when is_list(addresses) do
    addresses
    |> Task.async_stream(
      fn addr -> {addr, CoinGecko.coin_by_contract(addr, platform)} end,
      max_concurrency: 3,
      timeout: 30_000,
      on_timeout: :kill_task
    )
    |> Enum.reduce(%{}, fn
      {:ok, {addr, {:ok, match}}}, acc -> Map.put(acc, addr, match)
      _, acc -> acc
    end)
  end

  @doc """
  Resolves a coin → contract address on a given platform. Tries live CG
  first, then the hardcoded fallback map. Persists back to `coins.contract_address`
  on success so subsequent lookups are instant.
  """
  def resolve_contract_address(coingecko_id, platform) do
    live =
      case CoinGecko.platforms(coingecko_id) do
        {:ok, platforms} -> Map.get(platforms, platform)
        _ -> nil
      end

    contract = live || Fallbacks.platform_contract(coingecko_id, platform)

    if contract && byte_size(contract) > 0 do
      maybe_persist_contract(coingecko_id, contract)
      {:ok, contract}
    else
      {:error, :not_found}
    end
  end

  # ── Internals ──────────────────────────────────────────────────────────────

  defp upsert_coins(raw_list) do
    now = DateTime.utc_now()

    rows =
      Enum.map(raw_list, fn c ->
        %{
          coingecko_id: c["id"],
          symbol: c["symbol"] || "",
          name: c["name"] || "",
          current_price_usd: to_decimal(c["current_price"]),
          price_change_24h: to_decimal(c["price_change_percentage_24h"]),
          market_cap: to_decimal(c["market_cap"]),
          image_url: c["image"],
          last_updated: now,
          circulating_supply: to_decimal(c["circulating_supply"]),
          max_supply: to_decimal(c["max_supply"]),
          inserted_at: now,
          updated_at: now
        }
      end)

    Repo.insert_all(Coin, rows,
      on_conflict: {:replace_all_except, [:id, :inserted_at, :contract_address]},
      conflict_target: :coingecko_id
    )
  end

  defp upsert_from_price_records(price_map) when map_size(price_map) == 0, do: {:ok, 0}

  defp upsert_from_price_records(price_map) do
    now = DateTime.utc_now()

    rows =
      Enum.map(price_map, fn {cg_id, rec} ->
        %{
          coingecko_id: cg_id,
          symbol: rec["symbol"] || "",
          name: rec["name"] || cg_id,
          current_price_usd: to_decimal(rec["current_price_usd"]),
          price_change_24h: to_decimal(rec["price_change_24h"]),
          market_cap: to_decimal(rec["market_cap"]),
          image_url: rec["image_url"],
          circulating_supply: to_decimal(rec["circulating_supply"]),
          max_supply: to_decimal(rec["max_supply"]),
          last_updated: now,
          inserted_at: now,
          updated_at: now
        }
      end)

    {count, _} =
      Repo.insert_all(Coin, rows,
        on_conflict: {:replace_all_except, [:id, :inserted_at, :contract_address]},
        conflict_target: :coingecko_id
      )

    {:ok, count}
  end

  defp upsert_coin_from_cg(coingecko_id, price_rec, fallback) do
    now = DateTime.utc_now()

    attrs = %{
      coingecko_id: coingecko_id,
      symbol: price_rec["symbol"] || Map.get(fallback, :symbol) || "",
      name: price_rec["name"] || Map.get(fallback, :name) || coingecko_id,
      current_price_usd: to_decimal(price_rec["current_price_usd"]),
      price_change_24h: to_decimal(price_rec["price_change_24h"]),
      market_cap: to_decimal(price_rec["market_cap"]),
      image_url: price_rec["image_url"] || Map.get(fallback, :image_url),
      last_updated: now,
      contract_address: Map.get(fallback, :contract_address)
    }

    case %Coin{} |> Coin.changeset(attrs) |> Repo.insert() do
      {:ok, coin} -> {:ok, coin}
      {:error, _} -> {:error, :coin_insert_failed}
    end
  end

  defp insert_coin_from_fallback(coingecko_id, fallback) do
    with %{symbol: sym, name: name} when is_binary(sym) and is_binary(name) <- fallback do
      now = DateTime.utc_now()

      attrs = %{
        coingecko_id: coingecko_id,
        symbol: sym,
        name: name,
        image_url: Map.get(fallback, :image_url),
        last_updated: now,
        contract_address: Map.get(fallback, :contract_address)
      }

      %Coin{}
      |> Coin.changeset(attrs)
      |> Repo.insert()
    else
      _ -> {:error, :coin_not_found}
    end
  end

  defp maybe_persist_contract(coingecko_id, contract) do
    case get_coin_by_coingecko_id(coingecko_id) do
      %Coin{contract_address: ^contract} -> :ok
      %Coin{} = coin ->
        coin
        |> Coin.changeset(%{contract_address: contract})
        |> Repo.update()
        :ok

      nil ->
        :ok
    end
  end

  defp coin_to_map(%Coin{} = c) do
    %{
      "coingecko_id" => c.coingecko_id,
      "symbol" => c.symbol,
      "name" => c.name,
      "current_price_usd" => c.current_price_usd,
      "price_change_24h" => c.price_change_24h,
      "market_cap" => c.market_cap,
      "image_url" => c.image_url,
      "circulating_supply" => c.circulating_supply,
      "max_supply" => c.max_supply,
      "last_updated" => c.last_updated,
      "price_change_200d" => nil,
      "price_change_1y" => nil
    }
  end

  defp to_decimal(nil), do: nil
  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)
  defp to_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, _} -> d
      :error -> nil
    end
  end
end
