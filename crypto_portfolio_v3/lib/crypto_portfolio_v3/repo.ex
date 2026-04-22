defmodule CryptoPortfolioV3.Repo do
  use Ecto.Repo,
    otp_app: :crypto_portfolio_v3,
    adapter: Ecto.Adapters.Postgres
end
