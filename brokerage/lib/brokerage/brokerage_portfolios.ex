defmodule Brokerage.BrokeragePortfolios do
  @moduledoc """
  Brokerage-side portfolios — user-named buckets for grouping stock
  positions ("Retirement", "Travel Fund", etc.). All queries are scoped
  to `user_id`. The user's first portfolio (auto-created on first GET)
  is flagged `is_main: true`; this is the destination for external
  Add-Funds deposits and is hidden from the chip strip in the UI.
  """

  import Ecto.Query

  alias Brokerage.Repo
  alias Brokerage.BrokeragePortfolios.{Portfolio, PositionAllocation}

  @main_color "#b44dff"

  def list_for_user(user_id) when is_integer(user_id) do
    Repo.all(
      from p in Portfolio,
        where: p.user_id == ^user_id,
        order_by: [desc: p.is_main, asc: p.id]
    )
  end

  @doc """
  Lists the user's brokerage portfolios. If the user has none, auto-creates
  a starter portfolio named `#<user_id>` with `is_main: true` and returns
  the single-element list. The unique index on `(user_id, is_main)` keeps
  this idempotent under concurrent first-GET requests.
  """
  def list_or_seed(user_id) when is_integer(user_id) do
    case list_for_user(user_id) do
      [] ->
        case create_main(user_id) do
          {:ok, _} -> list_for_user(user_id)
          # Lost the race to a sibling request — re-list and return whatever
          # the winner inserted.
          {:error, _changeset} -> list_for_user(user_id)
        end

      ports ->
        ports
    end
  end

  defp create_main(user_id) do
    %Portfolio{}
    |> Portfolio.changeset(%{
      user_id: user_id,
      name: "##{user_id}",
      color: @main_color,
      is_main: true
    })
    |> Repo.insert()
  end

  def get_for_user(user_id, id) do
    Repo.one(from p in Portfolio, where: p.user_id == ^user_id and p.id == ^id)
  end

  def create(user_id, attrs) when is_integer(user_id) and is_map(attrs) do
    attrs =
      attrs
      |> stringify()
      |> Map.put("user_id", user_id)
      # is_main is reserved for the auto-created starter — clients can't set it.
      |> Map.put("is_main", false)

    %Portfolio{}
    |> Portfolio.changeset(attrs)
    |> Repo.insert()
  end

  def update(%Portfolio{} = p, attrs) when is_map(attrs) do
    # is_main and user_id are immutable from the API surface.
    attrs = attrs |> stringify() |> Map.drop(["is_main", "user_id"])

    p
    |> Portfolio.changeset(attrs)
    |> Repo.update()
  end

  def delete(%Portfolio{is_main: true}), do: {:error, :cannot_delete_main}
  def delete(%Portfolio{} = p), do: Repo.delete(p)

  defp stringify(%{} = m) do
    Map.new(m, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      {k, v} -> {k, v}
    end)
  end

  # ── Position allocations ────────────────────────────────────────────────

  @doc """
  All allocations belonging to portfolios owned by `user_id`. Joins
  through the portfolio so ownership is enforced at the query level.
  """
  def list_allocations_for_user(user_id) when is_integer(user_id) do
    Repo.all(
      from a in PositionAllocation,
        join: p in Portfolio,
        on: p.id == a.portfolio_id,
        where: p.user_id == ^user_id,
        order_by: [asc: a.symbol, asc: a.portfolio_id]
    )
  end

  @doc """
  Replaces the user's allocations for `symbol` with the given map of
  `portfolio_id => qty`. Entries with qty <= 0 are dropped. If any
  `portfolio_id` doesn't belong to the user, the whole call rolls back
  with `{:error, {:invalid_portfolio_ids, [...]}}`. Atomic delete-then-
  insert so the row set always matches what the client sent.
  """
  def set_allocations(user_id, symbol, allocations)
      when is_integer(user_id) and is_binary(symbol) and is_map(allocations) do
    Repo.transaction(fn ->
      submitted_pids =
        allocations
        |> Map.keys()
        |> Enum.map(&to_int/1)
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq()

      owned_pids =
        Repo.all(
          from p in Portfolio, where: p.user_id == ^user_id, select: p.id
        )

      invalid = submitted_pids -- owned_pids

      if invalid != [] do
        Repo.rollback({:invalid_portfolio_ids, invalid})
      end

      from(a in PositionAllocation,
        join: p in Portfolio,
        on: p.id == a.portfolio_id,
        where: p.user_id == ^user_id and a.symbol == ^symbol
      )
      |> Repo.delete_all()

      now = DateTime.utc_now()

      inserts =
        allocations
        |> Enum.flat_map(fn {pid, qty} ->
          with pid_int when is_integer(pid_int) <- to_int(pid),
               %Decimal{} = q <- to_decimal(qty),
               :gt <- Decimal.compare(q, Decimal.new(0)) do
            [
              %{
                portfolio_id: pid_int,
                symbol: symbol,
                qty: q,
                inserted_at: now,
                updated_at: now
              }
            ]
          else
            _ -> []
          end
        end)

      if inserts != [] do
        Repo.insert_all(PositionAllocation, inserts)
      end

      list_allocations_for_user_and_symbol(user_id, symbol)
    end)
  end

  defp list_allocations_for_user_and_symbol(user_id, symbol) do
    Repo.all(
      from a in PositionAllocation,
        join: p in Portfolio,
        on: p.id == a.portfolio_id,
        where: p.user_id == ^user_id and a.symbol == ^symbol,
        order_by: [asc: a.portfolio_id]
    )
  end

  defp to_int(n) when is_integer(n), do: n

  defp to_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {i, ""} -> i
      _ -> nil
    end
  end

  defp to_int(_), do: nil

  defp to_decimal(%Decimal{} = d), do: d
  defp to_decimal(n) when is_integer(n), do: Decimal.new(n)
  defp to_decimal(n) when is_float(n), do: Decimal.from_float(n)

  defp to_decimal(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> d
      _ -> nil
    end
  end

  defp to_decimal(_), do: nil
end
