# @smart-commute/core

A deterministic TypeScript engine for editable commute estimates. It has no network requests,
browser storage, map SDK, or AI dependency.

```ts
import { compareOptions, createExampleOptions, DEFAULT_SETTINGS } from '@smart-commute/core';

const comparison = compareOptions(createExampleOptions(), {
  ...DEFAULT_SETTINGS,
  fuelPrice: 3.5,
});

console.log(comparison.cheapest.totalCost);
```

Each direction is calculated independently. Set `roundTrip: false` to exclude return
legs. A missing return remains missing and produces the `missing-return` warning;
the engine never invents a reverse journey.

Fuel uses `distanceKm × fuelConsumption ÷ 100 × fuelPrice`. Driving legs may override
the default consumption. Fares and tolls are supplied by the caller. Assign an
integrated fare only once across the relevant transit legs to avoid double counting.
The optional maintenance allowance applies only to driving kilometres. Parking is
a charge on the entire selected commute, counted once even when a return is included.

Results retain numerical precision; format currency when displaying it. Direction
subtotals exclude the commute-level parking charge. Weekly and monthly costs are
`dailyCost × daysPerWeek` and `weeklyCost × weeksPerMonth`. The generalized cost adds
`totalMinutes ÷ 60 × valueOfTime` to monetary cost and is a personal decision metric.

`compareOptions` returns results ordered by cost plus separate cheapest, fastest,
fewest-transfer and best-value winners. Ties resolve using the remaining metrics,
then a lexical identifier comparison. Identifiers must be unique.

Warning codes are `estimated-data`, `unverified-parking` and `missing-return`; translate
them at the presentation layer. All example legs are manual estimates. NZ$0 parking
is explicitly unverified, and does not establish legal or available parking.

Invalid or negative numbers, non-finite calculation results, fractional transfer
counts, unsupported modes, invalid coordinates, empty outbound journeys and empty
comparisons throw descriptive errors. No invalid value silently becomes zero.

Run the package checks from the repository root:

```sh
npm exec vitest run packages/core
npm exec eslint packages/core
```
