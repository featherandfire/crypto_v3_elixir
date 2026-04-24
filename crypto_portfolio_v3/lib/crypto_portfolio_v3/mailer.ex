defmodule CryptoPortfolioV3.Mailer do
  @moduledoc """
  Outbound email. Adapter is selected per environment:

    * dev  → Swoosh.Adapters.Local  (preview at /dev/mailbox, nothing sent)
    * test → Swoosh.Adapters.Test   (emails captured in the process mailbox)

  Prod adapter will be added when we wire SES; for now, prod has no mailer
  config and deliver/1 would fail. That's intentional — keeps this commit
  scoped to local dev plumbing only.
  """

  use Swoosh.Mailer, otp_app: :crypto_portfolio_v3
end
