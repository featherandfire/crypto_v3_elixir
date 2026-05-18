defmodule Brokerage.CompanyProfile do
  @moduledoc """
  Per-symbol company-info aggregator. Polygon.io is the primary source
  (richer free tier — HQ city, employee count, SIC description) and
  Finnhub is the fallback when Polygon is unconfigured or returns no
  data.

  Output is a stable normalized shape regardless of which provider
  served it, so the frontend never has to branch on data origin.
  """

  require Logger

  alias Brokerage.{Polygon, Finnhub}

  @spec for_symbol(binary()) :: {:ok, map()}
  def for_symbol(symbol) when is_binary(symbol) do
    sym = String.upcase(symbol)
    {:ok, fetch(sym)}
  end

  defp fetch(sym) do
    case Polygon.company_profile(sym) do
      {:ok, results} when is_map(results) ->
        normalize_polygon(results)

      _ ->
        # Polygon missing key, rate-limited, or unknown ticker — fall
        # back to Finnhub's free profile2.
        case Finnhub.company_profile(sym) do
          {:ok, body} when is_map(body) -> normalize_finnhub(body)
          _ -> blank()
        end
    end
  end

  defp blank do
    %{
      name: nil,
      logo: nil,
      headquarters_country: nil,
      headquarters_city: nil,
      industry: nil,
      website: nil,
      employees: nil,
      ipo: nil,
      years_public: nil,
      exchange: nil,
      description: nil,
      source: nil
    }
  end

  # ── Polygon → normalized ───────────────────────────────────────────────

  defp normalize_polygon(r) do
    list_date = r["list_date"]
    address = r["address"] || %{}
    branding = r["branding"] || %{}

    # Polygon's exchange codes are ISO MICs (XNAS, XNYS, ARCX, BATS).
    # Map the common ones to the friendlier label users recognize.
    exchange =
      case r["primary_exchange"] do
        "XNAS" -> "NASDAQ"
        "XNYS" -> "NYSE"
        "ARCX" -> "NYSE Arca"
        "BATS" -> "Cboe BZX"
        other -> other
      end

    %{
      name: r["name"],
      logo: prefix_logo(branding["logo_url"]) || prefix_logo(branding["icon_url"]),
      headquarters_country: country_from_locale(r["locale"]),
      headquarters_city: format_city(address),
      industry: r["sic_description"],
      website: r["homepage_url"],
      employees: r["total_employees"],
      ipo: list_date,
      years_public: years_since(list_date),
      exchange: exchange,
      description: r["description"],
      source: "polygon"
    }
  end

  # Polygon's logo URLs need the API key appended to actually load.
  # Without it the asset 401s. Frontend renders whatever we return,
  # so prefer Finnhub's anonymously-loadable logo when present and we
  # can't make Polygon's work without leaking the key. For now: return
  # nil for Polygon's branding and rely on Finnhub's logo if available
  # (the aggregator can merge later if we want both).
  defp prefix_logo(nil), do: nil
  defp prefix_logo(_url), do: nil

  defp country_from_locale("us"), do: "US"
  defp country_from_locale(other) when is_binary(other), do: String.upcase(other)
  defp country_from_locale(_), do: nil

  defp format_city(%{"city" => city, "state" => state})
       when is_binary(city) and is_binary(state),
       do: "#{city}, #{state}"

  defp format_city(%{"city" => city}) when is_binary(city), do: city
  defp format_city(_), do: nil

  # ── Finnhub → normalized (free tier fallback) ─────────────────────────

  defp normalize_finnhub(body) do
    ipo = body["ipo"]

    %{
      name: body["name"],
      logo: body["logo"],
      headquarters_country: body["country"],
      headquarters_city: nil,
      industry: body["finnhubIndustry"],
      website: body["weburl"],
      employees: nil,
      ipo: ipo,
      years_public: years_since(ipo),
      exchange: body["exchange"],
      description: nil,
      source: "finnhub"
    }
  end

  # ── shared ──────────────────────────────────────────────────────────────

  defp years_since(date) when is_binary(date) do
    case Date.from_iso8601(date) do
      {:ok, d} ->
        years = Date.diff(Date.utc_today(), d) |> div(365)
        if years >= 0, do: years, else: nil

      _ ->
        nil
    end
  end

  defp years_since(_), do: nil
end
