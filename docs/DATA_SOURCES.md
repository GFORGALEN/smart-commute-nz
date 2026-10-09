# Data provenance and freshness

The optional AT fare helper is available in the transit and hybrid editors. It uses
independently verified zone counts and explicit transfer eligibility. SuperGold timing
uses the estimated first bus/train tag-on, including preceding access travel; users
must verify their actual tag-on. Repeated weekly/monthly projections do not maintain
card spending history or automatically apply fare caps.

The [official AT park-and-ride page](https://at.govt.nz/driving-and-parking/park-ride),
checked 9 October 2026, lists Panmure as free and open 24 hours, accessed via Forge Way
and Mountwell Crescent. This is published site information, not a parking occupancy
or tariff API. It does not verify the particular space a user will choose. The
calculator retains an explicit parking confirmation rather than assuming every
station or surrounding street allows free parking.

Review date: **9 October 2026**. Machine-readable metadata is exported as `DATA_SOURCES` from `@smart-commute/providers`, including source URLs, field meanings, last verification date, source update date when available, authentication, licensing/reuse status, integration state and limitations. `sourceNeedsReview` flags a record after 90 days by default. Unknown metadata stays explicitly unknown.

## Implemented data

Manual Mode uses user supplied distances, durations, fuel parameters, fares, tolls and parking costs. The labelled Fong Road → Britomart offline example is a set of assumptions for demonstration/testing. It is not a measured route or an AT quote. A zero parking input means an unverified user assumption, not confirmed free parking.

Google data comes from the official Maps JavaScript Routes library and Places (New) when a key is configured and the connection is available. The map and left-hand address search load automatically; the first route query uses the plan button and later address/schedule changes trigger a debounced refresh. Fuel and other cost inputs recalculate locally. Distance is returned in metres and duration in milliseconds, converted to km/minutes by the adapter. The planner uses traffic-aware driving estimates; the low-level adapter retains its traffic-unaware default for other callers. Transit fare is used only if Google returns a complete NZD fare; otherwise the live transit request is rejected and manual pricing is needed. See [Google integration and costs](GOOGLE_MAPS.md).

Automated Google provider tests use injected fixtures and make no paid calls. A separate authorized local live check on **9 October 2026**, limited to an Auckland scenario, verified map loading, three real driving alternatives, Places predictions/selected-place coordinates including widget keyboard selection, and geocoding. The transit SDK returned six alternatives, each with an empty fare currency code, so the app correctly rejected the incomplete prices and kept manual fallback. These results do not verify fare availability or schedule accuracy for other journeys. Google only supplies a transit fare when it has fare information for all transit steps; see [the official fare property](https://developers.google.com/maps/documentation/javascript/reference/route#RouteTravelAdvisory.transitFare).

The public GitHub Pages build receives an owner-authorized browser key from the GitHub Actions repository secret `VITE_GOOGLE_MAPS_API_KEY` at the final deployment build. Online startup automatically loads the Google map and Places widgets and can generate billable events. No-key, offline and failed-query sessions retain Manual Mode. The deployment key is absent from committed source and automated test builds, but is visible to visitors in the static frontend. The local `.env.local` and live responses are not bundled as example data.

AT fares use the official [2026 fare-change tables](https://at.govt.nz/bus-train-ferry/fares-and-discounts/public-transport-fare-changes), effective **1 February 2026**, source updated **13 August 2026**. The following HOP amounts are one-way integrated bus/train journeys, indexed by zone count; 4+ zones use the fourth entry:

| Passenger                                                | 1 zone | 2 zones | 3 zones | 4+ zones |
| -------------------------------------------------------- | -----: | ------: | ------: | -------: |
| Adult / contactless                                      |  $3.00 |   $4.90 |   $6.50 |    $7.90 |
| Child / secondary / tertiary / accessible HOP concession |  $1.55 |   $2.90 |   $3.90 |    $4.75 |
| Community Connect HOP concession                         |  $1.50 |   $2.45 |   $3.25 |    $3.95 |

Use the published table rather than calculating a blanket discount percentage. The API also supports CityLink and published adult/child paper-ticket fares. Concessions require eligibility and registration; contactless is adult pricing. Under-5, child weekend and SuperGold rules are conditional. The user must supply a verified zone count; overlap zones are not calculated automatically. See [AT bus and train fares](https://at.govt.nz/bus-train-ferry/fares-and-discounts/bus-and-train-fares).

Transfers are integrated only with the same payment card/device, no more than 30 minutes between tagging off/on, and a whole journey of no more than four hours. Inputs outside those conditions require separate manual journey fares. Do not charge each qualifying bus/train leg separately.

HOP has a $50 **7-day period** cap; contactless has a $20 **daily** cap. The HOP period starts on the first eligible journey and is not a fixed Monday–Sunday week. `ATFareProvider` applies remaining cap credit only if the caller supplies spend in the correct period on the same card. It does not access MyAT or guess transaction history. Weekly/monthly planner totals remain simple commuting projections unless an explicitly supported cap calculation is applied. See [AT fare cap explanation](https://at.govt.nz/7dayfarecap) and [payment terms](https://at.govt.nz/about-us/about-this-site/terms-conditions/public-transport-payments-terms-of-use).

The snapshot returns no inferred fare for dates before February 2026 or from February 2027 onward pending refresh. Ferries, group travel, ferry monthly-pass interactions, fare-zone geometry and automatic public-holiday detection are outside this implementation. Public holidays can be supplied by the caller.

## Researched but not integrated

| Source                                                                          | Interface / fields                                                                       | Freshness and access                                                                                       | Reuse status                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [AT Developer Portal GTFS Static](https://dev-portal.at.govt.nz/GTFS-API)       | REST over active GTFS; subset of routes, trips, stops; only nonempty fields are returned | Public ZIP inspected 9 Oct 2026; API requires free registration, product subscription and subscription key | Public downloadable GTFS: CC BY 4.0; API product terms require separate review |
| [AT Open GIS](https://data-atgis.opendata.arcgis.com/)                          | ArcGIS catalog; no specific FeatureServer/item selected                                  | Dataset update date/frequency and authentication remain unknown                                            | Item-specific licence/reuse rights not verified                                |
| [Auckland Council Open Data](https://data-aucklandcouncil.opendata.arcgis.com/) | ArcGIS catalog; no suitable parking tariff dataset selected                              | No selected item; freshness/access unknown                                                                 | Item-specific licence/reuse rights not verified                                |

The public GTFS ZIP was inspected temporarily on 9 October 2026 and was not bundled into this project. Its feed dates were 2026-09-30 to 2027-01-24; `fare_attributes.txt` and `fare_rules.txt` had no data rows, all 6,990 stop `zone_id` values were empty, and no Fares v2 files were present. This snapshot cannot supply automatic journey prices. The [official download page](https://at.govt.nz/about-us/at-data-sources/general-transit-feed-specification) identifies CC BY 4.0 for the downloadable GTFS. Authenticated API product terms are separate. Static GTFS provides scheduling entities; it must not be represented as a realtime fare, parking tariff or complete journey optimizer. A catalog search endpoint must not be used as a navigation API. See the [AT integration plan](AT_INTEGRATION.md) for the verified API access requirements, fare-data gaps and implementation steps.

The AT developer portal's [published reuse terms](https://dev-portal.at.govt.nz/content/html_widgets/5wwz1.html) expressly distinguish website material from the underlying dataset licence. An open catalog's presence is insufficient to claim that all its data may be commercially reused or redistributed.

No machine-readable parking tariff or availability dataset has been integrated for Panmure/Sylvia Park. The Panmure information above is verified published site information; it does not establish current occupancy or the rules for a particular parking space. The MVP accepts manual interchange/parking inputs and requires the user to check posted signs/operator rules. Future integration must select an actual dataset/service, inspect its fields/licence/timestamps, and preserve source-specific limitations in this registry.
