defmodule CryptoPortfolioV3.BrokerFunding do
  @moduledoc """
  Funding context. Records customer deposit intent locally; when Broker
  API credentials are configured, also fires a real POST against the
  user's own Alpaca account (resolved via
  `BrokerageAccounts.ensure_for_user/1`) so the row tracks a real
  Alpaca transfer.

  Path A — `BrokerApi.configured?/0` is true:
    insert local row → resolve user's Alpaca account + ACH relationship
    → call Client.create_transfer → on success patch `reference` to
    Alpaca's transfer id and `status` to Alpaca's status (lowercased:
    queued/pending/approved/complete/...). On Alpaca error the row
    stays but is marked `status: "failed"` with the error in `note`.

  Path B — credentials missing:
    insert local row only, with note tagged `[stub]`.
  """

  require Logger
  import Ecto.Query

  alias CryptoPortfolioV3.Repo
  alias CryptoPortfolioV3.BrokerFunding.{BrokerApi, Client, Deposit}
  alias CryptoPortfolioV3.{BrokerageAccounts, WishlistItems}

  @methods ~w(ach wire instant)

  def create_deposit(user_id, attrs) when is_integer(user_id) do
    user_note = Map.get(attrs, "note") || Map.get(attrs, :note)
    method = normalize_method(Map.get(attrs, "method") || Map.get(attrs, :method))

    params = %{
      user_id: user_id,
      amount: Map.get(attrs, "amount") || Map.get(attrs, :amount),
      method: method,
      bank_label: Map.get(attrs, "bank_label") || Map.get(attrs, :bank_label) || "Linked bank",
      reference: gen_reference(),
      status: "pending",
      direction: "INCOMING",
      note: stamp_stub(user_note)
    }

    with {:ok, deposit} <- %Deposit{} |> Deposit.changeset(params) |> Repo.insert() do
      maybe_submit_transfer(deposit, user_id)
    end
  end

  @doc """
  Customer-initiated withdrawal (OUTGOING transfer). Mirrors create_deposit
  but flips the direction. Same row shape, same table, same status
  vocabulary — the activity log and the deposit-history list both render
  these uniformly with a direction badge.
  """
  def create_withdrawal(user_id, attrs) when is_integer(user_id) do
    user_note = Map.get(attrs, "note") || Map.get(attrs, :note)
    method = normalize_method(Map.get(attrs, "method") || Map.get(attrs, :method))

    params = %{
      user_id: user_id,
      amount: Map.get(attrs, "amount") || Map.get(attrs, :amount),
      method: method,
      bank_label: Map.get(attrs, "bank_label") || Map.get(attrs, :bank_label) || "Linked bank",
      reference: gen_reference(),
      status: "pending",
      direction: "OUTGOING",
      note: stamp_stub(user_note)
    }

    with {:ok, withdrawal} <- %Deposit{} |> Deposit.changeset(params) |> Repo.insert() do
      maybe_submit_transfer(withdrawal, user_id)
    end
  end

  # If transfers are enabled, hit Alpaca and patch the row with the result.
  # `ach` and `instant` both map to Alpaca's `transfer_type: "ach"` —
  # instant is just an eligibility-based feature where Alpaca credits a
  # portion immediately, surfaced as `instant_amount` in the response.
  # `wire` falls through to local-only because it needs a separate
  # recipient_banks resource we don't yet capture.
  defp maybe_submit_transfer(%Deposit{method: m} = deposit, user_id)
       when m in ~w(ach instant) do
    if BrokerApi.configured?() do
      submit_alpaca_transfer(deposit, user_id)
    else
      {:ok, deposit}
    end
  end

  defp maybe_submit_transfer(%Deposit{} = deposit, _user_id), do: {:ok, deposit}

  # Resolves the user's brokerage account + default ACH relationship,
  # auto-creating both in sandbox. On any failure during onboarding,
  # marks the deposit failed with the reason rather than crashing.
  defp submit_alpaca_transfer(%Deposit{} = deposit, user_id) do
    case BrokerageAccounts.ensure_for_user(user_id) do
      {:ok, account, relationship} ->
        body = %{
          transfer_type: "ach",
          relationship_id: relationship.alpaca_relationship_id,
          amount: Decimal.to_string(deposit.amount, :normal),
          direction: deposit.direction || "INCOMING"
        }

        case Client.create_transfer(account.alpaca_account_id, body) do
          {:ok, %{"id" => transfer_id} = resp} ->
            # Outgoing transfers (withdrawals) email the user immediately
            # on successful submission — the meaningful event is "your
            # money's on its way", not the eventual ACH settlement.
            if deposit.direction == "OUTGOING" do
              CryptoPortfolioV3.Notifications.withdrawal_initiated(deposit.user_id, deposit)
            end

            patch_from_alpaca(deposit, transfer_id, resp["status"], resp["instant_amount"])

          {:ok, other} ->
            Logger.warning("Alpaca transfer ok but missing id: #{inspect(other)}")
            {:ok, deposit}

          {:error, reason} ->
            mark_failed(deposit, reason)
        end

      {:error, reason} ->
        mark_failed(deposit, {:onboarding, reason})
    end
  end

  defp patch_from_alpaca(%Deposit{} = deposit, transfer_id, alpaca_status, instant_amount) do
    deposit
    |> Deposit.changeset(%{
      reference: transfer_id,
      status: map_alpaca_status(alpaca_status),
      instant_amount: parse_instant_amount(instant_amount)
    })
    |> Repo.update()
  end

  # Alpaca returns instant_amount as a decimal string (e.g. "0", "1000").
  # Treat "0"/missing as null so the column reflects "no instant credit"
  # cleanly rather than a meaningless zero.
  defp parse_instant_amount(nil), do: nil

  defp parse_instant_amount(s) when is_binary(s) do
    case Decimal.parse(s) do
      {d, ""} -> if Decimal.compare(d, 0) == :gt, do: d, else: nil
      _ -> nil
    end
  end

  defp parse_instant_amount(_), do: nil

  # Alpaca transfer statuses observed: QUEUED, SUBMITTED, PENDING,
  # APPROVED, COMPLETE, REJECTED, CANCELED, RETURNED. Map to our
  # 3-state set so the existing UI keeps working without churn.
  defp map_alpaca_status(s) when is_binary(s) do
    case String.upcase(s) do
      "COMPLETE" -> "completed"
      "APPROVED" -> "completed"
      "REJECTED" -> "failed"
      "CANCELED" -> "failed"
      "RETURNED" -> "failed"
      _ -> "pending"
    end
  end

  defp map_alpaca_status(_), do: "pending"

  defp mark_failed(%Deposit{} = deposit, reason) do
    note = format_failure(deposit.note, reason)
    Logger.warning("Alpaca transfer failed for deposit #{deposit.id}: #{inspect(reason)}")

    deposit
    |> Deposit.changeset(%{status: "failed", note: note})
    |> Repo.update()
  end

  defp format_failure(prior_note, {:http_error, status, %{"message" => msg}}),
    do: prefix_note(prior_note, "[alpaca #{status}] #{msg}")

  defp format_failure(prior_note, {:http_error, status, body}),
    do: prefix_note(prior_note, "[alpaca #{status}] #{inspect(body)}")

  defp format_failure(prior_note, {:onboarding, :prod_onboarding_required}),
    do: prefix_note(prior_note, "[onboarding] complete KYC before depositing")

  defp format_failure(prior_note, {:onboarding, :timeout_waiting_for_active}),
    do: prefix_note(prior_note, "[onboarding] account still being approved — try again in a minute")

  defp format_failure(prior_note, {:onboarding, {:account_rejected, status}}),
    do: prefix_note(prior_note, "[onboarding] account rejected (#{status})")

  defp format_failure(prior_note, {:onboarding, reason}),
    do: prefix_note(prior_note, "[onboarding error] #{inspect(reason)}")

  defp format_failure(prior_note, reason),
    do: prefix_note(prior_note, "[alpaca error] #{inspect(reason)}")

  defp prefix_note(nil, tag), do: tag
  defp prefix_note("", tag), do: tag
  defp prefix_note(text, tag), do: "#{tag} · #{text}"

  # Tags the row with `[stub]` when we won't be hitting Alpaca for this
  # deposit (creds unset), so future audits can tell intent-only rows
  # from real Alpaca transfers at a glance.
  defp stamp_stub(user_note) do
    if BrokerApi.configured?() do
      user_note
    else
      tag(user_note, "[stub] no Broker API credentials")
    end
  end

  defp tag(nil, t), do: t
  defp tag("", t), do: t
  defp tag(text, t), do: "#{t} · #{text}"

  @doc """
  Webhook handler for `transfer.*` events. Looks up the local deposit
  by Alpaca's transfer id (stored in `reference`) and patches status,
  instant_amount, and reason fields from the new payload. No-op if
  we don't have a matching deposit row (transfer initiated outside
  our system, or status update for a transfer we never recorded).

  When the deposit transitions to `completed`, kicks off wishlist
  auto-execution for the depositing user. That's the connector that
  turns a pending wishlist entry into a real order the moment funds
  settle — the core "deposit → auto-buy" mechanic.

  The payload shape depends on event type, but Alpaca consistently
  nests the transfer object under `data` (or sometimes top-level on
  legacy events). We probe both.
  """
  def handle_webhook(payload) when is_map(payload) do
    transfer = payload["data"] || payload["transfer"] || payload

    with id when is_binary(id) <- transfer["id"],
         %Deposit{} = deposit <- Repo.one(from d in Deposit, where: d.reference == ^id),
         {:ok, updated} <- patch_from_webhook(deposit, transfer) do
      if updated.status == "completed" and deposit.status != "completed" do
        # In mock mode the real Alpaca isn't tracking this transfer, so
        # the mock's view of cash would stay $0 unless we tell it the
        # deposit settled. In prod this is a no-op (Server isn't running).
        if CryptoPortfolioV3.AlpacaMock.Server.enabled?() do
          CryptoPortfolioV3.AlpacaMock.Server.complete_transfer(id)
        end

        # Deposits notify on settlement — the meaningful event for the
        # user is "cash available to invest." Withdrawals notify at
        # submission (in submit_alpaca_transfer below) instead, because
        # the meaningful event there is "your money's on its way." So
        # we only fire deposit_settled on the INCOMING path here.
        if updated.direction != "OUTGOING" do
          CryptoPortfolioV3.Notifications.deposit_settled(updated.user_id, updated)
        end

        # Newly-settled deposit — try to fill the user's pending wishlist
        # inline. Each fill is ~1-2 Alpaca calls; total <5s for typical
        # wishlists. Doing it synchronously keeps the response window
        # tied to the work — and means the webhook ack itself confirms
        # the fills are durable, not just queued in a Task that could
        # die. Move to async (Oban/Task.Supervisor) once we need higher
        # throughput than one fill batch per webhook.
        # Only run wishlist fills on INCOMING (deposits credited cash).
        # OUTGOING withdrawals don't add buying power, so there's nothing
        # to fill.
        if updated.direction != "OUTGOING" do
          attempt_wishlist_fills(updated.user_id)
        end
      end

      {:ok, updated}
    else
      _ -> :ok
    end
  end

  defp patch_from_webhook(%Deposit{} = deposit, transfer) do
    new_status = map_alpaca_status(transfer["status"])
    instant = parse_instant_amount(transfer["instant_amount"])

    attrs = %{
      status: new_status,
      instant_amount: instant || deposit.instant_amount
    }

    attrs =
      case transfer["reason"] do
        nil -> attrs
        "" -> attrs
        reason -> Map.put(attrs, :note, prefix_note(deposit.note, "[alpaca] #{reason}"))
      end

    deposit
    |> Deposit.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Walks the user's pending wishlist FIFO (`position`, then `id`) and
  places each as a real order on their Alpaca customer account. Stops
  on insufficient buying power; logs and skips individual rejections.

  Called from the deposit-completed webhook handler. Safe to call
  manually for backfill/retry — only `status: pending` items are
  considered, and a successful placement flips the row to `filled`
  so it won't be re-processed.
  """
  def attempt_wishlist_fills(user_id) when is_integer(user_id) do
    with {:ok, account_id} <- BrokerageAccounts.active_alpaca_account_id(user_id),
         items when items != [] <- WishlistItems.list_pending_for_user(user_id) do
      Logger.info("Wishlist auto-execute: #{length(items)} pending for user #{user_id}")
      Enum.reduce_while(items, :ok, fn item, _acc ->
        case place_wishlist_order(account_id, item) do
          {:ok, _} -> {:cont, :ok}
          {:stop, reason} ->
            Logger.info("Wishlist auto-execute stopping for user #{user_id}: #{reason}")
            {:halt, :ok}
          {:skip, _} -> {:cont, :ok}
        end
      end)
    else
      [] -> :ok
      {:error, _} -> :ok
    end
  end

  defp place_wishlist_order(account_id, item) do
    body =
      %{
        symbol: item.symbol,
        qty: Decimal.to_string(item.qty, :normal),
        side: item.side,
        type: item.order_type,
        time_in_force: item.time_in_force
      }
      |> maybe_put_limit_price(item)

    case Client.place_order(account_id, body) do
      {:ok, %{"id" => order_id}} ->
        WishlistItems.mark_filled(item, order_id)
        CryptoPortfolioV3.Notifications.wishlist_filled(item.user_id, item)
        {:ok, item}

      {:error, {:http_error, _, body}} ->
        cond do
          insufficient_buying_power?(body) ->
            # Don't mark the item failed — leave pending so the next
            # deposit can pick it up.
            {:stop, "insufficient_buying_power on #{item.symbol}"}

          true ->
            Logger.warning("Wishlist place failed for #{item.symbol}: #{inspect(body)}")
            WishlistItems.mark_failed(item)
            {:skip, body}
        end

      {:error, reason} ->
        Logger.warning("Wishlist place errored for #{item.symbol}: #{inspect(reason)}")
        WishlistItems.mark_failed(item)
        {:skip, reason}
    end
  end

  defp maybe_put_limit_price(body, %{order_type: "limit", limit_price: %Decimal{} = lp}),
    do: Map.put(body, :limit_price, Decimal.to_string(lp, :normal))

  defp maybe_put_limit_price(body, _), do: body

  # Alpaca returns a JSON body with a `message` for trading errors.
  # The exact phrasing has shifted over time ("insufficient buying
  # power", "buying_power"), so match on substring rather than code.
  defp insufficient_buying_power?(%{"message" => msg}) when is_binary(msg) do
    s = String.downcase(msg)
    String.contains?(s, "buying power") or String.contains?(s, "buying_power")
  end

  defp insufficient_buying_power?(_), do: false

  def list_deposits(user_id, opts \\ []) when is_integer(user_id) do
    limit = Keyword.get(opts, :limit, 50)

    Deposit
    |> where([d], d.user_id == ^user_id and d.direction == "INCOMING")
    |> order_by([d], desc: d.inserted_at)
    |> limit(^limit)
    |> Repo.all()
  end

  @doc "Mirror of list_deposits/2 for the OUTGOING side (withdrawals)."
  def list_withdrawals(user_id, opts \\ []) when is_integer(user_id) do
    limit = Keyword.get(opts, :limit, 50)

    Deposit
    |> where([d], d.user_id == ^user_id and d.direction == "OUTGOING")
    |> order_by([d], desc: d.inserted_at)
    |> limit(^limit)
    |> Repo.all()
  end

  defp normalize_method(m) when m in @methods, do: m
  defp normalize_method(_), do: "ach"

  # Mock Alpaca-style transfer reference: "DEP-<8 random alphanumeric>".
  # Will be replaced with the real Alpaca transfer id once Broker API is wired.
  defp gen_reference do
    rand =
      :crypto.strong_rand_bytes(6)
      |> Base.encode32(padding: false, case: :upper)
      |> String.slice(0, 8)

    "DEP-#{rand}"
  end
end
