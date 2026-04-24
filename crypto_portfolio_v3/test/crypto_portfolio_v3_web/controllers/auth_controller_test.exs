defmodule CryptoPortfolioV3Web.AuthControllerTest do
  use CryptoPortfolioV3Web.ConnCase, async: true

  import Ecto.Query
  import Swoosh.TestAssertions

  alias CryptoPortfolioV3.Accounts

  @valid %{
    "username" => "alice",
    "email" => "alice@example.com",
    "password" => "password1234"
  }

  describe "POST /api/auth/register" do
    test "201 with user + verification message; no token; email sent", %{conn: conn} do
      conn = post(conn, ~p"/api/auth/register", @valid)
      body = json_response(conn, 201)

      assert body["user"]["username"] == "alice"
      assert body["user"]["email"] == "alice@example.com"
      assert body["message"] =~ "verification code"
      refute Map.has_key?(body, "token")

      assert_email_sent(fn email ->
        assert email.subject =~ "confirm your email"
        assert email.to == [{"", "alice@example.com"}]
      end)
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

    test "unverified duplicate email → reuses row + sends fresh code", %{conn: conn} do
      # First attempt — creates an unverified row.
      {:ok, original} = Accounts.register_user(@valid)
      {:ok, _, _} = Accounts.create_verification_code(original)

      # Second attempt with the same email but a different username + password.
      retry = %{
        "username" => "alice2",
        "email" => "alice@example.com",
        "password" => "different-password-1234"
      }

      conn = post(conn, ~p"/api/auth/register", retry)
      body = json_response(conn, 201)

      assert body["user"]["username"] == "alice2"
      refute Map.has_key?(body, "token")

      # Same underlying row: id unchanged, email unchanged, new username.
      reloaded = CryptoPortfolioV3.Repo.get(CryptoPortfolioV3.Accounts.User, original.id)
      assert reloaded.id == original.id
      assert reloaded.email == "alice@example.com"
      assert reloaded.username == "alice2"
      refute reloaded.is_verified

      # Old codes are burnt (any unconsumed row for this user is now consumed).
      active_codes =
        from(v in CryptoPortfolioV3.Accounts.EmailVerification,
          where: v.user_id == ^original.id and is_nil(v.consumed_at)
        )
        |> CryptoPortfolioV3.Repo.all()

      # The fresh code created inside register → send_verification_code is one
      # unconsumed row; the original one should be consumed.
      assert length(active_codes) == 1

      # A fresh email went out with the new code.
      assert_email_sent(fn email ->
        assert email.subject =~ "confirm your email"
        assert email.to == [{"", "alice@example.com"}]
      end)
    end

    test "verified duplicate email → 422", %{conn: conn} do
      {:ok, user} = Accounts.register_user(@valid)
      {:ok, code, _} = Accounts.create_verification_code(user)
      {:ok, _} = Accounts.verify_code(user, code)

      conn =
        post(conn, ~p"/api/auth/register", %{@valid | "username" => "whoever"})

      assert %{"errors" => %{"email" => [_ | _]}} = json_response(conn, 422)
    end
  end

  describe "POST /api/auth/verify-email" do
    setup do
      {:ok, user} = Accounts.register_user(@valid)
      {:ok, code, _record} = Accounts.create_verification_code(user)
      %{user: user, code: code}
    end

    test "200 + token + marks user verified on correct code", %{conn: conn, code: code} do
      conn =
        post(conn, ~p"/api/auth/verify-email", %{"identifier" => "alice", "code" => code})

      assert %{"user" => user, "token" => token} = json_response(conn, 200)
      assert user["username"] == "alice"
      assert String.length(token) > 20

      reloaded = Accounts.get_user_by_identifier("alice")
      assert reloaded.is_verified
      assert reloaded.email_verified_at
    end

    test "401 on wrong code", %{conn: conn} do
      conn =
        post(conn, ~p"/api/auth/verify-email", %{"identifier" => "alice", "code" => "000000"})

      assert %{"error" => "invalid_code"} = json_response(conn, 401)
    end

    test "401 on unknown identifier", %{conn: conn, code: code} do
      conn =
        post(conn, ~p"/api/auth/verify-email", %{"identifier" => "nobody", "code" => code})

      assert %{"error" => "invalid_code"} = json_response(conn, 401)
    end

    test "409 once already verified", %{conn: conn, user: user, code: code} do
      {:ok, _} = Accounts.verify_code(user, code)

      conn =
        post(conn, ~p"/api/auth/verify-email", %{"identifier" => "alice", "code" => code})

      assert %{"error" => "already_verified"} = json_response(conn, 409)
    end

    test "429 after 5 wrong attempts; code is then dead", %{conn: conn, code: code} do
      # 5 wrong codes → the 5th returns too_many_attempts and burns the code.
      for _ <- 1..4 do
        conn =
          post(conn, ~p"/api/auth/verify-email", %{"identifier" => "alice", "code" => "000000"})

        assert %{"error" => "invalid_code"} = json_response(conn, 401)
      end

      conn =
        post(conn, ~p"/api/auth/verify-email", %{"identifier" => "alice", "code" => "000000"})

      assert %{"error" => "too_many_attempts"} = json_response(conn, 429)

      # Even the correct code no longer works on this record.
      conn =
        post(conn, ~p"/api/auth/verify-email", %{"identifier" => "alice", "code" => code})

      # The record is consumed, so lookup finds no active row → 401 invalid_code.
      assert %{"error" => "invalid_code"} = json_response(conn, 401)
    end
  end

  describe "POST /api/auth/login" do
    setup do
      {:ok, user} = Accounts.register_user(@valid)
      {:ok, verified} = verify_user(user)
      %{user: verified}
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

    test "403 when email not yet verified", %{conn: conn} do
      # Fresh unverified user — the setup above only verifies `alice`.
      {:ok, _} =
        Accounts.register_user(%{
          "username" => "bob",
          "email" => "bob@example.com",
          "password" => "password1234"
        })

      conn =
        post(conn, ~p"/api/auth/login", %{
          "identifier" => "bob",
          "password" => "password1234"
        })

      assert %{"error" => "email_not_verified"} = json_response(conn, 403)
    end
  end

  describe "GET /api/auth/me" do
    setup do
      {:ok, user} = Accounts.register_user(@valid)
      {:ok, _} = verify_user(user)
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

  # Helper — generate+consume a verification code so tests that need a
  # logged-in user can skip the full HTTP flow.
  defp verify_user(user) do
    {:ok, code, _} = Accounts.create_verification_code(user)
    Accounts.verify_code(user, code)
  end
end
