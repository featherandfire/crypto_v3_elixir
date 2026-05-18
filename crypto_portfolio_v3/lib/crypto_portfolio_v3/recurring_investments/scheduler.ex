defmodule CryptoPortfolioV3.RecurringInvestments.Scheduler do
  @moduledoc """
  Ticks every minute and calls
  `CryptoPortfolioV3.RecurringInvestments.execute_due/0` to fire any
  schedules whose next_run_at has passed.

  Single-node only. When we deploy multiple Phoenix nodes we'll need
  to gate this with a leader-election step (or move to Oban) so we
  don't fire each due row N times.
  """

  use GenServer

  require Logger

  alias CryptoPortfolioV3.RecurringInvestments

  # 60s gives roughly minute-level precision on the user's cadence,
  # which is plenty for daily / weekly / monthly schedules. Tighten if
  # we ever expose finer intervals.
  @tick_ms 60_000
  # Delay the first tick so migrations have time to settle on cold
  # boot (mostly a courtesy for the dev `mix phx.server` flow).
  @initial_delay_ms 10_000

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    Process.send_after(self(), :tick, @initial_delay_ms)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    try do
      count = RecurringInvestments.execute_due()
      if count > 0, do: Logger.info("RecurringInvestments scheduler fired #{count} schedule(s)")
    rescue
      e ->
        Logger.error(
          "RecurringInvestments scheduler crashed mid-tick: #{Exception.message(e)}"
        )
    end

    Process.send_after(self(), :tick, @tick_ms)
    {:noreply, state}
  end
end
