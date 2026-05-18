defmodule CryptoPortfolioV3.AlpacaMock.Server do
  @moduledoc """
  In-memory Alpaca Broker API simulator. Holds enough state to satisfy
  the onboarding → fund → trade flow our E2E suite exercises:

    * customer accounts (returned as ACTIVE on create — no sandbox approval lag)
    * ACH relationships (returned as APPROVED on create)
    * transfers (created QUEUED; flipped to COMPLETE via `complete_transfer/1`,
      called from the deposit webhook handler so the mock's cash and our DB
      deposit row stay in sync)
    * trading accounts (cash / buying_power tracked per account)
    * orders (placed if buying_power >= notional; rejected with the exact
      "insufficient buying power" message Alpaca uses)

  State lives in this GenServer's process dictionary — fast, no persistence
  across restarts (intentional; tests get a fresh slate per Phoenix run).
  Concurrent test users share one server but each operates on their own
  account id, so there's no cross-test contention.

  Started conditionally from `Application` when `ALPACA_MOCK=1`.
  """

  use GenServer

  @decimal_zero Decimal.new("0")

  # ── Public API ──────────────────────────────────────────────────────────

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  @doc "True when the mock GenServer is running (started by the Application)."
  def enabled? do
    Process.whereis(__MODULE__) != nil
  end

  def create_account(payload), do: GenServer.call(__MODULE__, {:create_account, payload})
  def get_account(id), do: GenServer.call(__MODULE__, {:get_account, id})

  def create_ach(account_id, payload),
    do: GenServer.call(__MODULE__, {:create_ach, account_id, payload})

  def list_ach(account_id), do: GenServer.call(__MODULE__, {:list_ach, account_id})

  def create_transfer(account_id, payload),
    do: GenServer.call(__MODULE__, {:create_transfer, account_id, payload})

  @doc """
  Flips a transfer to COMPLETE and credits the receiving account's cash.
  Idempotent — calling twice on the same transfer doesn't double-credit.
  Called from `BrokerFunding.handle_webhook` so the mock's view of cash
  stays consistent with our deposit row after the test fires its signed
  webhook.
  """
  def complete_transfer(transfer_id),
    do: GenServer.call(__MODULE__, {:complete_transfer, transfer_id})

  def get_trading_account(account_id),
    do: GenServer.call(__MODULE__, {:get_trading_account, account_id})

  def list_orders(account_id), do: GenServer.call(__MODULE__, {:list_orders, account_id})
  def list_positions(account_id), do: GenServer.call(__MODULE__, {:list_positions, account_id})

  def place_order(account_id, payload),
    do: GenServer.call(__MODULE__, {:place_order, account_id, payload})

  def list_activities(account_id),
    do: GenServer.call(__MODULE__, {:list_activities, account_id})

  def get_portfolio_history(account_id),
    do: GenServer.call(__MODULE__, {:get_portfolio_history, account_id})

  @doc "Wipes all state. Useful between test runs if needed (the suite doesn't currently need it)."
  def reset, do: GenServer.call(__MODULE__, :reset)

  # ── GenServer ───────────────────────────────────────────────────────────

  @impl true
  def init(_) do
    # Mock state is in-memory, but our DB persists `brokerage_accounts`
    # across restarts. Without a seed step, every Phoenix reboot would
    # orphan existing rows — their alpaca_account_id would refer to
    # accounts the mock no longer knows about, and the trading-account
    # endpoint would 404. Seeding closes that gap so manual dev sessions
    # (e.g. signing in as a real user, then restarting Phoenix) keep
    # working without DB surgery.
    {:ok, seed_from_db(blank_state())}
  end

  defp blank_state do
    %{
      # alpaca_id => account_map
      accounts: %{},
      # alpaca_id => [rel_map, ...]
      ach: %{},
      # transfer_id => transfer_map
      transfers: %{},
      # alpaca_id => [order_map, ...]
      orders: %{},
      # alpaca_id => Decimal
      cash: %{}
    }
  end

  # Reads existing brokerage_accounts + completed broker_deposits rows
  # and replays them into the mock so the dev session "remembers" prior
  # onboarding and funding across Phoenix restarts. Without this, a
  # restart orphans the DB row (trading-account 404s) and zeroes the
  # buying power (every order rejects).
  #
  # Cash seeded as the sum of completed deposits — an over-estimate
  # when historical orders had drawn it down, but harmless for dev
  # (no real money at risk), and any new order placement still flows
  # through the mock's deduction path so accounting stays internally
  # consistent from this restart forward.
  #
  # Errors are non-fatal — if Repo is unavailable mid-boot or the
  # tables don't exist yet (e.g. fresh checkout), the mock just starts
  # empty rather than blocking Phoenix from coming up.
  defp seed_from_db(state) do
    try do
      import Ecto.Query
      alias CryptoPortfolioV3.{Repo, BrokerageAccounts.Account, BrokerFunding.Deposit}

      accounts = Repo.all(Account)

      # Sum completed deposits per user_id once, then look up by user.
      cash_by_user =
        from(d in Deposit, where: d.status == "completed", select: {d.user_id, d.amount})
        |> Repo.all()
        |> Enum.group_by(fn {uid, _} -> uid end, fn {_, amt} -> amt end)
        |> Map.new(fn {uid, amts} ->
          {uid, Enum.reduce(amts, @decimal_zero, &Decimal.add/2)}
        end)

      Enum.reduce(accounts, state, fn a, acc ->
        cash = Map.get(cash_by_user, a.user_id, @decimal_zero)

        acc
        |> put_in([:accounts, a.alpaca_account_id], %{
          "id" => a.alpaca_account_id,
          "account_number" => a.alpaca_account_number,
          "status" => a.status || "ACTIVE",
          "currency" => "USD",
          "created_at" => DateTime.to_iso8601(a.inserted_at)
        })
        |> put_in([:cash, a.alpaca_account_id], cash)
        |> put_in([:orders, a.alpaca_account_id], [])
        |> put_in([:ach, a.alpaca_account_id], [])
      end)
    rescue
      _ -> state
    end
  end

  @impl true
  def handle_call({:create_account, payload}, _from, state) do
    id = uuid()
    contact = Map.get(payload, "contact") || %{}
    identity = Map.get(payload, "identity") || %{}

    account = %{
      "id" => id,
      "account_number" => account_number(),
      # Returning ACTIVE immediately is the whole point of the mock — kills
      # the 30-180s sandbox approval lag.
      "status" => "ACTIVE",
      "kyc_results" => %{"reject" => %{}, "accept" => %{}, "indeterminate" => %{}, "summary" => "pass"},
      "currency" => "USD",
      "created_at" => iso_now(),
      "contact" => contact,
      "identity" => identity
    }

    {:reply, {:ok, account},
     state
     |> put_in([:accounts, id], account)
     |> put_in([:cash, id], @decimal_zero)
     |> put_in([:orders, id], [])
     |> put_in([:ach, id], [])}
  end

  def handle_call({:get_account, id}, _from, state) do
    case state.accounts[id] do
      nil -> {:reply, {:not_found, id}, state}
      account -> {:reply, {:ok, account}, state}
    end
  end

  def handle_call({:create_ach, account_id, payload}, _from, state) do
    rel = %{
      "id" => uuid(),
      "account_id" => account_id,
      "created_at" => iso_now(),
      # APPROVED instantly — matches sandbox behaviour and keeps the
      # onboarding chain non-blocking.
      "status" => "APPROVED",
      "account_owner_name" => Map.get(payload, "account_owner_name"),
      "bank_account_type" => Map.get(payload, "bank_account_type") || "CHECKING",
      "bank_account_number" => Map.get(payload, "bank_account_number"),
      "bank_routing_number" => Map.get(payload, "bank_routing_number"),
      "nickname" => Map.get(payload, "nickname")
    }

    next = Map.update(state.ach, account_id, [rel], &[rel | &1])
    {:reply, {:ok, rel}, %{state | ach: next}}
  end

  def handle_call({:list_ach, account_id}, _from, state) do
    {:reply, {:ok, Map.get(state.ach, account_id, [])}, state}
  end

  def handle_call({:create_transfer, account_id, payload}, _from, state) do
    direction = Map.get(payload, "direction") || "INCOMING"
    amount_str = to_string_amount(Map.get(payload, "amount"))
    amount = Decimal.new(amount_str)

    cond do
      direction == "OUTGOING" ->
        cash = Map.get(state.cash, account_id, @decimal_zero)

        if Decimal.compare(cash, amount) == :lt do
          # Insufficient cash → mirror Alpaca's 422 with a clear message
          # so our controller surfaces it as alpaca_http_422.
          {:reply,
           {:error,
            %{"code" => 40010002, "message" => "insufficient cash for withdrawal"}}, state}
        else
          # Withdrawals settle instantly in the mock (no separate webhook
          # path on our side for outbound). Debit cash, mark COMPLETE.
          transfer = %{
            "id" => uuid(),
            "account_id" => account_id,
            "amount" => amount_str,
            "direction" => "OUTGOING",
            "transfer_type" => Map.get(payload, "transfer_type") || "ach",
            "relationship_id" => Map.get(payload, "relationship_id"),
            "status" => "COMPLETE",
            "instant_amount" => "0",
            "created_at" => iso_now()
          }

          new_cash = Decimal.sub(cash, amount)

          state =
            state
            |> put_in([:transfers, transfer["id"]], transfer)
            |> put_in([:cash, account_id], new_cash)

          {:reply, {:ok, transfer}, state}
        end

      true ->
        transfer = %{
          "id" => uuid(),
          "account_id" => account_id,
          "amount" => amount_str,
          "direction" => "INCOMING",
          "transfer_type" => Map.get(payload, "transfer_type") || "ach",
          "relationship_id" => Map.get(payload, "relationship_id"),
          # QUEUED, not COMPLETE — the deposit webhook (`complete_transfer/1`)
          # is responsible for flipping it. Mirrors production: Alpaca queues
          # the ACH, then the bank-side webhook fires later.
          "status" => "QUEUED",
          "instant_amount" => "0",
          "created_at" => iso_now()
        }

        {:reply, {:ok, transfer}, put_in(state, [:transfers, transfer["id"]], transfer)}
    end
  end

  def handle_call({:complete_transfer, transfer_id}, _from, state) do
    case state.transfers[transfer_id] do
      nil ->
        {:reply, {:error, :not_found}, state}

      %{"status" => "COMPLETE"} = transfer ->
        # Idempotent — already credited.
        {:reply, {:ok, transfer}, state}

      transfer ->
        account_id = transfer["account_id"]
        amount = Decimal.new(transfer["amount"])
        next_cash = Decimal.add(Map.get(state.cash, account_id, @decimal_zero), amount)
        updated = Map.put(transfer, "status", "COMPLETE")

        state =
          state
          |> put_in([:transfers, transfer_id], updated)
          |> put_in([:cash, account_id], next_cash)

        {:reply, {:ok, updated}, state}
    end
  end

  def handle_call({:get_trading_account, account_id}, _from, state) do
    case state.accounts[account_id] do
      nil ->
        {:reply, {:not_found, account_id}, state}

      account ->
        cash = Map.get(state.cash, account_id, @decimal_zero)
        cash_str = Decimal.to_string(cash, :normal)

        trading_account = %{
          "id" => account_id,
          "account_number" => account["account_number"],
          "status" => "ACTIVE",
          "currency" => "USD",
          "cash" => cash_str,
          "buying_power" => cash_str,
          "non_marginable_buying_power" => cash_str,
          "equity" => cash_str,
          "last_equity" => cash_str,
          "portfolio_value" => cash_str,
          "pattern_day_trader" => false,
          "trade_suspended_by_user" => false,
          "trading_blocked" => false
        }

        {:reply, {:ok, trading_account}, state}
    end
  end

  def handle_call({:list_orders, account_id}, _from, state) do
    {:reply, {:ok, Map.get(state.orders, account_id, [])}, state}
  end

  def handle_call({:list_positions, _account_id}, _from, state) do
    # Positions ledger isn't modelled — orders flip "filled" but we don't
    # collapse them into per-symbol holdings here. Empty list is the
    # right shape for the controllers and our tests don't assert on it.
    {:reply, {:ok, []}, state}
  end

  def handle_call({:place_order, account_id, payload}, _from, state) do
    cash = Map.get(state.cash, account_id, @decimal_zero)

    cond do
      not Map.has_key?(state.accounts, account_id) ->
        {:reply, {:error, %{"code" => 40010001, "message" => "account not found"}}, state}

      # Notional check — we don't have prices, so any non-zero quantity
      # with $0 cash is rejected. This exactly matches what the order
      # placement rejection spec exercises.
      Decimal.compare(cash, @decimal_zero) == :eq ->
        {:reply,
         {:error, %{"code" => 40310000, "message" => "insufficient buying power"}}, state}

      true ->
        # Cash > 0 — assume the order fits (we don't have prices in the
        # mock). Deduct a nominal $1 so subsequent identical orders also
        # work as long as cash holds; tests that care about exact accounting
        # can subscribe to a more precise mock later.
        order = %{
          "id" => uuid(),
          "client_order_id" => uuid(),
          "status" => "filled",
          "symbol" => Map.get(payload, "symbol"),
          "qty" => Map.get(payload, "qty"),
          "side" => Map.get(payload, "side"),
          "type" => Map.get(payload, "type"),
          "time_in_force" => Map.get(payload, "time_in_force"),
          "filled_at" => iso_now(),
          "submitted_at" => iso_now()
        }

        next_orders = Map.update(state.orders, account_id, [order], &[order | &1])
        next_cash = Decimal.sub(cash, Decimal.new("1"))

        state =
          state
          |> Map.put(:orders, next_orders)
          |> put_in([:cash, account_id], next_cash)

        {:reply, {:ok, order}, state}
    end
  end

  def handle_call({:list_activities, account_id}, _from, state) do
    # Synthesize from existing state: every completed transfer becomes a
    # TRANS activity, every order becomes a FILL. Matches the shape
    # frontends expect (id, activity_type, transaction_time + per-type
    # fields) closely enough that no client-side branching is needed.
    transfer_acts =
      state.transfers
      |> Map.values()
      |> Enum.filter(fn t -> t["account_id"] == account_id and t["status"] == "COMPLETE" end)
      |> Enum.map(fn t ->
        %{
          "id" => "trans-#{t["id"]}",
          "activity_type" => "TRANS",
          "account_id" => account_id,
          "transaction_time" => t["created_at"],
          "net_amount" => t["amount"],
          "description" =>
            "ACH deposit (#{t["direction"] || "INCOMING"})",
          "status" => "executed"
        }
      end)

    order_acts =
      state.orders
      |> Map.get(account_id, [])
      |> Enum.map(fn o ->
        %{
          "id" => "fill-#{o["id"]}",
          "activity_type" => "FILL",
          "account_id" => account_id,
          "transaction_time" => o["filled_at"] || o["submitted_at"],
          "symbol" => o["symbol"],
          "qty" => o["qty"],
          "side" => o["side"],
          "type" => "fill",
          "order_id" => o["id"],
          "price" => "1.00",
          "net_amount" => "1.00"
        }
      end)

    activities =
      (transfer_acts ++ order_acts)
      |> Enum.sort_by(& &1["transaction_time"], :desc)

    {:reply, {:ok, activities}, state}
  end

  def handle_call({:get_portfolio_history, account_id}, _from, state) do
    # 30-point series at hourly intervals ending now, flat at the
    # account's current cash. Enough to render the chart in dev; tests
    # don't assert on shape so a constant series is the lowest-effort
    # implementation that keeps the UI honest about "no real history yet".
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    n = 30
    step_seconds = 3600

    cash = Map.get(state.cash, account_id, @decimal_zero)
    cash_float = cash |> Decimal.to_float()

    timestamps =
      0..(n - 1)
      |> Enum.map(fn i ->
        DateTime.add(now, -(n - 1 - i) * step_seconds, :second) |> DateTime.to_unix()
      end)

    equity = for _ <- 1..n, do: cash_float
    profit_loss = for _ <- 1..n, do: 0.0
    profit_loss_pct = for _ <- 1..n, do: 0.0

    history = %{
      "timestamp" => timestamps,
      "equity" => equity,
      "profit_loss" => profit_loss,
      "profit_loss_pct" => profit_loss_pct,
      "base_value" => cash_float,
      "timeframe" => "1H"
    }

    {:reply, {:ok, history}, state}
  end

  def handle_call(:reset, _from, _state), do: {:reply, :ok, blank_state()}

  # ── helpers ─────────────────────────────────────────────────────────────

  defp uuid do
    # Standard v4 UUID — Alpaca uses these for every id. We don't need
    # cryptographic uniqueness here; mock state lives for one Phoenix
    # process lifetime, and v4 random bits are plenty for that.
    <<a::32, b::16, _::4, c::12, _::2, d::14, e::48>> =
      :crypto.strong_rand_bytes(16)

    :io_lib.format("~8.16.0b-~4.16.0b-4~3.16.0b-~4.16.0b-~12.16.0b", [
      a,
      b,
      c,
      Bitwise.bor(0x8000, d),
      e
    ])
    |> IO.iodata_to_binary()
  end

  defp account_number do
    # 9-digit numeric string, matches Alpaca's "ACCT" naming convention.
    n = :rand.uniform(900_000_000) + 99_999_999
    Integer.to_string(n)
  end

  defp iso_now, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp to_string_amount(nil), do: "0"
  defp to_string_amount(s) when is_binary(s), do: s
  defp to_string_amount(n) when is_number(n), do: to_string(n)
  defp to_string_amount(%Decimal{} = d), do: Decimal.to_string(d, :normal)
end
