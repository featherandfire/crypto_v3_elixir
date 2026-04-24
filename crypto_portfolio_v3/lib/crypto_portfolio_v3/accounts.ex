defmodule CryptoPortfolioV3.Accounts do
  @moduledoc "User registration, lookup, password authentication, and email verification."

  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.Accounts.{EmailVerification, User}

  @verification_ttl_seconds 600
  @resend_cooldown_seconds 60
  @max_verification_attempts 5

  @doc """
  Register a new user.

  If an existing user owns the email but has not verified it yet, the row is
  reused: the new username/password overwrite the old, any outstanding
  verification codes are invalidated, and the caller treats the response as
  a fresh signup. This keeps an abandoned registration from permanently
  locking an email address (including legitimate retries after a failed
  email delivery).

  A verified user with the same email still rejects via the usual
  `unique_constraint(:email)` changeset error.
  """
  def register_user(attrs) do
    email = Map.get(attrs, "email") || Map.get(attrs, :email)

    case email && Repo.get_by(User, email: email) do
      %User{is_verified: false} = existing ->
        upsert_unverified_user(existing, attrs)

      _ ->
        %User{}
        |> User.registration_changeset(attrs)
        |> Repo.insert()
    end
  end

  # Reuse the unverified row: apply the new attrs via the registration
  # changeset (re-hashes password, re-validates everything), and wipe out
  # any live verification codes in the same transaction so the next
  # create_verification_code/1 call starts clean.
  defp upsert_unverified_user(%User{} = user, attrs) do
    now = DateTime.utc_now()

    Repo.transaction(fn ->
      from(v in EmailVerification,
        where: v.user_id == ^user.id and is_nil(v.consumed_at)
      )
      |> Repo.update_all(set: [consumed_at: now])

      case user |> User.registration_changeset(attrs) |> Repo.update() do
        {:ok, updated} -> updated
        {:error, cs} -> Repo.rollback(cs)
      end
    end)
  end

  def get_user(id), do: Repo.get(User, id)

  @doc "Lookup by email or username. Returns nil if no match."
  def get_user_by_identifier(identifier) when is_binary(identifier) do
    Repo.one(
      from u in User,
        where: u.email == ^identifier or u.username == ^identifier
    )
  end

  def get_user_by_identifier(_), do: nil

  @doc """
  Generate a 6-digit code for the user, bcrypt-hash and persist it, and
  return `{:ok, plain_code, verification}` so the caller can email the
  plain code. The plain code is never written anywhere else.
  """
  @spec create_verification_code(User.t()) ::
          {:ok, binary(), EmailVerification.t()} | {:error, Ecto.Changeset.t()}
  def create_verification_code(%User{} = user) do
    code = generate_code()
    expires_at = DateTime.utc_now() |> DateTime.add(@verification_ttl_seconds, :second)

    attrs = %{
      user_id: user.id,
      code_hash: Bcrypt.hash_pwd_salt(code),
      expires_at: expires_at
    }

    %EmailVerification{}
    |> Ecto.Changeset.cast(attrs, [:user_id, :code_hash, :expires_at])
    |> Ecto.Changeset.validate_required([:user_id, :code_hash, :expires_at])
    |> Repo.insert()
    |> case do
      {:ok, record} -> {:ok, code, record}
      {:error, cs} -> {:error, cs}
    end
  end

  @doc """
  Verify a 6-digit code for the user. On success, marks the record consumed
  and the user verified in a single transaction.
  """
  @spec verify_code(User.t(), binary()) ::
          {:ok, User.t()}
          | {:error, :invalid | :expired | :already_verified | :too_many_attempts}
  def verify_code(%User{is_verified: true}, _code), do: {:error, :already_verified}

  def verify_code(%User{} = user, code) when is_binary(code) do
    now = DateTime.utc_now()

    record =
      Repo.one(
        from v in EmailVerification,
          where: v.user_id == ^user.id and is_nil(v.consumed_at),
          order_by: [desc: v.inserted_at],
          limit: 1
      )

    cond do
      is_nil(record) ->
        Bcrypt.no_user_verify()
        {:error, :invalid}

      DateTime.compare(record.expires_at, now) != :gt ->
        {:error, :expired}

      record.attempts >= @max_verification_attempts ->
        # Already at the cap — burn the record so a later lucky guess
        # can't succeed. User must resend to get a fresh code.
        record |> Ecto.Changeset.change(consumed_at: now) |> Repo.update()
        {:error, :too_many_attempts}

      not Bcrypt.verify_pass(code, record.code_hash) ->
        handle_wrong_code(record, now)

      true ->
        Repo.transaction(fn ->
          {:ok, _} =
            record
            |> Ecto.Changeset.change(consumed_at: now)
            |> Repo.update()

          {:ok, updated_user} =
            user
            |> Ecto.Changeset.change(is_verified: true, email_verified_at: now)
            |> Repo.update()

          updated_user
        end)
    end
  end

  def verify_code(_, _), do: {:error, :invalid}

  # Increment `attempts` atomically. If this increment reaches the cap,
  # also set `consumed_at` so the record is immediately dead and a future
  # correct guess can't slip through. Return :invalid or :too_many_attempts.
  defp handle_wrong_code(%EmailVerification{id: id, attempts: current}, now) do
    new_count = current + 1

    updates = [attempts: new_count]
    updates = if new_count >= @max_verification_attempts, do: [{:consumed_at, now} | updates], else: updates

    from(v in EmailVerification, where: v.id == ^id)
    |> Repo.update_all(set: updates)

    if new_count >= @max_verification_attempts do
      {:error, :too_many_attempts}
    else
      {:error, :invalid}
    end
  end

  @doc """
  Issue a fresh verification code to an already-registered user, subject to
  a per-user cooldown. Returns `{:ok, code, user}` on success; callers are
  responsible for actually emailing the code.

  Errors:
    * `:user_not_found`      — no user matches the identifier
    * `:already_verified`    — user has already verified their email
    * `{:throttled, secs}`   — the last code was issued too recently;
                               `secs` is how many seconds until resend is allowed
  """
  @spec resend_verification_code(binary()) ::
          {:ok, binary(), User.t()}
          | {:error,
             :user_not_found
             | :already_verified
             | {:throttled, non_neg_integer()}
             | Ecto.Changeset.t()}
  def resend_verification_code(identifier) when is_binary(identifier) do
    case get_user_by_identifier(identifier) do
      nil ->
        {:error, :user_not_found}

      %User{is_verified: true} ->
        {:error, :already_verified}

      %User{} = user ->
        case most_recent_verification(user) do
          %EmailVerification{inserted_at: ts} ->
            age = DateTime.diff(DateTime.utc_now(), ts, :second)

            if age < @resend_cooldown_seconds do
              {:error, {:throttled, @resend_cooldown_seconds - age}}
            else
              issue_fresh_code(user)
            end

          nil ->
            issue_fresh_code(user)
        end
    end
  end

  def resend_verification_code(_), do: {:error, :user_not_found}

  defp most_recent_verification(%User{id: uid}) do
    Repo.one(
      from v in EmailVerification,
        where: v.user_id == ^uid,
        order_by: [desc: v.inserted_at],
        limit: 1
    )
  end

  defp issue_fresh_code(%User{} = user) do
    case create_verification_code(user) do
      {:ok, code, _record} -> {:ok, code, user}
      {:error, cs} -> {:error, cs}
    end
  end

  # 6-digit code, 000000–999999. Uses :crypto.strong_rand_bytes for an
  # unpredictable source; modulo 1_000_000 is fine at this range (bias is
  # on the order of 10⁻¹⁴, undetectable for this use).
  defp generate_code do
    <<n::unsigned-integer-size(32)>> = :crypto.strong_rand_bytes(4)
    rem(n, 1_000_000) |> Integer.to_string() |> String.pad_leading(6, "0")
  end

  @doc """
  Authenticate by email or username. Always runs bcrypt (even when the user
  is not found) so response timing doesn't leak account existence.
  """
  def authenticate(identifier, password)
      when is_binary(identifier) and is_binary(password) do
    user =
      Repo.one(
        from u in User,
          where: u.email == ^identifier or u.username == ^identifier
      )

    cond do
      is_nil(user) ->
        Bcrypt.no_user_verify()
        {:error, :invalid_credentials}

      Bcrypt.verify_pass(password, user.hashed_password) ->
        {:ok, user}

      true ->
        {:error, :invalid_credentials}
    end
  end

  def authenticate(_, _), do: {:error, :invalid_credentials}
end
