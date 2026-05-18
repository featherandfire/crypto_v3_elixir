defmodule Brokerage.Repo do
  use Ecto.Repo,
    otp_app: :brokerage,
    adapter: Ecto.Adapters.Postgres
end
