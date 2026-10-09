# Release validation

Release: **0.1.0**. Verified locally on **9 October 2026** on Windows with
Node.js 24.15.0, npm 11.12.0 and Playwright 1.64.0 Chromium. No real Google API
key or paid API request was used in automated checks. A separate, authorized
live follow-up is described below.

| Check                                       | Result                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `npm run format:check`                      | Passed                                                     |
| `npm run lint`                              | Passed, no warnings                                        |
| `npm run typecheck`                         | Passed, strict TypeScript                                  |
| `npm run test`                              | **145 passed** across four files                           |
| Production app and independent widget build | Passed with `/smart-commute-nz/` base                      |
| Development Playwright                      | **20 passed**, four production-only cases skipped          |
| Production Playwright                       | **24 passed**, no skipped cases                            |
| `npm audit --omit=dev`                      | Zero reported runtime vulnerabilities                      |
| Screenshot review                           | Desktop 1440 px and mobile 393 px; no uncaught page errors |

Additional browser smoke checks passed for arrow/Home/End tab navigation and two
simultaneous independent widgets, including uniqueness of document element IDs.

## Coverage

- **39 core tests:** fuel formula, zero and invalid inputs, separate outward/return
  legs, parking once, fares, tolls, maintenance, changing prices/consumption,
  weekly/monthly projections, time value and deterministic ranking.
- **48 provider tests:** current SDK request shapes via injected test fixtures,
  missing keys, quota and API errors, separate return requests, transit fare
  completeness, top-level SDK field masks, structured SDK/RPC error handling,
  sanitized error messages, synchronized autocomplete text and selection races,
  first-map-idle readiness, authentication failure handling, SDK timeouts, cleanup,
  manual input validation and dated AT fare rules.
- **36 planner tests:** editable costs, persistence, callback/host props, bilingual
  UI, Google failure/attribution, transient Google data, stale async query rejection,
  incomplete returns, stale AT fare exclusion, manual fare recovery and parking
  acknowledgment reset. Google-first cases cover automatic map/address initialization,
  one map initialization in StrictMode and across tab changes, unified address
  selection/swap/host updates, read-only route measurements, local fuel/consumption/
  parking/toll recalculation without another route request, offline fallback and
  reconnection that preserves costs. Address changes after the first explicit query
  remove stale results and debounce for 800 ms; obsolete in-flight results are
  discarded and a current refresh is queued without overlapping requests.
  Google transit geometry stays read-only while fares remain editable. Offline
  parking/toll edits propagate to existing live routes on reconnection, and late
  authentication failures are not overwritten by an in-flight route response.
- **22 AT helper tests:** verified zones, concession eligibility, Auckland tag-on
  time, independent return times, transfer windows, explicit ride segments, changed
  endpoints, malformed durations and reapplication after context changes.
- **12 browser scenarios on each device:** three manual options, fuel/fare edits,
  verified AT estimates, separate return legs, waypoints, saved places, Chinese UI,
  offline calculations, responsive screens, production offline reload (including
  the privacy page) and independent widget mounting.

The development server intentionally has no service worker or widget build. Its
two production-only scenarios are skipped on each device; they all pass against
the production build. No failing test was removed to obtain these results.

## Reproduce

Set `VITE_GOOGLE_MAPS_API_KEY` to an empty string before automated checks if a
local `.env.local` contains a real key. PowerShell:

```powershell
$env:VITE_GOOGLE_MAPS_API_KEY=''
```

```sh
npm ci
npx playwright install chromium
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

Then test the production deployment subpath on PowerShell:

```powershell
$env:VITE_GOOGLE_MAPS_API_KEY=''
$env:VITE_BASE_PATH='/smart-commute-nz/'
npm run build
$env:PLAYWRIGHT_PRODUCTION='1'
npm run test:e2e
```

On a POSIX shell, use `export VITE_GOOGLE_MAPS_API_KEY=''` and set the other
environment variables before the commands. CI performs both browser passes with
an empty key. After checks pass on `main`, the final deployment build receives the
authorized browser key from the `VITE_GOOGLE_MAPS_API_KEY` GitHub Actions repository
secret. Pull request builds do not receive it. Deployment requires a successful
`main` build.
See the
[GitHub Actions runs](https://github.com/GFORGALEN/smart-commute-nz/actions).

## Bounded live follow-up

On **9 October 2026**, an account-owner-authorized local key was used for a small
Auckland scenario. The map loaded, and the app returned **three driving alternatives**.
Places returned **five address suggestions** and selected-place coordinates; keyboard
selection in the actual autocomplete widget also returned coordinates. Address
geocoding succeeded.

The transit SDK returned **six route alternatives**, but each fare object had an
empty currency code. The app rejected the incomplete NZD prices and required manual
pricing or verified AT estimates. It did not treat missing fares as free travel.
Google supplies a transit fare only when it knows fares for every transit step; see
[the official fare property](https://developers.google.com/maps/documentation/javascript/reference/route#RouteTravelAdvisory.transitFare).

These limited live calls were separate from automated tests and may produce billable
events. They do not establish availability for other journeys, schedules or deployment
referrers. That initial check did not include traffic-aware driving or Google return alternatives.
No live response was bundled as sample input, and the local key was not committed.

A separate check of the updated Google-first flow on **9 October 2026** verified
automatic map loading and the real address inputs. One explicit, traffic-aware
driving query returned routes; changing the destination then refreshed the route
automatically with one further query. Changing fuel price updated the displayed
cost immediately without increasing the route request count. This follow-up used
two one-way route queries per scenario and does not establish broader traffic-aware
coverage or Google return-route behavior. A 393 px mobile check found no horizontal
overflow. Disconnecting switched to editable manual inputs while preserving the
edited fuel price; reconnecting restored the Google map. This final smoke
check reported no console or uncaught page errors.

## Practical limits

The browser projects use Chromium desktop and a Pixel 7 mobile profile. Safari,
Firefox, physical devices and screen-reader compatibility have not been certified.
Google mocks are test fixtures and never appear as product route data. Live Google
verification is limited to the Auckland checks above. Wider routing coverage,
deployment-specific referrer restrictions and ongoing billing configuration require
the account owner's review.

The AT table is a dated static estimate, not an AT Mobile feed. Verified zones,
actual transfer conditions and eligibility remain user inputs. Quote verification
does not survive reloads. GTFS routing, GIS fare-zone intersection, automatic hub
search, ferry fares and parking occupancy/tariff feeds are not implemented. See
[data sources](DATA_SOURCES.md) and [Google setup and costs](GOOGLE_MAPS.md).

The initial Fong Road/Britomart scenario is an explicitly labelled offline example.
Its return totals are NZ$10.906 driving, NZ$13.00 transit and NZ$18.410 hybrid before
user-entered parking/tolls. Display rounds to cents; these are not live journey quotes.
