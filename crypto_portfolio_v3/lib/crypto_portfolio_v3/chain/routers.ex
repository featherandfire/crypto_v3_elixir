defmodule CryptoPortfolioV3.Chain.Routers do
  @moduledoc "Known DEX/aggregator router addresses (lowercase) → display names."

  @routers %{
    # Uniswap
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d" => "Uniswap V2 Router",
    "0xe592427a0aece92de3edee1f18e0157c05861564" => "Uniswap V3 Router",
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45" => "Uniswap V3 Router 2",
    "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad" => "Universal Router",
    # 1inch
    "0x1111111254eeb25477b68fb85ed929f73a960582" => "1inch AggregationRouter V5",
    "0x111111125421ca6dc452d289314280a0f8842a65" => "1inch AggregationRouter V6",
    # Paraswap
    "0x6a000f20005980200259b80c5102003040001068" => "ParaSwap V6",
    "0xdef171fe48cf0115b1d80b88dc8eab59176fee57" => "ParaSwap V5",
    # 0x / Matcha
    "0xdef1c0ded9bec7f1a1670819833240f027b25eff" => "0x Protocol",
    # Sushiswap
    "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f" => "SushiSwap Router",
    # CoW Swap
    "0x9008d19f58aabd9ed0d60971565aa8510560ab41" => "CoW Protocol",
    # PancakeSwap (BSC)
    "0x10ed43c718714eb63d5aa57b78b54704e256024e" => "PancakeSwap V2 Router"
  }

  @spec name(binary() | nil) :: binary() | nil
  def name(nil), do: nil
  def name(""), do: nil

  def name(address) when is_binary(address) do
    Map.get(@routers, String.downcase(address))
  end
end
