# Technical decisions

Verified / implemented: 2026-10-09 (Asia/Shanghai).

1. **Static application first.** React, strict TypeScript and Vite, deployed to GitHub
   Pages. No backend, database, account system or LLM calls. Manual costs are computed
   locally and work without network access once the static shell has loaded.
2. **Separate concerns.** `packages/core` contains vendor-independent types, full
   precision arithmetic and deterministic ranking. Providers own external calls and
   dated fare rules; React owns presentation and local preferences. No circular imports.
3. **Honest data.** The provided Fong Road/Britomart scenario is an offline fixture.
   Its distances, times, prices and parking values are assumptions. Changing place
   labels does not change those numbers. Live lookup is a separate explicit action.
4. **Return journeys are independent.** Distances, consumption, tolls, fares, transfer
   counts and minutes are separate for each direction. A daily parking charge is
   included once; users enter the total for their intended parking duration.
5. **Money vs decision score.** Currency is NZD. Intermediate arithmetic is not
   rounded; display rounds to cents. Optional maintenance is shown separately. The
   time-value score is an explanatory decision metric, not a payable price.
6. **No hidden map expense.** No key means manual mode. Browser API keys are public
   credentials, requiring referrer/API restrictions and billing alerts. Map calls are
   tied to buttons; no runtime billing setup is automated. Google routes are displayed
   only on a Google basemap and are not written to localStorage or the offline cache.
7. **Data licensing is not inferred.** GTFS and GIS catalogs are documented but not
   bulk-downloaded or redistributed. Station parking remains user-verified. A GIS
   catalog is never treated as a routing engine.
8. **Reusability.** Source workspaces support React hosts, a framework-independent
   ES-module widget build, and a destination-configurable iframe. Public npm packages
   are deferred; the repository and static widget are independently usable now.
9. **Offline shell.** The service worker only caches this application's same-origin
   shell/assets. It excludes all Google and AT responses. Initial installation still
   requires network access or a locally served build.
10. **Verified comparisons.** Incomplete returns and stale AT fare quotes are excluded
    from recommendations and projections. AT quote context stays in session memory;
    users must reapply after relevant location, schedule or leg changes and after a
    reload. This also prevents Google-derived location context leaking into storage.
