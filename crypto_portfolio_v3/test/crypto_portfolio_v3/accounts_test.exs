defmodule CryptoPortfolioV3.AccountsTest do
  use CryptoPortfolioV3.DataCase, async: true

  alias CryptoPortfolioV3.Accounts

  @valid %{
    "username" => "testuser",
    "email" => "test@example.com",
    "password" => "password1234"
  }

  describe "register_user/1" do
    test "creates a user with hashed password" do
      assert {:ok, user} = Accounts.register_user(@valid)
      assert user.username == "testuser"
      assert user.email == "test@example.com"
      assert user.hashed_password
      refute user.hashed_password == "password1234"
    end

    test "rejects short password" do
      assert {:error, cs} = Accounts.register_user(Map.put(@valid, "password", "short"))
      assert %{password: [_]} = errors_on(cs)
    end

    test "rejects duplicate username" do
      {:ok, _} = Accounts.register_user(@valid)

      assert {:error, cs} =
               Accounts.register_user(%{@valid | "email" => "other@example.com"})

      assert %{username: [_]} = errors_on(cs)
    end

    test "rejects malformed email" do
      assert {:error, cs} = Accounts.register_user(Map.put(@valid, "email", "not-an-email"))
      assert %{email: [_]} = errors_on(cs)
    end
  end

  describe "authenticate/2" do
    setup do
      {:ok, user} = Accounts.register_user(@valid)
      %{user: user}
    end

    test "succeeds with username + correct password", %{user: user} do
      assert {:ok, returned} = Accounts.authenticate("testuser", "password1234")
      assert returned.id == user.id
    end

    test "succeeds with email + correct password", %{user: user} do
      assert {:ok, returned} = Accounts.authenticate("test@example.com", "password1234")
      assert returned.id == user.id
    end

    test "fails with wrong password" do
      assert {:error, :invalid_credentials} = Accounts.authenticate("testuser", "wrong")
    end

    test "fails with unknown identifier (constant-time — no user leak)" do
      assert {:error, :invalid_credentials} =
               Accounts.authenticate("nobody@example.com", "anything")
    end
  end
end
