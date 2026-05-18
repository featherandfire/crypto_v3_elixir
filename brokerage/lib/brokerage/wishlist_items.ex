defmodule Brokerage.WishlistItems do
  @moduledoc """
  User wishlist context. Each row is a single user-authorized conditional
  order — symbol + qty + order params — that the auto-execute worker
  will fire when funds settle on the user's brokerage account.

  All write functions stamp `authorized_at` (server clock) and
  `authorized_ip` (caller-provided, from `conn.remote_ip`). Clients
  never supply those — they're proof the user (not the platform)
  authorized each line.
  """

  import Ecto.Query

  alias Brokerage.Repo
  alias Brokerage.WishlistItems.Item

  @doc """
  List the user's wishlist ordered by `position` (FIFO when status is
  pending). Includes filled/canceled rows so the UI can show history.
  """
  def list_for_user(user_id) when is_integer(user_id) do
    Repo.all(
      from i in Item,
        where: i.user_id == ^user_id,
        order_by: [asc: i.position, asc: i.id]
    )
  end

  def get_for_user(user_id, id) when is_integer(user_id) do
    Repo.one(from i in Item, where: i.user_id == ^user_id and i.id == ^id)
  end

  @doc """
  Adds-or-updates a wishlist entry for `(user_id, symbol)`. Re-adding
  an existing symbol overwrites qty + order params (and re-stamps
  authorization); doesn't create a duplicate row.

  Required attrs: `:symbol`, `:qty`. Optional: `:side`, `:order_type`,
  `:limit_price`, `:time_in_force`. `:authorized_ip` is passed through
  if provided; `:authorized_at` is set to now.
  """
  def upsert(user_id, attrs) when is_integer(user_id) and is_map(attrs) do
    attrs = stringify(attrs)
    symbol = normalize_symbol(attrs["symbol"])

    if symbol in [nil, ""] do
      {:error, :symbol_required}
    else
      now = DateTime.utc_now()

      params =
        attrs
        |> Map.put("user_id", user_id)
        |> Map.put("symbol", symbol)
        |> Map.put("authorized_at", now)
        # Status only set by upsert when creating; preserved otherwise.
        |> Map.delete("status")

      existing = Repo.one(from i in Item, where: i.user_id == ^user_id and i.symbol == ^symbol)

      cond do
        is_nil(existing) ->
          # New row — append to end of user's list.
          next_pos = next_position(user_id)

          %Item{}
          |> Item.changeset(Map.put(params, "position", next_pos))
          |> Repo.insert()

        true ->
          # Existing row — re-authorize and update params, but keep
          # the same `position` so the user's ordering doesn't shuffle.
          existing
          |> Item.changeset(Map.delete(params, "position"))
          |> Repo.update()
      end
    end
  end

  @doc """
  Pending entries for a user, ordered for FIFO auto-execution. The
  background worker that fires orders on deposit settlement walks this
  list and stops once cash is exhausted, so `position` ascending matters.
  """
  def list_pending_for_user(user_id) when is_integer(user_id) do
    Repo.all(
      from i in Item,
        where: i.user_id == ^user_id and i.status == "pending",
        order_by: [asc: i.position, asc: i.id]
    )
  end

  @doc """
  Flips an item to `filled` and records the Alpaca order id that was
  placed for it. Audit hook: combined with `authorized_at` / `authorized_ip`
  on the row, this is the full "user authorized X, platform placed Y at
  Z" chain that we'd need to defend the trade in a compliance review.
  """
  def mark_filled(%Item{} = item, alpaca_order_id) when is_binary(alpaca_order_id) do
    item
    |> Item.changeset(%{
      status: "filled",
      executed_at: DateTime.utc_now(),
      executed_order_id: alpaca_order_id
    })
    |> Repo.update()
  end

  @doc """
  Flips an item to `failed`. The reason is logged at the call site
  rather than persisted — the row's role from this point is just
  "don't retry this in the next fill pass." If we need per-row error
  text in the UI later, add a `note` column.
  """
  def mark_failed(%Item{} = item) do
    item
    |> Item.changeset(%{status: "failed", executed_at: DateTime.utc_now()})
    |> Repo.update()
  end

  @doc """
  Removes a wishlist entry. No-op if it doesn't belong to the user.
  """
  def delete(user_id, id) when is_integer(user_id) do
    case get_for_user(user_id, id) do
      nil -> {:error, :not_found}
      %Item{} = item -> Repo.delete(item)
    end
  end

  @doc """
  Reorders the user's wishlist. `ordered_ids` is the full new sequence
  of row ids (rejected if it doesn't match the user's current set). Done
  in a single transaction so partial reorders aren't observable.
  """
  def reorder(user_id, ordered_ids) when is_integer(user_id) and is_list(ordered_ids) do
    Repo.transaction(fn ->
      owned =
        Repo.all(from i in Item, where: i.user_id == ^user_id, select: i.id)
        |> MapSet.new()

      submitted = MapSet.new(ordered_ids)

      if not MapSet.equal?(owned, submitted) do
        Repo.rollback(:id_set_mismatch)
      end

      now = DateTime.utc_now()

      ordered_ids
      |> Enum.with_index()
      |> Enum.each(fn {id, idx} ->
        Repo.update_all(
          from(i in Item, where: i.user_id == ^user_id and i.id == ^id),
          set: [position: idx, updated_at: now]
        )
      end)

      list_for_user(user_id)
    end)
  end

  defp next_position(user_id) do
    Repo.one(
      from i in Item,
        where: i.user_id == ^user_id,
        select: coalesce(max(i.position), -1)
    )
    |> Kernel.+(1)
  end

  defp normalize_symbol(nil), do: nil
  defp normalize_symbol(s) when is_binary(s), do: s |> String.trim() |> String.upcase()
  defp normalize_symbol(_), do: nil

  defp stringify(%{} = m) do
    Map.new(m, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end
end
