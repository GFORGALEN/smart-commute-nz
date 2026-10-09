# Optional Google Maps integration

Reviewed against the official documentation on **9 October 2026**. Manual Mode works without a key, account or paid service. No Google billing, API or quota settings have been changed by this project, and no real key was used during automated tests.

## Configure only when you choose to use Google

Put a browser key in an ignored `.env.local`:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
```

Vite exposes this value to browsers. It is not a secret. Restrict it to your local/deployment HTTP referrers and the APIs you actually use. The account owner must review costs and explicitly choose whether to configure billing and enable Maps JavaScript API, Routes API, Places API (New), and optionally Geocoding API. Never send a key in chat or commit it. See [Google's API security guidance](https://developers.google.com/maps/api-security-best-practices).

## Current SDK and request behavior

The adapter uses `setOptions` / `importLibrary` from [Google's current JavaScript loader](https://github.com/googlemaps/js-api-loader), `google.maps.routes.Route.computeRoutes`, and `PlaceAutocompleteElement` with `gmp-select`. It does not use legacy DirectionsService or the old autocomplete widget. Address selection requests only `formattedAddress` and `location`; predictions are managed by the Google widget. Field masks limit route results to the distance, duration, geometry, transit steps, warnings and available fare needed by the planner. See the [Routes reference](https://developers.google.com/maps/documentation/javascript/reference/route) and [new Places widget guide](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new).

Constructing a provider makes no external request. Call map/autocomplete initialization and route calculation only after the user chooses to activate Google. The route button makes one outbound request and, for round trips with a supplied return time, one separate reversed request. Alternatives depend on Google's response; intermediate waypoints disable alternatives. This adapter limits driving waypoints to ten. Transit waypoints are rejected before any request. Hybrid journeys remain explicit manual journeys in this MVP.

Default driving uses `TRAFFIC_UNAWARE`: selected departure times are omitted and the UI warns that timings do not include current traffic. `trafficAware: true` is an explicit adapter option that uses `TRAFFIC_AWARE` and a **higher-priced Pro SKU**. Any supplied driving departure must be in the future; omitting it uses the request time. Transit accepts dates within Google's documented past/future window. See [traffic options](https://developers.google.com/maps/documentation/javascript/routes/traffic-options).

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

Compute Routes is billed per request. Basic routes with at most ten intermediate waypoints use Essentials; advanced traffic-aware options use Pro. Maps, Places and geocoding have separate charges and session rules. Fetching `displayName` would request a higher Places Details tier, so this adapter omits it. See [Maps JavaScript usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing).

`getMetrics()` reports route requests/errors, map initialization count, selected-place detail requests and geocoding requests. It does **not** measure autocomplete predictions generated internally by the widget and is not a billing meter. A local default limit of 30 route requests per provider session avoids unbounded route-button calls; reloading resets it. It does not cap project-wide costs. Set API quota limits in your own Google project, and monitor billing. Billing budgets are alerts, not hard spending caps.

## Attribution and persistence

Draw route geometry only on the Google map, preserve its attribution, show the adapter's Google Maps attribution next to derived results, and retain any returned transit agency attribution. Route warnings are passed through. Do not hide Google controls/attribution with overlays.

The adapter stores responses only in active session memory and clears them on disposal/new queries. Persist user-authored parameters and addresses, not Google-derived route results, place names, geometry or coordinates. Google's policy generally restricts caching/prefetching; place IDs have a documented exception. See [Maps JavaScript policies](https://developers.google.com/maps/documentation/javascript/policies). A public deployment using Google also needs appropriate public Terms of Use and Privacy Policy.

## Validation limits

Unit tests inject a deterministic SDK loader, cover failure/missing keys, outbound and return separation, transit fares and transfers, and make zero paid requests. Live API coverage, key restrictions, billing account status, specific transit schedules and map rendering need verification by an account owner with an authorized key. Manual Mode remains usable when initialization, authorization, quota or routing fails.
