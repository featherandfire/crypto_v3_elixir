defmodule CryptoPortfolioV3.Chain.SolanaWallet do
  @moduledoc """
  Fetches native SOL + SPL balances for a wallet. Runs 3 RPC calls in
  parallel (SOL, Token program, Token-2022 program), then aggregates SPL
  accounts by mint since a wallet can hold multiple token accounts for
  the same mint.
  """

  alias CryptoPortfolioV3.Chain.{SolanaMints, SolanaRpc}

  @sol_native_sentinel "native-sol"
  @token_program "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  @token_2022_program "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

  def sol_native_sentinel, do: @sol_native_sentinel

  @spec fetch_balances(binary()) :: {:ok, [map()]}
  def fetch_balances(address) when is_binary(address) do
    [sol_task, std_task, v2_task] = [
      Task.async(fn -> SolanaRpc.get_balance(address) end),
      Task.async(fn -> SolanaRpc.get_token_accounts_by_owner(address, @token_program) end),
      Task.async(fn -> SolanaRpc.get_token_accounts_by_owner(address, @token_2022_program) end)
    ]

    sol_balance =
      case Task.await(sol_task, 30_000) do
        {:ok, lamports} ->
          Decimal.div(Decimal.new(lamports), Decimal.new(1_000_000_000))

        _ ->
          Decimal.new(0)
      end

    std_accts =
      case Task.await(std_task, 30_000) do
        {:ok, list} -> list
        _ -> []
      end

    v2_accts =
      case Task.await(v2_task, 30_000) do
        {:ok, list} -> list
        _ -> []
      end

    native_entries =
      if Decimal.gt?(sol_balance, 0) do
        [
          %{
            mint: @sol_native_sentinel,
            symbol: "SOL",
            name: "Solana",
            decimals: 9,
            balance: sol_balance
          }
        ]
      else
        []
      end

    spl_entries =
      (std_accts ++ v2_accts)
      |> Enum.reduce(%{}, &aggregate_spl/2)
      |> Map.values()

    {:ok, native_entries ++ spl_entries}
  end

  # Walks a `getTokenAccountsByOwner` result entry and folds its amount into
  # the per-mint accumulator. Uses raw `amount` + `decimals` (not `uiAmount`)
  # to preserve precision for dust / whale balances.
  defp aggregate_spl(acct, acc) do
    case get_in(acct, ["account", "data", "parsed", "info"]) do
      %{"mint" => mint, "tokenAmount" => %{"amount" => raw, "decimals" => dec}}
      when is_binary(raw) and is_integer(dec) ->
        case Integer.parse(raw) do
          {0, _} ->
            acc

          {raw_int, _} when raw_int > 0 ->
            balance = Decimal.div(Decimal.new(raw_int), Decimal.new(Integer.pow(10, dec)))
            merge_entry(acc, mint, dec, balance)

          _ ->
            acc
        end

      _ ->
        acc
    end
  end

  defp merge_entry(acc, mint, decimals, balance) do
    case Map.get(acc, mint) do
      nil ->
        Map.put(acc, mint, %{
          mint: mint,
          symbol: mint_label(mint),
          name: mint_label(mint),
          decimals: decimals,
          balance: balance
        })

      %{balance: existing} = entry ->
        Map.put(acc, mint, %{entry | balance: Decimal.add(existing, balance)})
    end
  end

  defp mint_label(mint) do
    case SolanaMints.known(mint) do
      nil -> shorten(mint)
      sym -> sym
    end
  end

  defp shorten(addr), do: "#{String.slice(addr, 0, 4)}…#{String.slice(addr, -4, 4)}"
end
