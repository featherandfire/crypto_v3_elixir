defmodule CryptoPortfolioV3.Mailer do
  @moduledoc """
  Outbound email. Adapter is selected in config/runtime.exs per environment:

    * dev   → Swoosh.Adapters.Local  (preview at /dev/mailbox, nothing sent)
    * test  → Swoosh.Adapters.Test   (emails captured in the process mailbox)
    * prod  → Swoosh.Adapters.SMTP   (Amazon SES via email-smtp.*.amazonaws.com)

  Application code should call CryptoPortfolioV3.Emails.<builder>/N to get a
  %Swoosh.Email{}, then pass it to deliver/1 here.
  """

  use Swoosh.Mailer, otp_app: :crypto_portfolio_v3
end
