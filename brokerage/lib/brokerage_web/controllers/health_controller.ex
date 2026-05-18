defmodule BrokerageWeb.HealthController do
  @moduledoc """
  Liveness/readiness endpoint. No auth, no external calls — safe to hit
  from deploy scripts, load balancers, or uptime monitors without
  triggering upstream rate limits.
  """
  use BrokerageWeb, :controller

  def index(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
