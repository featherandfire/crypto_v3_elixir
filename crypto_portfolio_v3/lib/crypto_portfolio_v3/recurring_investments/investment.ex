defmodule CryptoPortfolioV3.RecurringInvestments.Investment do
  @moduledoc """
  Schema for a user's recurring buy schedule. Each row is one symbol +
  cadence; the scheduler GenServer fires real orders against the user's
  Alpaca account at `next_run_at`, then advances `next_run_at` by the
  frequency.

  `authorized_at` / `authorized_ip` mirror the audit fields on
  WishlistItems so we can prove user-initiated authorization in case
  Alpaca asks during a compliance review.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias CryptoPortfolioV3.Accounts.User

  @timestamps_opts [type: :utc_datetime_usec]

  @frequencies ~w(daily weekly biweekly monthly)
  @sides ~w(buy sell)
  @order_types ~w(market limit)
  @times_in_force ~w(day gtc ioc fok)

  schema "recurring_investments" do
    field :symbol, :string
    field :qty, :decimal
    field :side, :string, default: "buy"
    field :order_type, :string, default: "market"
    field :time_in_force, :string, default: "day"
    field :limit_price, :decimal
    field :frequency, :string
    field :starts_at, :utc_datetime_usec
    field :next_run_at, :utc_datetime_usec
    field :last_run_at, :utc_datetime_usec
    field :is_active, :boolean, default: true
    field :authorized_at, :utc_datetime_usec
    field :authorized_ip, :string

    belongs_to :user, User

    timestamps()
  end

  def changeset(investment, attrs) do
    investment
    |> cast(attrs, [
      :user_id,
      :symbol,
      :qty,
      :side,
      :order_type,
      :time_in_force,
      :limit_price,
      :frequency,
      :starts_at,
      :next_run_at,
      :last_run_at,
      :is_active,
      :authorized_at,
      :authorized_ip
    ])
    |> normalize_symbol()
    |> validate_required([:user_id, :symbol, :qty, :frequency, :starts_at, :next_run_at, :authorized_at])
    |> validate_inclusion(:frequency, @frequencies)
    |> validate_inclusion(:side, @sides)
    |> validate_inclusion(:order_type, @order_types)
    |> validate_inclusion(:time_in_force, @times_in_force)
    |> validate_number(:qty, greater_than: 0)
    |> assoc_constraint(:user)
  end

  defp normalize_symbol(changeset) do
    case get_change(changeset, :symbol) do
      sym when is_binary(sym) -> put_change(changeset, :symbol, String.upcase(String.trim(sym)))
      _ -> changeset
    end
  end

  def frequencies, do: @frequencies
end
