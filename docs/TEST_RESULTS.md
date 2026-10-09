# Release validation

Release: **0.1.0**. Verified locally on **9 October 2026** on Windows with
Node.js 24.15.0, npm 11.12.0 and Playwright 1.64.0 Chromium. No real Google API
key or paid API request was used.

| Check                                       | Result                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `npm run format:check`                      | Passed                                                     |
| `npm run lint`                              | Passed, no warnings                                        |
| `npm run typecheck`                         | Passed, strict TypeScript                                  |
| `npm run test`                              | **113 passed** across four files                           |
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
- **27 provider tests:** current SDK request shapes via injected test fixtures,
  missing keys, quota and API errors, separate return requests, transit fare
  completeness, manual input validation and dated AT fare rules.
- **25 planner tests:** editable costs, persistence, callback/host props, bilingual
  UI, Google failure/attribution, transient Google data, stale async query rejection,
  incomplete returns, stale AT fare exclusion, manual fare recovery and parking
  acknowledgment reset.
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
$env:VITE_BASE_PATH='/smart-commute-nz/'
npm run build
$env:PLAYWRIGHT_PRODUCTION='1'
npm run test:e2e
```

On a POSIX shell, set the same environment variables before the commands. CI
performs both browser passes and deploys only a successful `main` build. See the
[GitHub Actions runs](https://github.com/GFORGALEN/smart-commute-nz/actions).

## Practical limits

The browser projects use Chromium desktop and a Pixel 7 mobile profile. Safari,
Firefox, physical devices and screen-reader compatibility have not been certified.
Google mocks are test fixtures and never appear as product route data. Real Google
coverage, map rendering, API-key restrictions and billing configuration still need
an authorized account owner's live verification.

The AT table is a dated static estimate, not an AT Mobile feed. Verified zones,
actual transfer conditions and eligibility remain user inputs. Quote verification
does not survive reloads. GTFS routing, GIS fare-zone intersection, automatic hub
search, ferry fares and parking occupancy/tariff feeds are not implemented. See
[data sources](DATA_SOURCES.md) and [Google setup and costs](GOOGLE_MAPS.md).

The initial Fong Road/Britomart scenario is an explicitly labelled offline example.
Its return totals are NZ$10.906 driving, NZ$13.00 transit and NZ$18.410 hybrid before
user-entered parking/tolls. Display rounds to cents; these are not live journey quotes.
