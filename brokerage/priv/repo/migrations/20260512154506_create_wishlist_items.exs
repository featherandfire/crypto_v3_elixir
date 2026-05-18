defmodule Brokerage.Repo.Migrations.CreateWishlistItems do
  use Ecto.Migration

  def change do
    # The user's wishlist — symbols + intended-order parameters they've
    # added but haven't yet executed. Each entry is a *user-authorized*
    # conditional order: when funds settle on the user's account, the
    # auto-execute worker walks pending rows FIFO (by `position`, then
    # `authorized_at`) and fires orders until cash is exhausted.
    #
    # Because the platform operates without an advisory license, every
    # row must trace back to an explicit user action. `authorized_at`
    # + `authorized_ip` are server-set on insert/update — never trust
    # client-provided values.
    create table(:wishlist_items) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :symbol, :string, null: false, size: 32
      add :qty, :decimal, precision: 20, scale: 8, null: false
      add :side, :string, null: false, default: "buy"
      add :order_type, :string, null: false, default: "market"
      # Required when order_type = "limit"; ignored otherwise.
      add :limit_price, :decimal, precision: 20, scale: 4
      add :time_in_force, :string, null: false, default: "day"
      # Lower position = higher priority during auto-execute. New rows
      # append to the end of the user's list.
      add :position, :integer, null: false, default: 0
      # Lifecycle: pending → filled (order placed at Alpaca), canceled,
      # or failed (Alpaca rejected at execute time).
      add :status, :string, null: false, default: "pending"
      # Captured server-side on every authorization-changing write.
      add :authorized_at, :utc_datetime_usec, null: false
      add :authorized_ip, :string
      add :executed_at, :utc_datetime_usec
      # Alpaca order id once the wishlist entry has been turned into an
      # actual order. Lets us trace wishlist → order outcome.
      add :executed_order_id, :string

      timestamps(type: :utc_datetime_usec)
    end

    create index(:wishlist_items, [:user_id])
    create unique_index(:wishlist_items, [:user_id, :symbol])
    # Used by the auto-execute worker to pull pending rows for a user
    # in priority order.
    create index(:wishlist_items, [:user_id, :status, :position])
  end
end
