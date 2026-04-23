defmodule CryptoPortfolioV3.Release do
  @moduledoc """
  Release tasks (migrations, rollbacks) invokable without Mix in prod.
  Call with: bin/crypto_portfolio_v3 eval "CryptoPortfolioV3.Release.migrate"
  """

  @app :crypto_portfolio_v3

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end
end
