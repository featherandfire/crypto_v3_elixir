defmodule CryptoPortfolioV3.Chain.TronAddress do
  @moduledoc """
  Base58Check decode for Tron T-addresses → 20-byte EVM-style hex.

  Tron's base58 encoding: 0x41 (mainnet version) + 20-byte address + 4-byte
  checksum, encoded as base58. For ABI `balanceOf(address)` calls, we need
  the 20-byte payload (without the 0x41 prefix), left-padded to 32 bytes.
  """

  @alphabet "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

  @spec to_evm_hex(binary()) :: binary() | nil
  def to_evm_hex("T" <> _ = addr) when byte_size(addr) == 34 do
    case decode(addr) do
      <<0x41, payload::binary-size(20), _checksum::binary-size(4)>> ->
        Base.encode16(payload, case: :lower)

      _ ->
        nil
    end
  rescue
    _ -> nil
  end

  def to_evm_hex(_), do: nil

  # Left-pad to 32-byte (64-char hex) ABI parameter.
  @spec abi_encode(binary()) :: binary() | nil
  def abi_encode(address) do
    case to_evm_hex(address) do
      nil -> nil
      hex -> String.pad_leading(hex, 64, "0")
    end
  end

  # Hex with 0x41 prefix (Tron's raw form) → base58check T-address.
  @spec to_base58(binary()) :: binary() | nil
  def to_base58("0x" <> hex) when byte_size(hex) == 42 do
    payload = Base.decode16!(hex, case: :mixed)
    checksum = :crypto.hash(:sha256, :crypto.hash(:sha256, payload)) |> :binary.part(0, 4)
    encode58(payload <> checksum)
  rescue
    _ -> nil
  end

  def to_base58(_), do: nil

  defp encode58(<<>>), do: ""

  defp encode58(bin) do
    leading_zeros = count_leading_zero_bytes(bin)
    n = :binary.decode_unsigned(bin)
    String.duplicate("1", leading_zeros) <> encode58_int(n, "")
  end

  defp encode58_int(0, acc), do: acc

  defp encode58_int(n, acc) do
    c = :binary.part(@alphabet, rem(n, 58), 1)
    encode58_int(div(n, 58), c <> acc)
  end

  defp count_leading_zero_bytes(bin), do: count_leading_zero_bytes(bin, 0)
  defp count_leading_zero_bytes(<<0, rest::binary>>, n), do: count_leading_zero_bytes(rest, n + 1)
  defp count_leading_zero_bytes(_, n), do: n

  defp decode(str) do
    n =
      str
      |> String.to_charlist()
      |> Enum.reduce(0, fn ch, acc -> acc * 58 + char_index(ch) end)

    bytes = :binary.encode_unsigned(n)
    leading_ones = str |> String.to_charlist() |> Enum.take_while(&(&1 == ?1)) |> length()
    :binary.copy(<<0>>, leading_ones) <> bytes
  end

  defp char_index(ch) do
    case :binary.match(@alphabet, <<ch>>) do
      {i, _} -> i
      :nomatch -> raise "invalid base58 char: #{[ch]}"
    end
  end
end
