import Config

# Load local .env for dev/test. Prod reads real env vars set by the deployer.
# Dotenvy.source!/1 returns a merged map but doesn't populate System — write
# the parsed values in so the rest of runtime.exs can use System.get_env/2.
if config_env() in [:dev, :test] do
  [".env", ".env.#{config_env()}"]
  |> Enum.filter(&File.exists?/1)
  |> case do
    [] -> %{}
    files -> Dotenvy.source!(files)
  end
  |> Enum.each(fn {k, v} ->
    # Don't clobber values the user explicitly set in their shell.
    if System.get_env(k) in [nil, ""], do: System.put_env(k, v)
  end)
end

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/crypto_portfolio_v3 start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :crypto_portfolio_v3, CryptoPortfolioV3Web.Endpoint, server: true
end

# Auth (all envs). JWT_SECRET required in prod; dev/test fall back to a default.
config :crypto_portfolio_v3,
  jwt_secret:
    System.get_env("JWT_SECRET") ||
      if(config_env() == :prod,
        do: raise("JWT_SECRET is required in production"),
        else: "dev-secret-DO-NOT-USE-IN-PROD"
      ),
  jwt_ttl_seconds: String.to_integer(System.get_env("JWT_TTL_SECONDS", "3600"))

# External market-data APIs (all envs).
config :crypto_portfolio_v3, :coingecko,
  base_url: System.get_env("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3"),
  timeout_ms: String.to_integer(System.get_env("COINGECKO_TIMEOUT_MS", "10000")),
  max_retries: String.to_integer(System.get_env("COINGECKO_MAX_RETRIES", "3"))

config :crypto_portfolio_v3, :cryptocompare,
  base_url: System.get_env("CRYPTOCOMPARE_BASE_URL", "https://min-api.cryptocompare.com"),
  api_key: System.get_env("CRYPTOCOMPARE_API_KEY"),
  timeout_ms: String.to_integer(System.get_env("CRYPTOCOMPARE_TIMEOUT_MS", "15000"))

# Background prefetchers. Opt-in via ENABLE_PREFETCHERS=true so they don't
# hammer CG on every `mix phx.server` in dev.
config :crypto_portfolio_v3,
  enable_prefetchers: System.get_env("ENABLE_PREFETCHERS") in ["true", "1"]

config :crypto_portfolio_v3, :yearly_prefetcher,
  top_limit: String.to_integer(System.get_env("YEARLY_PREFETCH_TOP", "200")),
  call_delay_ms: String.to_integer(System.get_env("YEARLY_PREFETCH_DELAY_MS", "3000")),
  initial_delay_ms: String.to_integer(System.get_env("YEARLY_PREFETCH_INITIAL_MS", "10000"))

config :crypto_portfolio_v3, :etherscan,
  api_key: System.get_env("ETHERSCAN_API_KEY"),
  base_url: System.get_env("ETHERSCAN_BASE_URL", "https://api.etherscan.io/v2/api"),
  timeout_ms: String.to_integer(System.get_env("ETHERSCAN_TIMEOUT_MS", "10000")),
  concurrency: String.to_integer(System.get_env("ETHERSCAN_CONCURRENCY", "5"))

# Alpaca paper-trading API. Defaults to paper-api.alpaca.markets — flipping
# to live trading requires explicitly setting ALPACA_TRADING_URL=https://api.alpaca.markets
# AND providing live credentials. Don't do that without intent.
config :crypto_portfolio_v3, :alpaca,
  api_key: System.get_env("ALPACA_API_KEY"),
  api_secret: System.get_env("ALPACA_API_SECRET"),
  trading_url: System.get_env("ALPACA_TRADING_URL", "https://paper-api.alpaca.markets"),
  data_url: System.get_env("ALPACA_DATA_URL", "https://data.alpaca.markets"),
  timeout_ms: String.to_integer(System.get_env("ALPACA_TIMEOUT_MS", "10000"))

config :crypto_portfolio_v3, :solana,
  rpc_url: System.get_env("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  timeout_ms: String.to_integer(System.get_env("SOLANA_TIMEOUT_MS", "12000")),
  last_buy_lookback: String.to_integer(System.get_env("SOLANA_LAST_BUY_LOOKBACK", "30"))

config :crypto_portfolio_v3, :tron,
  api_url: System.get_env("TRONSCAN_API_URL", "https://apilist.tronscanapi.com"),
  timeout_ms: String.to_integer(System.get_env("TRONSCAN_TIMEOUT_MS", "15000"))

config :crypto_portfolio_v3, :pct_change_prefetcher,
  top_limit: String.to_integer(System.get_env("PCT_PREFETCH_TOP", "200")),
  call_delay_ms: String.to_integer(System.get_env("PCT_PREFETCH_DELAY_MS", "1500")),
  initial_delay_ms: String.to_integer(System.get_env("PCT_PREFETCH_INITIAL_MS", "15000"))

config :crypto_portfolio_v3, CryptoPortfolioV3Web.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

# Mailer (prod only). Resend over its HTTPS API (Swoosh + Req).
# dev/test adapters are set in config/dev.exs and config/test.exs.
if config_env() == :prod do
  config :crypto_portfolio_v3, CryptoPortfolioV3.Mailer,
    adapter: Swoosh.Adapters.Resend,
    api_key:
      System.get_env("RESEND_API_KEY") ||
        raise("RESEND_API_KEY is required in production")

  config :swoosh, :api_client, Swoosh.ApiClient.Req
end

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :crypto_portfolio_v3, CryptoPortfolioV3.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    # For machines with several cores, consider starting multiple pools of `pool_size`
    # pool_count: 4,
    socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"

  config :crypto_portfolio_v3, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :crypto_portfolio_v3, CryptoPortfolioV3Web.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0}
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :crypto_portfolio_v3, CryptoPortfolioV3Web.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :crypto_portfolio_v3, CryptoPortfolioV3Web.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end
