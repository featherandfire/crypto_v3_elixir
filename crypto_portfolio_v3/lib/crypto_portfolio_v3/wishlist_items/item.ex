defmodule CryptoPortfolioV3.WishlistItems.Item do
  @moduledoc """
  A single wishlist entry — symbol + intended-order parameters the user
  authorized but hasn't yet executed. Cascade-deleted with the user.

  `authorized_at` / `authorized_ip` are server-set on every write that
  changes the order parameters; clients can't supply them. They're the
  audit trail proving the user (not the platform) authorized each order.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Accounts.User

  @timestamps_opts [type: :utc_datetime_usec]

  @sides ~w(buy sell)
  @order_types ~w(market limit)
  @time_in_forces ~w(day gtc ioc fok)
  @statuses ~w(pending filled canceled failed)

  schema "wishlist_items" do
    field :symbol, :string
    field :qty, :decimal
    field :side, :string, default: "buy"
    field :order_type, :string, default: "market"
    field :limit_price, :decimal
    field :time_in_force, :string, default: "day"
    field :position, :integer, default: 0
    field :status, :string, default: "pending"
    field :authorized_at, :utc_datetime_usec
    field :authorized_ip, :string
    field :executed_at, :utc_datetime_usec
    field :executed_order_id, :string

    belongs_to :user, User

    timestamps()
  end

  def changeset(item, attrs) do
    item
    |> cast(attrs, [
      :user_id,
      :symbol,
      :qty,
      :side,
      :order_type,
      :limit_price,
      :time_in_force,
      :position,
      :status,
      :authorized_at,
      :authorized_ip,
      :executed_at,
      :executed_order_id
    ])
    |> validate_required([:user_id, :symbol, :qty, :authorized_at])
    |> update_change(:symbol, &normalize_symbol/1)
    |> validate_length(:symbol, max: 32)
    |> validate_number(:qty, greater_than: 0)
    |> validate_inclusion(:side, @sides)
    |> validate_inclusion(:order_type, @order_types)
    |> validate_inclusion(:time_in_force, @time_in_forces)
    |> validate_inclusion(:status, @statuses)
    |> validate_limit_price_when_required()
    |> foreign_key_constraint(:user_id)
    |> unique_constraint([:user_id, :symbol])
  end

  defp normalize_symbol(nil), do: nil
  defp normalize_symbol(s) when is_binary(s), do: s |> String.trim() |> String.upcase()

  # Limit orders need a limit_price > 0; market orders ignore it.
  defp validate_limit_price_when_required(changeset) do
    case get_field(changeset, :order_type) do
      "limit" ->
        case get_field(changeset, :limit_price) do
          nil ->
            add_error(changeset, :limit_price, "is required for limit orders")

          %Decimal{} = d ->
            if Decimal.compare(d, 0) == :gt do
              changeset
            else
              add_error(changeset, :limit_price, "must be greater than zero")
            end

          _ ->
            add_error(changeset, :limit_price, "is required for limit orders")
        end

      _ ->
        changeset
    end
  end
end
