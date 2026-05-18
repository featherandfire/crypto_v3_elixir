defmodule CryptoPortfolioV3.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        CryptoPortfolioV3Web.Telemetry,
        CryptoPortfolioV3.Repo,
        {DNSCluster, query: Application.get_env(:crypto_portfolio_v3, :dns_cluster_query) || :ignore},
        {Phoenix.PubSub, name: CryptoPortfolioV3.PubSub},
        {Cachex, name: :alpaca_cache},
        CryptoPortfolioV3.Market.PriceCache,
        # Recurring-investment scheduler ticks once a minute and fires
        # any due schedules. Lives in-process; single-node only.
        CryptoPortfolioV3.RecurringInvestments.Scheduler
      ] ++
        alpaca_mock() ++
        prefetchers() ++
        [CryptoPortfolioV3Web.Endpoint]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: CryptoPortfolioV3.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    CryptoPortfolioV3Web.Endpoint.config_change(changed, removed)
    :ok
  end

  defp prefetchers do
    if Application.get_env(:crypto_portfolio_v3, :enable_prefetchers, false) do
      [
        CryptoPortfolioV3.Market.YearlyPrefetcher,
        CryptoPortfolioV3.Market.PctChangePrefetcher
      ]
    else
      []
    end
  end

  # AlpacaMock.Server runs only when ALPACA_MOCK=1 — its presence is the
  # signal `BrokerFunding.Client.maybe_use_mock_plug/1` checks to route
  # every Broker API call through the in-process stub instead of the
  # real sandbox. Off by default so a normal `mix phx.server` still
  # hits Alpaca.
  defp alpaca_mock do
    if Application.get_env(:crypto_portfolio_v3, :alpaca_mock?, false) do
      [CryptoPortfolioV3.AlpacaMock.Server]
    else
      []
    end
  end
end
