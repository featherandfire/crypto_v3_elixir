import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :brokerage, Brokerage.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "brokerage_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :brokerage, BrokerageWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "ZFtw5JK52PHnpf7rnQSpgNb7CP8K+3SoAAYatXq9AKuFwJMgdIfJI9UW8rjqkaBM",
  server: false

# Mailer: capture emails in the test process inbox for assertions.
config :brokerage, Brokerage.Mailer, adapter: Swoosh.Adapters.Test
config :swoosh, :api_client, false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
