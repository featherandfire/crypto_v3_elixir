defmodule CryptoPortfolioV3.News do
  @moduledoc """
  Per-symbol news aggregator. Fans out to Alpaca (Benzinga-heavy on the
  free tier) and Finnhub (Reuters, MarketWatch, Yahoo Finance, CNBC,
  SeekingAlpha, etc.) concurrently, normalizes both shapes into the
  unified format the frontend expects, dedupes by URL, and sorts
  newest-first.

  Provider failures are non-fatal — if Finnhub is unconfigured or its
  request times out, we still return Alpaca's articles and vice-versa.
  The user always gets *something* unless both providers are down.

  Output shape mirrors Alpaca's: `%{"news" => [article, ...]}` so the
  controller and frontend don't need a special case for the aggregated
  payload.
  """

  require Logger

  alias CryptoPortfolioV3.{Alpaca, Finnhub}

  # Combined cap on the merged list — keeps the news panel scannable
  # and avoids dumping 30+ near-duplicate headlines.
  @max_articles 20
  # Per-provider await timeout. Tasks run concurrently, so this also
  # caps total latency at ~12s in the worst case.
  @task_timeout_ms 12_000

  @spec for_symbol(binary()) :: {:ok, %{required(String.t()) => list(map())}}
  def for_symbol(symbol) when is_binary(symbol) do
    sym = String.upcase(symbol)

    alpaca_task = Task.async(fn -> safe_alpaca(sym) end)
    finnhub_task = Task.async(fn -> safe_finnhub(sym) end)

    alpaca_articles = await_safe(alpaca_task)
    finnhub_articles = await_safe(finnhub_task)

    combined =
      (alpaca_articles ++ finnhub_articles)
      |> dedupe_by_url()
      |> Enum.sort_by(&sort_key/1, :desc)
      |> Enum.take(@max_articles)

    {:ok, %{"news" => combined}}
  end

  # ── provider fetches ────────────────────────────────────────────────────

  defp safe_alpaca(sym) do
    case Alpaca.news(sym) do
      {:ok, %{"news" => list}} when is_list(list) -> list
      {:ok, list} when is_list(list) -> list
      _ -> []
    end
  end

  defp safe_finnhub(sym) do
    case Finnhub.company_news(sym) do
      {:ok, list} when is_list(list) -> Enum.map(list, &normalize_finnhub/1)
      _ -> []
    end
  end

  defp await_safe(task) do
    try do
      Task.await(task, @task_timeout_ms)
    catch
      :exit, reason ->
        Logger.warning("News provider task exited: #{inspect(reason)}")
        Task.shutdown(task, :brutal_kill)
        []
    end
  end

  # ── normalization ───────────────────────────────────────────────────────

  # Finnhub fields: %{category, datetime (unix seconds), headline, id (int),
  # image (url string), related (csv), source, summary, url}. Reshape to
  # the Alpaca-style keys the frontend already renders.
  defp normalize_finnhub(article) do
    %{
      "id" => stringify_id(article["id"]),
      "headline" => article["headline"],
      "summary" => article["summary"],
      "source" => article["source"],
      "author" => nil,
      "url" => article["url"],
      "created_at" => unix_to_iso(article["datetime"]),
      "updated_at" => unix_to_iso(article["datetime"]),
      "images" => image_list(article["image"]),
      "symbols" => split_related(article["related"])
    }
  end

  defp stringify_id(nil), do: nil
  defp stringify_id(n) when is_integer(n), do: "fh-#{n}"
  defp stringify_id(s) when is_binary(s), do: "fh-#{s}"

  defp unix_to_iso(n) when is_integer(n), do: DateTime.from_unix!(n) |> DateTime.to_iso8601()
  defp unix_to_iso(_), do: nil

  defp image_list(url) when is_binary(url) and url != "", do: [%{"url" => url, "size" => "large"}]
  defp image_list(_), do: []

  defp split_related(csv) when is_binary(csv) do
    csv |> String.split(",") |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
  end

  defp split_related(_), do: []

  # ── dedupe + ordering ──────────────────────────────────────────────────

  # URL is the most reliable equality key — same article will share URL
  # across providers when both syndicate the same source. Headline can
  # differ by whitespace/punctuation; URL is exact.
  defp dedupe_by_url(articles) do
    {kept, _} =
      Enum.reduce(articles, {[], MapSet.new()}, fn art, {acc, seen} ->
        url = art["url"]

        cond do
          is_binary(url) and url != "" and MapSet.member?(seen, url) -> {acc, seen}
          is_binary(url) and url != "" -> {[art | acc], MapSet.put(seen, url)}
          true -> {[art | acc], seen}
        end
      end)

    Enum.reverse(kept)
  end

  # Sort key — falls back to empty string when created_at is missing so
  # those drift to the bottom under :desc sort.
  defp sort_key(%{"created_at" => ts}) when is_binary(ts), do: ts
  defp sort_key(_), do: ""
end
