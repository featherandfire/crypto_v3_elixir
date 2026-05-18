defmodule BrokerageWeb.Serializer do
  @moduledoc """
  JSON serialization helpers.
  """

  alias Brokerage.Accounts.User

  def user(%User{} = u) do
    %{
      id: u.id,
      username: u.username,
      email: u.email,
      is_verified: u.is_verified,
      created_at: u.inserted_at,
      updated_at: u.updated_at
    }
  end
end
