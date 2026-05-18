defmodule CryptoPortfolioV3.RecurringInvestments do
  @moduledoc """
  User-configured recurring buy/sell schedules. Each row says "on this
  cadence, place this order against the user's Alpaca account."

  Three concerns live here:

    * CRUD — list / create / update / cancel a user's schedules.
    * Cadence math — given a frequency, compute the next run timestamp
      after a given anchor (used both on creation and after each fill).
    * Execution — pluck due rows, fire them, advance them. The Scheduler
      GenServer (`CryptoPortfolioV3.RecurringInvestments.Scheduler`) is
      what calls `execute_due/0` on a tick interval.

  Authorization audit (`authorized_at`, `authorized_ip`) mirrors the
  wishlist's pattern. The user authorized the schedule once; each fill
  is just the schedule firing — same compliance reasoning as wishlist
  auto-execute.
  """

  import Ecto.Query
  require Logger

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.{BrokerageAccounts, BrokerFunding.Client}
  alias CryptoPortfolioV3.RecurringInvestments.Investment

  # ── CRUD ───────────────────────────────────────────────────────────────

  def list_for_user(user_id) when is_integer(user_id) do
    Repo.all(
      from r in Investment,
        where: r.user_id == ^user_id,
        order_by: [desc: r.is_active, asc: r.next_run_at, desc: r.id]
    )
  end

  def get_for_user(user_id, id) when is_integer(user_id) do
    Repo.one(from r in Investment, where: r.user_id == ^user_id and r.id == ^id)
  end

  def create(user_id, attrs, opts \\ []) when is_integer(user_id) and is_map(attrs) do
    now = DateTime.utc_now()
    ip = Keyword.get(opts, :authorized_ip)

    starts_at =
      case parse_starts_at(Map.get(attrs, "starts_at") || Map.get(attrs, :starts_at)) do
        {:ok, dt} -> dt
        # Default: start tomorrow at the same wall clock. Avoids same-tick
        # double-fire (creating + tick at the same second).
        _ -> DateTime.add(now, 24 * 3600, :second)
      end

    frequency = Map.get(attrs, "frequency") || Map.get(attrs, :frequency) || "monthly"

    params =
      attrs
      |> Map.put("user_id", user_id)
      |> Map.put("starts_at", starts_at)
      |> Map.put("next_run_at", starts_at)
      |> Map.put("frequency", frequency)
      |> Map.put("authorized_at", now)
      |> Map.put("authorized_ip", ip)

    %Investment{}
    |> Investment.changeset(params)
    |> Repo.insert()
  end

  def update(%Investment{} = investment, attrs) do
    investment
    |> Investment.changeset(attrs)
    |> Repo.update()
  end

  @doc "Soft-cancel — leaves the row for audit but stops scheduling fires."
  def cancel(%Investment{} = investment),
    # Fully qualified to avoid the Ecto.Query macro `update/2` that
    # `import Ecto.Query` brings into scope.
    do: __MODULE__.update(investment, %{is_active: false})

  def delete(%Investment{} = investment), do: Repo.delete(investment)

  # ── Execution ──────────────────────────────────────────────────────────

  @doc """
  Returns every active row whose next_run_at has passed. Called by the
  scheduler on each tick.
  """
  def list_due(now \\ DateTime.utc_now()) do
    Repo.all(
      from r in Investment,
        where: r.is_active == true and r.next_run_at <= ^now,
        order_by: [asc: r.next_run_at]
    )
  end

  @doc """
  Fires every due schedule synchronously. Per-row failures are logged
  and the next_run_at gets advanced regardless (we don't loop on the
  same failed row forever; the user can retry by editing the schedule).
  Returns the count of attempted runs.
  """
  def execute_due do
    due = list_due()

    Enum.each(due, fn investment ->
      try do
        execute_one(investment)
      rescue
        e ->
          Logger.error(
            "Recurring investment ##{investment.id} crashed: #{Exception.message(e)}"
          )

          advance(investment)
      end
    end)

    length(due)
  end

  defp execute_one(%Investment{} = investment) do
    case BrokerageAccounts.active_alpaca_account_id(investment.user_id) do
      {:ok, account_id} ->
        body =
          %{
            symbol: investment.symbol,
            qty: Decimal.to_string(investment.qty, :normal),
            side: investment.side,
            type: investment.order_type,
            time_in_force: investment.time_in_force
          }
          |> maybe_put_limit(investment)

        case Client.place_order(account_id, body) do
          {:ok, _} ->
            Logger.info(
              "Recurring investment ##{investment.id} placed #{investment.side} #{investment.qty} #{investment.symbol}"
            )

            CryptoPortfolioV3.Notifications.recurring_fired(investment.user_id, investment)

          {:error, reason} ->
            Logger.warning(
              "Recurring investment ##{investment.id} failed: #{inspect(reason)}"
            )
        end

      {:error, reason} ->
        Logger.info(
          "Recurring investment ##{investment.id} skipped (user not onboarded): #{inspect(reason)}"
        )
    end

    advance(investment)
  end

  defp maybe_put_limit(body, %Investment{order_type: "limit", limit_price: %Decimal{} = lp}),
    do: Map.put(body, :limit_price, Decimal.to_string(lp, :normal))

  defp maybe_put_limit(body, _), do: body

  defp advance(%Investment{} = investment) do
    next = next_run(investment.next_run_at, investment.frequency)

    investment
    |> Investment.changeset(%{
      last_run_at: DateTime.utc_now(),
      next_run_at: next
    })
    |> Repo.update()
  end

  # ── Cadence math ──────────────────────────────────────────────────────

  @doc """
  Given an anchor timestamp and a frequency, returns the next fire time.
  Exposed for the controller/UI's "next scheduled" preview as well as
  the internal advance step.
  """
  def next_run(%DateTime{} = anchor, frequency) do
    case frequency do
      "daily" -> DateTime.add(anchor, 24 * 3600, :second)
      "weekly" -> DateTime.add(anchor, 7 * 24 * 3600, :second)
      "biweekly" -> DateTime.add(anchor, 14 * 24 * 3600, :second)
      "monthly" -> add_months(anchor, 1)
      _ -> DateTime.add(anchor, 24 * 3600, :second)
    end
  end

  # DateTime doesn't ship with month arithmetic; we walk the date forward
  # by 30 days as a pragmatic stand-in. Good enough for the user-visible
  # "monthly" cadence (the alternative — true calendar-month math —
  # complicates the edge case where the anchor is the 31st).
  defp add_months(%DateTime{} = anchor, n),
    do: DateTime.add(anchor, n * 30 * 24 * 3600, :second)

  defp parse_starts_at(%DateTime{} = dt), do: {:ok, dt}

  defp parse_starts_at(s) when is_binary(s) do
    case DateTime.from_iso8601(s) do
      {:ok, dt, _} -> {:ok, dt}
      _ -> :error
    end
  end

  defp parse_starts_at(_), do: :error
end
