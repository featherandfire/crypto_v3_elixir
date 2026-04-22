defmodule CryptoPortfolioV3.Chain.TronTokens do
  @moduledoc """
  Hardcoded list of popular TRC-20 contracts we probe for balance.
  TronGrid has no single-call "give me all TRC-20 balances" endpoint, so we
  enumerate known tokens. USDT alone covers ~90% of real Tron holdings by
  value. Extend this list as needed.
  """

  @tokens [
    %{contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", symbol: "USDT", name: "Tether USD", decimals: 6},
    %{contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", symbol: "USDC", name: "USD Coin",    decimals: 6},
    %{contract: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR", symbol: "WTRX", name: "Wrapped TRX", decimals: 6},
    %{contract: "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9", symbol: "JST",  name: "JUST",         decimals: 18}
  ]

  def all, do: @tokens
end
