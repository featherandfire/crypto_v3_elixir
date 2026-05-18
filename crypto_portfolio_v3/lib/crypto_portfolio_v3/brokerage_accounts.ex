defmodule CryptoPortfolioV3.BrokerageAccounts do
  @moduledoc """
  Per-user Alpaca customer account management.

  In sandbox we can auto-create accounts with fixture KYC data so the
  full deposit flow works for any signed-up user (the deposit goes to
  *their* Alpaca account, not the shared `B2B_TEST_ACCOUNT_ID`). In
  production we refuse to auto-create — real KYC is collected via an
  onboarding UI (next iteration).

  Sandbox detection: `BrokerApi.base_url/0` contains "sandbox".
  """

  require Logger
  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.Accounts.User
  alias CryptoPortfolioV3.BrokerFunding.{BrokerApi, Client}
  alias CryptoPortfolioV3.BrokerageAccounts.{Account, AchRelationship}

  @poll_max_attempts 12
  @poll_delay_ms 1_500

  @doc """
  Returns the local brokerage account row for `user_id`, or `nil`.
  Does not touch Alpaca.
  """
  def get_for_user(user_id) when is_integer(user_id) do
    Repo.one(from a in Account, where: a.user_id == ^user_id)
  end

  @doc """
  Returns the user's Alpaca account_id only if their account is in
  `kyc_state: "active"`. Used by trading endpoints to require completed
  onboarding before any order placement. Returns:

    {:ok, alpaca_account_id}
    {:error, :no_account}        — user hasn't onboarded yet
    {:error, :not_active}        — onboarded but Alpaca still SUBMITTED/REJECTED
  """
  def active_alpaca_account_id(user_id) when is_integer(user_id) do
    case get_for_user(user_id) do
      nil -> {:error, :no_account}
      %Account{kyc_state: "active", alpaca_account_id: id} -> {:ok, id}
      %Account{} -> {:error, :not_active}
    end
  end

  @doc """
  Returns the default ACH relationship for a brokerage account, or nil.
  """
  def get_default_relationship(%Account{id: aid}) do
    Repo.one(
      from r in AchRelationship,
        where: r.brokerage_account_id == ^aid and r.is_default == true
    )
  end

  @doc """
  Ensures the user has an ACTIVE Alpaca account with an APPROVED default
  ACH relationship. Returns `{:ok, account, relationship}` on success.

  Returns `{:error, :no_account}` if the user hasn't onboarded yet — the
  caller (e.g. `BrokerFunding`) should surface this so the UI can route
  the user to the KYC form. Onboarding happens explicitly via
  `submit_kyc/2`; this function never creates accounts.

  Used by `BrokerFunding.create_deposit/2` to resolve the destination
  account before submitting a transfer.
  """
  def ensure_for_user(user_id) when is_integer(user_id) do
    case get_for_user(user_id) do
      %Account{kyc_state: "active"} = account ->
        ensure_default_relationship(account)

      %Account{} = account ->
        with {:ok, refreshed} <- refresh_status(account),
             {:ok, ready} <- maybe_advance_kyc(refreshed) do
          ensure_default_relationship(ready)
        end

      nil ->
        {:error, :no_account}
    end
  end

  # ── KYC submission ──────────────────────────────────────────────────────

  @required_fields ~w(
    given_name family_name date_of_birth tax_id
    phone_number street_address city state postal_code
    funding_source
  )

  @disclosure_keys ~w(
    is_control_person is_affiliated_exchange_or_finra
    is_politically_exposed immediate_family_exposed
  )

  @doc """
  Submits the user's KYC payload to Alpaca and persists the resulting
  account row. Returns `{:ok, account}` (status may still be SUBMITTED
  pending Alpaca approval — caller can `refresh_status/1` later).

  Errors:
    {:error, :already_exists}                 — user already has an account row
    {:error, :broker_api_not_configured}      — credentials missing
    {:error, {:validation, [...]}}            — required fields missing
    {:error, {:alpaca_error, reason}}         — Alpaca rejected the payload

  We deliberately don't persist any of the raw KYC fields — Alpaca is
  the system of record. The local row stores only references.
  """
  def submit_kyc(user_id, attrs) when is_integer(user_id) and is_map(attrs) do
    cond do
      not BrokerApi.configured?() ->
        {:error, :broker_api_not_configured}

      get_for_user(user_id) != nil ->
        {:error, :already_exists}

      true ->
        with {:ok, user} <- fetch_user(user_id),
             {:ok, normalized} <- validate_kyc(attrs),
             payload = build_kyc_payload(user, normalized),
             {:ok, resp} <- post_account(payload, user.id),
             {:ok, account} <-
               insert_account(
                 user_id,
                 resp["id"],
                 resp["account_number"],
                 resp["status"]
               ) do
          {:ok, account}
        end
    end
  end

  defp post_account(payload, user_id) do
    case Client.post_account(payload) do
      {:ok, %{"id" => _} = resp} ->
        {:ok, resp}

      {:error, reason} ->
        Logger.warning("Alpaca account create failed for user #{user_id}: #{inspect(reason)}")
        {:error, {:alpaca_error, reason}}
    end
  end

  defp validate_kyc(attrs) do
    string_keyed = stringify(attrs)
    missing = Enum.filter(@required_fields, &blank?(Map.get(string_keyed, &1)))

    if missing == [] do
      {:ok, string_keyed}
    else
      {:error, {:validation, missing}}
    end
  end

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?([]), do: true
  defp blank?(_), do: false

  defp stringify(%{} = m) do
    Map.new(m, fn
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
  end

  # Translates the form payload into Alpaca's POST /v1/accounts body.
  # `funding_source` accepts either a list or a comma-separated string.
  defp build_kyc_payload(%User{email: email}, attrs) do
    now = DateTime.utc_now() |> DateTime.to_iso8601()

    funding_source =
      case attrs["funding_source"] do
        list when is_list(list) -> list
        s when is_binary(s) -> s |> String.split(",") |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
        _ -> []
      end

    %{
      contact:
        %{
          email_address: email,
          phone_number: attrs["phone_number"],
          street_address: List.wrap(attrs["street_address"]),
          city: attrs["city"],
          state: attrs["state"],
          postal_code: attrs["postal_code"],
          country: attrs["country"] || "USA"
        }
        |> drop_blank(),
      identity:
        %{
          given_name: attrs["given_name"],
          middle_name: attrs["middle_name"],
          family_name: attrs["family_name"],
          date_of_birth: attrs["date_of_birth"],
          tax_id: normalize_ssn(attrs["tax_id"]),
          tax_id_type: attrs["tax_id_type"] || "USA_SSN",
          country_of_citizenship: attrs["country_of_citizenship"] || "USA",
          country_of_birth: attrs["country_of_birth"] || "USA",
          country_of_tax_residence: attrs["country_of_tax_residence"] || "USA",
          funding_source: funding_source
        }
        |> drop_blank(),
      disclosures:
        Enum.into(@disclosure_keys, %{}, fn k ->
          {String.to_atom(k), truthy?(Map.get(attrs, k))}
        end),
      agreements: [
        %{agreement: "margin_agreement", signed_at: now, ip_address: "127.0.0.1"},
        %{agreement: "account_agreement", signed_at: now, ip_address: "127.0.0.1"},
        %{agreement: "customer_agreement", signed_at: now, ip_address: "127.0.0.1"}
      ]
    }
  end

  defp drop_blank(map) do
    map
    |> Enum.reject(fn {_, v} -> blank?(v) end)
    |> Map.new()
  end

  defp truthy?(true), do: true
  defp truthy?("true"), do: true
  defp truthy?("1"), do: true
  defp truthy?(1), do: true
  defp truthy?(_), do: false

  # Alpaca accepts SSN as either "123-45-6789" or "123456789" — we send
  # the dashed form because their docs example uses it and validation is
  # stricter there. Strips any non-digit input then re-inserts dashes.
  defp normalize_ssn(nil), do: nil

  defp normalize_ssn(s) when is_binary(s) do
    digits = String.replace(s, ~r/\D/, "")

    case String.length(digits) do
      9 ->
        a = String.slice(digits, 0, 3)
        b = String.slice(digits, 3, 2)
        c = String.slice(digits, 5, 4)
        "#{a}-#{b}-#{c}"

      _ ->
        s
    end
  end

  defp fetch_user(user_id) do
    case Repo.get(User, user_id) do
      nil -> {:error, :user_not_found}
      user -> {:ok, user}
    end
  end

  defp insert_account(user_id, alpaca_id, account_number, status) do
    %Account{}
    |> Account.changeset(%{
      user_id: user_id,
      alpaca_account_id: alpaca_id,
      alpaca_account_number: account_number,
      status: status,
      kyc_state: "pending",
      last_synced_at: DateTime.utc_now()
    })
    |> Repo.insert()
  end

  # Polls Alpaca until the account flips to ACTIVE. Sandbox accounts
  # typically take 5–15s. Times out after ~18s; the caller can retry.
  defp poll_until_active(account, attempt \\ 1)

  defp poll_until_active(_account, attempt) when attempt > @poll_max_attempts do
    {:error, :timeout_waiting_for_active}
  end

  defp poll_until_active(%Account{} = account, attempt) do
    case refresh_status(account) do
      {:ok, %Account{status: "ACTIVE"} = updated} ->
        update_kyc_state(updated, "active")

      {:ok, %Account{status: status} = updated} when status in ~w(REJECTED DISABLED) ->
        update_kyc_state(updated, "failed")
        {:error, {:account_rejected, status}}

      {:ok, _updated} ->
        Process.sleep(@poll_delay_ms)
        poll_until_active(account, attempt + 1)

      {:error, _} = err ->
        err
    end
  end

  defp maybe_advance_kyc(%Account{status: "ACTIVE"} = a),
    do: update_kyc_state(a, "active")

  defp maybe_advance_kyc(%Account{status: s} = a) when s in ~w(REJECTED DISABLED) do
    update_kyc_state(a, "failed")
    {:error, {:account_rejected, s}}
  end

  defp maybe_advance_kyc(%Account{} = a), do: poll_until_active(a)

  @doc """
  Flips `kyc_state` to "active". Used by the show endpoint after a
  successful refresh detects Alpaca has approved the account, so the
  read path can advance state without going through the full
  `ensure_for_user/1` flow (which also creates an ACH relationship —
  not what a polling status check should do).
  """
  def mark_active(%Account{} = a), do: update_kyc_state(a, "active")

  defp update_kyc_state(%Account{} = a, state) do
    prior = a.kyc_state

    result =
      a
      |> Account.changeset(%{kyc_state: state})
      |> Repo.update()

    # Send the welcome email only on the *transition* into "active".
    # The refresh + polling paths can call this repeatedly with the
    # same value; we only want to mail once.
    if state == "active" and prior != "active" do
      case result do
        {:ok, updated} ->
          CryptoPortfolioV3.Notifications.kyc_approved(updated.user_id, updated)

        _ ->
          :ok
      end
    end

    result
  end

  @doc """
  Fetches the latest status from Alpaca and updates the local row.
  Returns the refreshed Account.
  """
  def refresh_status(%Account{alpaca_account_id: alpaca_id} = account) do
    case Client.get_account(alpaca_id) do
      {:ok, %{"status" => status} = resp} ->
        account
        |> Account.changeset(%{
          status: status,
          alpaca_account_number: resp["account_number"] || account.alpaca_account_number,
          last_synced_at: DateTime.utc_now()
        })
        |> Repo.update()

      {:error, reason} ->
        Logger.warning("refresh_status failed for #{alpaca_id}: #{inspect(reason)}")
        {:error, {:alpaca_error, reason}}
    end
  end

  # ── ACH relationship ────────────────────────────────────────────────────

  @doc """
  Ensures the account has an APPROVED default ACH relationship. Creates
  a fixture one in sandbox if missing. Returns `{:ok, account, rel}`.
  """
  def ensure_default_relationship(%Account{} = account) do
    case get_default_relationship(account) do
      %AchRelationship{status: "APPROVED"} = rel ->
        {:ok, account, rel}

      %AchRelationship{} = rel ->
        # Have a row but not approved — refresh from Alpaca.
        with {:ok, refreshed} <- refresh_relationship_status(rel) do
          if refreshed.status == "APPROVED",
            do: {:ok, account, refreshed},
            else: {:error, {:relationship_not_approved, refreshed.status}}
        end

      nil ->
        create_sandbox_relationship(account)
    end
  end

  defp create_sandbox_relationship(%Account{alpaca_account_id: alpaca_id} = account) do
    cond do
      not sandbox?() ->
        {:error, :prod_bank_link_required}

      true ->
        body = sandbox_bank_payload()

        case Client.post_ach_relationship(alpaca_id, body) do
          {:ok, %{"id" => rel_id, "status" => status} = resp} ->
            with {:ok, rel} <-
                   insert_relationship(
                     account.id,
                     rel_id,
                     status,
                     resp["bank_account_type"],
                     resp["bank_account_number"]
                   ),
                 # Sandbox approves instantly; one poll covers it.
                 {:ok, refreshed} <- refresh_relationship_status(rel) do
              {:ok, account, refreshed}
            end

          {:error, reason} ->
            Logger.warning(
              "ACH relationship create failed for acct #{alpaca_id}: #{inspect(reason)}"
            )

            {:error, {:alpaca_error, reason}}
        end
    end
  end

  defp insert_relationship(account_id, alpaca_id, status, bank_type, full_account_no) do
    last4 =
      case full_account_no do
        s when is_binary(s) and byte_size(s) >= 4 -> String.slice(s, -4..-1)
        _ -> nil
      end

    %AchRelationship{}
    |> AchRelationship.changeset(%{
      brokerage_account_id: account_id,
      alpaca_relationship_id: alpaca_id,
      nickname: "Sandbox Bank",
      bank_account_type: bank_type,
      bank_last4: last4,
      status: status,
      is_default: true,
      last_synced_at: DateTime.utc_now()
    })
    |> Repo.insert()
  end

  defp refresh_relationship_status(%AchRelationship{} = rel) do
    case Client.list_ach_relationships(account_id_for(rel)) do
      {:ok, list} when is_list(list) ->
        case Enum.find(list, &(&1["id"] == rel.alpaca_relationship_id)) do
          nil ->
            {:error, :relationship_missing_at_alpaca}

          %{"status" => status} ->
            rel
            |> AchRelationship.changeset(%{
              status: status,
              last_synced_at: DateTime.utc_now()
            })
            |> Repo.update()
        end

      {:error, reason} ->
        {:error, {:alpaca_error, reason}}
    end
  end

  defp account_id_for(%AchRelationship{brokerage_account_id: aid}) do
    Repo.one(
      from a in Account, where: a.id == ^aid, select: a.alpaca_account_id
    )
  end

  # ── Webhook handlers ────────────────────────────────────────────────────

  @doc """
  Handles `account.*` webhooks — most commonly status transitions
  (SUBMITTED → APPROVED → ACTIVE, or REJECTED). Updates the local
  status/kyc_state. No-op if we don't have a matching row.

  Alpaca nests the account under `data` on most event types but some
  older ones use top-level fields — we probe both shapes.
  """
  def handle_account_webhook(payload) when is_map(payload) do
    acct = payload["data"] || payload["account"] || payload

    with id when is_binary(id) <- acct["id"],
         %Account{} = local <- Repo.one(from a in Account, where: a.alpaca_account_id == ^id) do
      attrs = %{
        status: acct["status"] || local.status,
        last_synced_at: DateTime.utc_now()
      }

      attrs =
        case acct["status"] do
          "ACTIVE" -> Map.put(attrs, :kyc_state, "active")
          s when s in ~w(REJECTED DISABLED) -> Map.put(attrs, :kyc_state, "failed")
          _ -> attrs
        end

      local
      |> Account.changeset(attrs)
      |> Repo.update()
    else
      _ -> :ok
    end
  end

  @doc """
  Handles `ach_relationship.*` webhooks — same shape, status transitions
  (QUEUED → APPROVED / CANCELED). Patches the local row.
  """
  def handle_ach_webhook(payload) when is_map(payload) do
    rel = payload["data"] || payload["ach_relationship"] || payload

    with id when is_binary(id) <- rel["id"],
         %AchRelationship{} = local <-
           Repo.one(from r in AchRelationship, where: r.alpaca_relationship_id == ^id) do
      local
      |> AchRelationship.changeset(%{
        status: rel["status"] || local.status,
        last_synced_at: DateTime.utc_now()
      })
      |> Repo.update()
    else
      _ -> :ok
    end
  end

  # ── Sandbox fixtures ────────────────────────────────────────────────────

  # True when the Broker base URL points at the sandbox host. Used to gate
  # the auto-link-a-test-bank convenience below — in prod the user links
  # their own bank via Plaid (out of scope here).
  defp sandbox?, do: String.contains?(BrokerApi.base_url(), "sandbox")

  defp sandbox_bank_payload do
    %{
      account_owner_name: "Sandbox Tester",
      bank_account_type: "CHECKING",
      bank_account_number: "123456789012",
      bank_routing_number: "121000358",
      nickname: "Sandbox Bank Checking"
    }
  end
end
