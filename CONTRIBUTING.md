# Contributing

Use Node.js 24 and npm. Run `npm ci`, then `npm run dev`.

Keep the dependency graph one-way: core → providers/i18n → React → web. Core has no
browser or vendor dependencies. Run `npm run lint`, `npm run typecheck`, `npm run test`,
`npm run build`, and `npm run test:e2e` before opening a pull request.
Install the browser once with `npx playwright install chromium`.

Describe observable behavior and include meaningful regression coverage. Never
change tests solely to hide a failure. Do not include credentials, personal location
data, copied Google route content, or third-party datasets without verified rights.

Changes to fare rules require an official source, an effective date, verification
date, documented limits, and tests. Provider failures must not silently become sample
routes. Labels must be added to both English and Simplified Chinese resources.

Google Maps is optional. Contributors can test the offline mode without a key or
payment account. Integration checks using a paid API require the owner's approval.

The project uses the MIT license. External data and Google service content keep
their respective terms; this license does not grant redistribution rights to them.
