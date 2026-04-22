defmodule CryptoPortfolioV3Web.Router do
  use CryptoPortfolioV3Web, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :authenticated do
    plug CryptoPortfolioV3Web.Plugs.Auth
  end

  scope "/api", CryptoPortfolioV3Web do
    pipe_through :api

    post "/auth/register", AuthController, :register
    post "/auth/login", AuthController, :login

    get "/coins/top", CoinController, :top
    get "/coins/yearly-ranges", CoinController, :yearly_ranges
    get "/coins/supply", CoinController, :supply
    get "/coins/search", CoinController, :search
    get "/coins/:coingecko_id/history", CoinController, :history

    get "/cryptocompare/changes", CryptocompareController, :changes
    get "/cryptocompare/volatility", CryptocompareController, :volatility

    get "/lookup/:hash", LookupController, :show

    get "/wallet/chains", WalletController, :chains
    get "/wallet/from-tx/:hash", WalletController, :from_tx
    get "/wallet/all/:address", WalletController, :all
    get "/wallet/solana/:address/last-buy-fees", WalletController, :solana_last_buy_fees
    get "/wallet/solana/:address", WalletController, :solana_balances
    get "/wallet/tron/:address", WalletController, :tron_balances
    get "/wallet/:chain/:address/last-buy-fees", WalletController, :last_buy_fees
    get "/wallet/:chain/:address", WalletController, :chain_balances

    scope "/" do
      pipe_through :authenticated

      get "/auth/me", AuthController, :me

      get "/portfolios", PortfolioController, :index
      post "/portfolios", PortfolioController, :create
      get "/portfolios/:id", PortfolioController, :show
      delete "/portfolios/:id", PortfolioController, :delete
      post "/portfolios/:id/refresh", PortfolioController, :refresh

      post "/portfolios/:portfolio_id/holdings", HoldingController, :create
      patch "/portfolios/:portfolio_id/holdings/:id", HoldingController, :update
      delete "/portfolios/:portfolio_id/holdings/:id", HoldingController, :delete

      get "/portfolios/:portfolio_id/holdings/:holding_id/transactions",
          TransactionController,
          :index

      post "/portfolios/:portfolio_id/holdings/:holding_id/transactions",
           TransactionController,
           :create
    end
  end

  # Enable LiveDashboard in development
  if Application.compile_env(:crypto_portfolio_v3, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]

      live_dashboard "/dashboard", metrics: CryptoPortfolioV3Web.Telemetry
    end
  end
end
