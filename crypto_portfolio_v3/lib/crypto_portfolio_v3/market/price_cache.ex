defmodule CryptoPortfolioV3.Market.PriceCache do
  @moduledoc """
  Short-lived in-memory cache for external-API responses. Backed by an ETS
  table that this GenServer owns (so the table dies with the process, and
  its contents are rebuilt on restart — appropriate for TTL-bounded data).

  Reads bypass the GenServer (O(1) ETS lookup) for controller hot-path
  concurrency. Writes go through ETS directly too — last-write-wins is fine
  for TTL caches.
  """

  use GenServer

  @table :market_price_cache

  # ── Public API ──

  def start_link(_opts), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @spec get(term()) :: {:ok, term()} | :miss
  def get(key) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, key) do
      [{^key, expires_at, value}] when expires_at > now -> {:ok, value}
      _ -> :miss
    end
  end

  @spec put(term(), term(), non_neg_integer()) :: :ok
  def put(key, value, ttl_ms) do
    expires_at = System.monotonic_time(:millisecond) + ttl_ms
    :ets.insert(@table, {key, expires_at, value})
    :ok
  end

  @spec delete(term()) :: :ok
  def delete(key) do
    :ets.delete(@table, key)
    :ok
  end

  # ── Callbacks ──

  @impl true
  def init(_) do
    :ets.new(@table, [:set, :public, :named_table, read_concurrency: true])
    {:ok, nil}
  end
end
