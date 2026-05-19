defmodule Brokerage.NotificationsTest do
  @moduledoc """
  Coverage for the six activity-notification dispatchers. The signup
  verification + password-reset emails are exercised through the
  controller layer in BrokerageWeb.AuthControllerTest; everything else
  fires from contexts/webhook-handlers/the scheduler, so testing the
  Notifications boundary is the cleanest place to lock in
  "the right event fires the right email."
  """

  use Brokerage.DataCase, async: true
  import Swoosh.TestAssertions

  alias Brokerage.{Accounts, Notifications}

  @user_attrs %{
    "username" => "notifyuser",
    "email" => "notify@example.com",
    "password" => "password1234"
  }

  setup do
    {:ok, user} = Accounts.register_user(@user_attrs)
    %{user: user}
  end

  describe "deposit_settled/2" do
    test "sends a settlement email to the depositing user with the amount", %{user: user} do
      Notifications.deposit_settled(user.id, %{amount: Decimal.new("40.00")})

      assert_email_sent(fn email ->
        assert email.subject =~ "deposit cleared"
        assert email.to == [{"", user.email}]
        assert email.html_body =~ "Deposit cleared"
        assert email.html_body =~ "40.00"
      end)
    end
  end

  describe "withdrawal_initiated/2" do
    test "sends a withdrawal-initiated email with the amount", %{user: user} do
      Notifications.withdrawal_initiated(user.id, %{amount: Decimal.new("25.00")})

      assert_email_sent(fn email ->
        assert email.subject =~ "withdrawal in progress"
        assert email.to == [{"", user.email}]
        assert email.html_body =~ "Withdrawal in progress"
        assert email.html_body =~ "25.00"
      end)
    end
  end

  describe "order_placed/2" do
    test "sends an order-confirmation email with symbol, side, qty", %{user: user} do
      order = %{"symbol" => "AAPL", "side" => "buy", "qty" => "2", "type" => "market"}
      Notifications.order_placed(user.id, order)

      assert_email_sent(fn email ->
        assert email.subject =~ "Buy order placed: AAPL"
        assert email.to == [{"", user.email}]
        assert email.html_body =~ "Order placed"
        assert email.html_body =~ "AAPL"
        assert email.html_body =~ "buy"
      end)
    end
  end

  describe "wishlist_filled/2" do
    test "sends a wishlist auto-fill email with symbol + qty", %{user: user} do
      item = %{symbol: "NVDA", qty: Decimal.new("1")}
      Notifications.wishlist_filled(user.id, item)

      assert_email_sent(fn email ->
        assert email.subject =~ "wishlist auto-fill: NVDA"
        assert email.to == [{"", user.email}]
        assert email.html_body =~ "Wishlist auto-fill"
        assert email.html_body =~ "NVDA"
      end)
    end
  end

  describe "recurring_fired/2" do
    test "sends a recurring-buy email with cadence + symbol + qty", %{user: user} do
      investment = %{symbol: "VOO", qty: Decimal.new("1"), frequency: "weekly"}
      Notifications.recurring_fired(user.id, investment)

      assert_email_sent(fn email ->
        assert email.subject =~ "recurring weekly buy: VOO"
        assert email.to == [{"", user.email}]
        assert email.html_body =~ "Recurring buy executed"
        assert email.html_body =~ "VOO"
        assert email.html_body =~ "weekly"
      end)
    end
  end

  describe "kyc_approved/2" do
    test "sends a welcome email with the new Alpaca account number", %{user: user} do
      account = %{alpaca_account_number: "920123456"}
      Notifications.kyc_approved(user.id, account)

      assert_email_sent(fn email ->
        assert email.subject =~ "brokerage account is live"
        assert email.to == [{"", user.email}]
        assert email.html_body =~ "You're approved"
        assert email.html_body =~ "920123456"
      end)
    end
  end

  describe "send_safe error paths" do
    test "missing user is a no-op (logged, no crash, no email)" do
      # Use an id that can't exist; assert nothing went out.
      Notifications.deposit_settled(-1, %{amount: Decimal.new("1.00")})
      assert_no_email_sent()
    end

    test "rescues a render crash so the calling business flow keeps running",
         %{user: user} do
      # Bad payload shape — wishlist_filled_email reads :symbol/:qty; pass a
      # map missing both. Should not raise.
      Notifications.wishlist_filled(user.id, %{})
      # An email may or may not go out depending on how the template
      # handles the missing fields — what matters here is that the
      # caller didn't crash. (Notifications.send_safe always returns :ok.)
    end
  end
end
