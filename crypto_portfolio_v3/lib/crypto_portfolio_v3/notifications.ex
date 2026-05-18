defmodule CryptoPortfolioV3.Notifications do
  @moduledoc """
  Activity notifications. Each public function takes a `user_id` (so
  callers don't have to load the user themselves), renders the right
  email template, and ships it through `Mailer.deliver/1`.

  **All sends are non-fatal.** Every public function wraps delivery in
  a `try/rescue` and a `with` on the user lookup — if the user no longer
  exists, or the mailer is misconfigured, or Resend's API is down,
  the trigger flow (order placement, deposit webhook, scheduler tick)
  continues uninterrupted. Telemetry / logging captures the failure for
  later debugging.

  No user-preferences gate yet — every event mails the user. A
  `notification_prefs` column on `users` (with per-event opt-out flags)
  is the natural follow-up.
  """

  require Logger

  alias CryptoPortfolioV3.{Accounts, Emails, Mailer}

  def deposit_settled(user_id, deposit),
    do: send_safe(user_id, :deposit_settled, &Emails.deposit_settled_email(&1, deposit))

  def withdrawal_initiated(user_id, withdrawal),
    do: send_safe(user_id, :withdrawal_initiated, &Emails.withdrawal_initiated_email(&1, withdrawal))

  def order_placed(user_id, order),
    do: send_safe(user_id, :order_placed, &Emails.order_placed_email(&1, order))

  def wishlist_filled(user_id, item),
    do: send_safe(user_id, :wishlist_filled, &Emails.wishlist_filled_email(&1, item))

  def recurring_fired(user_id, investment),
    do: send_safe(user_id, :recurring_fired, &Emails.recurring_fired_email(&1, investment))

  def kyc_approved(user_id, account),
    do: send_safe(user_id, :kyc_approved, &Emails.kyc_approved_email(&1, account))

  # ── internal ──────────────────────────────────────────────────────────

  defp send_safe(user_id, event, build_email) when is_integer(user_id) do
    case Accounts.get_user(user_id) do
      nil ->
        Logger.warning("Notifications.#{event}: user ##{user_id} not found")
        :ok

      user ->
        try do
          email = build_email.(user)

          case Mailer.deliver(email) do
            {:ok, _} ->
              :ok

            {:error, reason} ->
              Logger.warning(
                "Notifications.#{event} delivery failed for user ##{user_id}: #{inspect(reason)}"
              )

              :ok
          end
        rescue
          e ->
            Logger.warning(
              "Notifications.#{event} crashed for user ##{user_id}: #{Exception.message(e)}"
            )

            :ok
        end
    end
  end

  defp send_safe(_user_id, _event, _build_email), do: :ok
end
