defmodule CryptoPortfolioV3.PortfoliosTest do
  use CryptoPortfolioV3.DataCase, async: true

  alias CryptoPortfolioV3.{Accounts, Portfolios}
  alias CryptoPortfolioV3.Market.Coin
  alias CryptoPortfolioV3.Repo

  setup do
    {:ok, user} =
      Accounts.register_user(%{
        "username" => "alice",
        "email" => "alice@example.com",
        "password" => "password1234"
      })

    {:ok, user: user}
  end

  describe "portfolio CRUD" do
    test "create / list / fetch / delete roundtrip", %{user: user} do
      assert {:ok, p} = Portfolios.create_portfolio(user.id, %{"name" => "Main"})
      assert [^p] = Portfolios.list_portfolios_for_user(user.id) |> Enum.map(& &1)
      assert fetched = Portfolios.get_portfolio_for_user(user.id, p.id)
      assert fetched.id == p.id
      assert {:ok, _} = Portfolios.delete_portfolio(p)
      assert Portfolios.get_portfolio_for_user(user.id, p.id) == nil
    end

    test "duplicate name per user → unique constraint", %{user: user} do
      {:ok, _} = Portfolios.create_portfolio(user.id, %{"name" => "Main"})
      assert {:error, cs} = Portfolios.create_portfolio(user.id, %{"name" => "Main"})
      assert cs.errors != []
    end

    test "cross-user: a user cannot see another's portfolio", %{user: alice} do
      {:ok, bob} =
        Accounts.register_user(%{
          "username" => "bob",
          "email" => "bob@example.com",
          "password" => "password1234"
        })

      {:ok, alice_p} = Portfolios.create_portfolio(alice.id, %{"name" => "AlicePort"})
      assert Portfolios.get_portfolio_for_user(bob.id, alice_p.id) == nil
    end
  end

  describe "holdings" do
    setup %{user: user} do
      {:ok, portfolio} = Portfolios.create_portfolio(user.id, %{"name" => "P"})

      {:ok, coin} =
        %Coin{}
        |> Coin.changeset(%{
          coingecko_id: "bitcoin",
          symbol: "btc",
          name: "Bitcoin",
          current_price_usd: Decimal.new("60000")
        })
        |> Repo.insert()

      %{portfolio: portfolio, coin: coin}
    end

    test "create with known coin", %{portfolio: p} do
      assert {:ok, h} =
               Portfolios.create_holding(p.id, %{
                 "coingecko_id" => "bitcoin",
                 "amount" => "0.5",
                 "avg_buy_price" => "40000"
               })

      assert Decimal.equal?(h.amount, Decimal.new("0.5"))
      assert h.coin.symbol == "btc"
    end

    test "EVM wallet_address is lower-cased", %{portfolio: p} do
      assert {:ok, h} =
               Portfolios.create_holding(p.id, %{
                 "coingecko_id" => "bitcoin",
                 "amount" => "1",
                 "wallet_address" => "0xABCD1234567890abcdef1234567890ABCDEF1234"
               })

      assert h.wallet_address == "0xabcd1234567890abcdef1234567890abcdef1234"
    end

    test "duplicate holding (same portfolio + coin + wallet) hits NULLS NOT DISTINCT constraint",
         %{portfolio: p} do
      {:ok, _} =
        Portfolios.create_holding(p.id, %{
          "coingecko_id" => "bitcoin",
          "amount" => "1"
        })

      assert {:error, cs} =
               Portfolios.create_holding(p.id, %{
                 "coingecko_id" => "bitcoin",
                 "amount" => "2"
               })

      assert cs.errors != []
    end

    test "missing coingecko_id → error tuple", %{portfolio: p} do
      assert {:error, :missing_coingecko_id} = Portfolios.create_holding(p.id, %{"amount" => "1"})
    end
  end
end
