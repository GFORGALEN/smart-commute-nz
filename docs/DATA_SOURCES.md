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

Google data, if activated, comes from the official Maps JavaScript Routes library and Places (New). Distance is returned in metres and duration in milliseconds, converted to km/minutes by the adapter. Transit fare is used only if Google returns a complete NZD fare; otherwise the live transit request is rejected and manual pricing is needed. See [Google integration and costs](GOOGLE_MAPS.md).

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

| Source                                                                          | Interface / fields                                                                       | Freshness and access                                                                                     | Reuse status                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [AT Developer Portal GTFS Static](https://dev-portal.at.govt.nz/GTFS-API)       | REST over active GTFS; subset of routes, trips, stops; only nonempty fields are returned | No authenticated feed queried; feed update timestamps/frequency and API access requirements not verified | Dataset/product licence, commercial use and redistribution must be checked |
| [AT Open GIS](https://data-atgis.opendata.arcgis.com/)                          | ArcGIS catalog; no specific FeatureServer/item selected                                  | Dataset update date/frequency and authentication remain unknown                                          | Item-specific licence/reuse rights not verified                            |
| [Auckland Council Open Data](https://data-aucklandcouncil.opendata.arcgis.com/) | ArcGIS catalog; no suitable parking tariff dataset selected                              | No selected item; freshness/access unknown                                                               | Item-specific licence/reuse rights not verified                            |

The AT portal links to a downloadable GTFS feed, but this project does not download, bundle or claim to query that feed. Static GTFS provides scheduling entities; it must not be represented as a realtime fare, parking tariff or complete journey optimizer. A catalog search endpoint must not be used as a navigation API.

The AT developer portal's [published reuse terms](https://dev-portal.at.govt.nz/content/html_widgets/5wwz1.html) expressly distinguish website material from the underlying dataset licence. An open catalog's presence is insufficient to claim that all its data may be commercially reused or redistributed.

No machine-readable parking tariff or availability dataset has been integrated for Panmure/Sylvia Park. The Panmure information above is verified published site information; it does not establish current occupancy or the rules for a particular parking space. The MVP accepts manual interchange/parking inputs and requires the user to check posted signs/operator rules. Future integration must select an actual dataset/service, inspect its fields/licence/timestamps, and preserve source-specific limitations in this registry.
