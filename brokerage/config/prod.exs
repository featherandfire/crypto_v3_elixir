import Config

# HTTPS is enforced at the Fly.io edge proxy via `force_https = true` in
# fly.toml — the app itself receives plain HTTP from the edge. Phoenix's
# own `force_ssl` would loop with the edge's redirect, so it's off.

# Do not print debug messages in production
config :logger, level: :info

# Runtime production configuration, including reading
# of environment variables, is done on config/runtime.exs.
