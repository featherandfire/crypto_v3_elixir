defmodule CryptoPortfolioV3Web.AuthControllerTest do
  use CryptoPortfolioV3Web.ConnCase, async: true

  alias CryptoPortfolioV3.Accounts

  @valid %{
    "username" => "alice",
    "email" => "alice@example.com",
    "password" => "password1234"
  }

  describe "POST /api/auth/register" do
    test "201 + token + user on valid payload", %{conn: conn} do
      conn = post(conn, ~p"/api/auth/register", @valid)
      assert %{"user" => user, "token" => token} = json_response(conn, 201)
      assert user["username"] == "alice"
      assert user["email"] == "alice@example.com"
      assert String.length(token) > 20
    end

    test "422 on duplicate username", %{conn: conn} do
      {:ok, _} = Accounts.register_user(@valid)

      conn =
        post(conn, ~p"/api/auth/register", %{@valid | "email" => "other@example.com"})

      assert %{"errors" => %{"username" => [_ | _]}} = json_response(conn, 422)
    end

    test "422 on short password", %{conn: conn} do
      conn = post(conn, ~p"/api/auth/register", %{@valid | "password" => "short"})
      assert %{"errors" => %{"password" => [_ | _]}} = json_response(conn, 422)
    end
  end

  describe "POST /api/auth/login" do
    setup do
      {:ok, _} = Accounts.register_user(@valid)
      :ok
    end

    test "200 + token on correct password (by username)", %{conn: conn} do
      conn =
        post(conn, ~p"/api/auth/login", %{
          "identifier" => "alice",
          "password" => "password1234"
        })

      assert %{"user" => _, "token" => _} = json_response(conn, 200)
    end

    test "200 on correct password (by email)", %{conn: conn} do
      conn =
        post(conn, ~p"/api/auth/login", %{
          "identifier" => "alice@example.com",
          "password" => "password1234"
        })

      assert %{"token" => _} = json_response(conn, 200)
    end

    test "401 on wrong password", %{conn: conn} do
      conn =
        post(conn, ~p"/api/auth/login", %{
          "identifier" => "alice",
          "password" => "wrong"
        })

      assert %{"error" => "invalid_credentials"} = json_response(conn, 401)
    end
  end

  describe "GET /api/auth/me" do
    setup do
      {:ok, _} = Accounts.register_user(@valid)
      :ok
    end

    test "200 with valid bearer token", %{conn: conn} do
      %{"token" => token} =
        post(conn, ~p"/api/auth/login", %{
          "identifier" => "alice",
          "password" => "password1234"
        })
        |> json_response(200)

      conn =
        build_conn()
        |> put_req_header("authorization", "Bearer #{token}")
        |> get(~p"/api/auth/me")

      assert %{"user" => %{"username" => "alice"}} = json_response(conn, 200)
    end

    test "401 with no token", %{conn: conn} do
      conn = get(conn, ~p"/api/auth/me")
      assert %{"error" => "unauthorized"} = json_response(conn, 401)
    end

    test "401 with garbage token", %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer not-a-real-token")
        |> get(~p"/api/auth/me")

      assert %{"error" => "unauthorized"} = json_response(conn, 401)
    end
  end
end
