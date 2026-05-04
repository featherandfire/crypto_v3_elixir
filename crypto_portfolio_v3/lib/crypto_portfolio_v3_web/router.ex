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

    get "/health", HealthController, :index

    post "/auth/register", AuthController, :register
    post "/auth/login", AuthController, :login
    post "/auth/verify-email", AuthController, :verify_email
    post "/auth/resend-code", AuthController, :resend_code
    post "/auth/forgot-password", AuthController, :forgot_password
    post "/auth/reset-password", AuthController, :reset_password

    post "/contact", ContactController, :submit

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

      get "/alpaca/account", AlpacaController, :account
      get "/alpaca/positions", AlpacaController, :positions
      get "/alpaca/quote/:symbol", AlpacaController, :quote
      get "/alpaca/bars/:symbol", AlpacaController, :bars
      get "/alpaca/snapshots", AlpacaController, :snapshots
      get "/alpaca/dividends", AlpacaController, :dividends
      get "/alpaca/assets", AlpacaController, :assets
      get "/edgar/risk", EdgarController, :risk
      get "/alpaca/changes", AlpacaController, :changes
      get "/alpaca/dividend-activities", AlpacaController, :dividend_activities
      get "/alpaca/orders", AlpacaController, :list_orders
      post "/alpaca/orders", AlpacaController, :create_order
      delete "/alpaca/orders/:id", AlpacaController, :cancel_order

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
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
