# Optional Google Maps integration

Reviewed against the official documentation on **9 October 2026**. Manual Mode works without a key, account or paid service. No Google billing, API or quota settings have been changed by this project, and no real key was used during automated tests.

## Configure only when you choose to use Google

Put a browser key in an ignored `.env.local`:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
```

Vite exposes this value to browsers. It is not a secret. Restrict it to your local/deployment HTTP referrers and the APIs you actually use. The account owner must review costs and explicitly choose whether to configure billing and enable Maps JavaScript API, Routes API, Places API (New), and optionally Geocoding API. Never send a key in chat or commit it. See [Google's API security guidance](https://developers.google.com/maps/api-security-best-practices).

The public GitHub Pages build uses an owner-authorized browser key supplied through the GitHub Actions repository secret `VITE_GOOGLE_MAPS_API_KEY` during the final deployment build. The local `.env.local` stays ignored by Git, and the key is not committed to source. A static frontend necessarily exposes its browser key to site visitors, even when the build input is a secret. Restrict the key to the deployed and authorized local referrers. With a configured key and an online connection, the planner loads Google Maps and Places address search on startup. Opening that page can generate billable events. Manual Mode remains available when no key is configured, the browser is offline or Google cannot load.

Automated checks and their production test build explicitly use an empty `VITE_GOOGLE_MAPS_API_KEY`, making no paid Google requests. The final deployment build receives the authorized key only after those checks pass on `main`; pull request builds do not receive it. When running checks locally, set the variable to an empty string first so a key in `.env.local` does not change test behavior.

## Current SDK and request behavior

The adapter uses `setOptions` / `importLibrary` from [Google's current JavaScript loader](https://github.com/googlemaps/js-api-loader), `google.maps.routes.Route.computeRoutes`, and `PlaceAutocompleteElement` with `gmp-select`. It does not use legacy DirectionsService or the old autocomplete widget. Address selection requests only `formattedAddress` and `location`; predictions are managed by the Google widget. Field masks limit route results to the distance, duration, geometry, transit steps, warnings and available fare needed by the planner. See the [Routes reference](https://developers.google.com/maps/documentation/javascript/reference/route) and [new Places widget guide](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new).

Constructing a provider makes no external request. The planner initializes its main Google map and the address widgets in the left-hand journey fields automatically when a key and an online connection are available. The first route query is an explicit plan-button action. After that first query, selected addresses and departure/return-time changes trigger a debounced refresh, while fuel, consumption, parking and other cost parameters recalculate locally without another route request. Google distance/duration values are shown as read-only measurements in the same journey editor; the selected alternative is drawn on the main Google map. Manual route editing is available in the fallback mode.

A route query makes one outbound request and, for round trips with a supplied return time, one separate reversed request. Alternatives depend on Google's response; intermediate waypoints disable alternatives. This adapter limits driving waypoints to ten. Transit waypoints are rejected before any request. Hybrid journeys remain explicit manual journeys in this MVP. A failed or incomplete request retains manual fallback rather than fabricating route measurements or fares.

The low-level adapter defaults to `TRAFFIC_UNAWARE`, which omits driving departure times. The planner configures `trafficAware: true` and uses `TRAFFIC_AWARE`, a **higher-priced Pro SKU**, so its left-hand departure and return times affect driving estimates. “Leave now” omits the outbound departure and uses the request time; a scheduled driving departure must be in the future. Each supplied return time is used for a separate reversed query. Transit accepts dates within Google's documented past/future window. See [traffic options](https://developers.google.com/maps/documentation/javascript/routes/traffic-options).

Route durations are estimates. A transit route without a complete NZD fare fails with `INCOMPLETE_RESULT`; it is never compared as free travel. Parking tariffs, legality, availability and toll prices are separate manual values. AT rules never infer fare zones from Google distances.

## Usage and costs

These are global pay-as-you-go prices in **USD**, checked 9 October 2026. The first paid volume tier is shown per 1,000 billable events; free allowances are monthly and shared according to Google's billing rules. These are not a promise that a deployed app will remain free. Check the [current official price list](https://developers.google.com/maps/billing-and-pricing/pricing) before activation.

| SKU                                 | Monthly free usage cap | First paid tier / 1,000 |
| ----------------------------------- | ---------------------: | ----------------------: |
| Dynamic Maps                        |                 10,000 |                 US$7.00 |
| Routes: Compute Routes Essentials   |                 10,000 |                 US$5.00 |
| Routes: Compute Routes Pro          |                  5,000 |                US$10.00 |
| Autocomplete Requests               |                 10,000 |                 US$2.83 |
| Places API Place Details Essentials |                 10,000 |                 US$5.00 |
| Geocoding                           |                 10,000 |                 US$5.00 |

Compute Routes is billed per request. Basic routes with at most ten intermediate waypoints use Essentials; advanced traffic-aware options use Pro. The planner's traffic-aware driving therefore uses Pro. Startup map loading, address typing/selection, the first route plan and subsequent address/schedule refreshes can all produce separate billable events. Fuel and price edits use local arithmetic. Maps, Places and geocoding have separate charges and session rules. Fetching `displayName` would request a higher Places Details tier, so this adapter omits it. See [Maps JavaScript usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing).

`getMetrics()` reports route requests/errors, map initialization count, selected-place detail requests and geocoding requests. It does **not** measure autocomplete predictions generated internally by the widget and is not a billing meter. A local default limit of 30 route requests per provider session bounds route calculations and debounced refreshes; reloading resets it. It does not cap project-wide costs. Set API quota limits in your own Google project, and monitor billing. Billing budgets are alerts, not hard spending caps.

## Attribution and persistence

Draw route geometry only on the Google map, preserve its attribution, show the adapter's Google Maps attribution next to derived results, and retain any returned transit agency attribution. Route warnings are passed through. Do not hide Google controls/attribution with overlays.

The adapter stores responses only in active session memory and clears them on disposal/new queries. Persist user-authored parameters and addresses, not Google-derived route results, place names, geometry or coordinates. Google's policy generally restricts caching/prefetching; place IDs have a documented exception. See [Maps JavaScript policies](https://developers.google.com/maps/documentation/javascript/policies). A public deployment using Google also needs appropriate public Terms of Use and Privacy Policy.

## Validation limits

Automated unit tests inject a deterministic SDK loader and make zero paid requests. They cover failure/missing keys, SDK field validation and error codes, outbound and return separation, transit fares and transfers. Fixture responses are test data, not live measurements.

A separate, bounded live check with an account-owner-authorized local key on **9 October 2026** verified one limited Auckland scenario:

- The Google map loaded, and the app displayed three real driving alternatives.
- Places returned five address predictions and selected-place coordinates. Keyboard selection in the actual `PlaceAutocompleteElement` widget also returned coordinates. Geocoding succeeded.
- The transit SDK returned six route alternatives, but every returned fare object had an empty `currencyCode`. The app rejected these as an incomplete NZD fare and retained Manual Mode; it did not assign a zero fare.

A further check of the updated Google-first planner on the same date verified automatic map loading and the real address inputs. An explicit traffic-aware one-way driving query succeeded; changing the destination then triggered one automatic route refresh. Changing fuel price immediately changed local costs without increasing route requests. These two one-way route queries verify that limited interaction flow, not traffic-aware coverage for other journeys or Google return alternatives.

These live calls were separate from automated tests and may generate billable events. This check does not establish coverage for other routes, schedules, keys or deployment referrers. Google provides a transit fare only when it has fare information for every transit step; see [the official fare property](https://developers.google.com/maps/documentation/javascript/reference/route#RouteTravelAdvisory.transitFare). Use verified AT zones and eligibility or a manually supplied fare when Google cannot provide a complete price. Manual Mode remains usable when initialization, authorization, quota or routing fails.
