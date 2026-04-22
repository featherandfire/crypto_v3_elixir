defmodule CryptoPortfolioV3.Market.YearlyVolatility do
  @moduledoc """
  Pure calc helpers. Given a list of daily close prices, produces the
  high/low + 90/180/365-day annualized volatility used by the yearly
  prefetcher and the `/api/cryptocompare/volatility` endpoint.
  """

  @spec summarize([number()]) :: %{
          high_1y: number(),
          low_1y: number(),
          vol_90d: float() | nil,
          vol_180d: float() | nil,
          vol_365d: float() | nil
        }
        | nil
  def summarize([]), do: nil

  def summarize(prices) when is_list(prices) do
    %{
      high_1y: Enum.max(prices),
      low_1y: Enum.min(prices),
      vol_90d: volatility(prices, 90),
      vol_180d: volatility(prices, 180),
      vol_365d: volatility(prices, 365)
    }
  end

  @spec volatility([number()], pos_integer()) :: float() | nil
  def volatility(prices, tail_n) when is_list(prices) and is_integer(tail_n) do
    pts = if length(prices) >= tail_n, do: Enum.take(prices, -tail_n), else: prices

    if length(pts) < 10 do
      nil
    else
      returns =
        pts
        |> Enum.chunk_every(2, 1, :discard)
        |> Enum.flat_map(fn
          [prev, curr] when prev > 0 -> [(curr - prev) / prev]
          _ -> []
        end)

      if length(returns) < 5 do
        nil
      else
        mean = Enum.sum(returns) / length(returns)
        variance = Enum.reduce(returns, 0.0, fn r, acc -> acc + (r - mean) ** 2 end) / length(returns)
        (:math.sqrt(variance) * :math.sqrt(365) * 10_000)
        |> Float.round(0)
        |> Kernel./(10_000)
      end
    end
  end
end
