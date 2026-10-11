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

## Code conventions

Write identifiers and code comments in English; user-facing text goes through the i18n
resources. Name code, scripts and tests after the capability they serve, not after a
release or phase number. Extract a shared helper only once two real callers need it.
Keep TypeScript `strict`; if an escape hatch such as `any` is unavoidable, scope it
locally and comment why. Files are UTF-8 with LF line endings and a final newline
(see `.editorconfig`); Prettier owns formatting and ESLint owns code-quality rules.

## Dependencies

`.npmrc` installs from the public npm registry with lifecycle scripts disabled, exact
versions, strict engine/peer checks and a 30-day minimum release age. Keep it that way:

- Before adding a dependency, note its purpose, why a few lines of local code would not
  do, maintenance status, exact version, license and known vulnerabilities in the PR.
- Pin direct dependencies to exact versions and commit the matching `package-lock.json`.
  Regenerate the license inventory with `node scripts/license-notices.mjs`.
- Wait 30 days before adopting a new release unless it is a reviewed security fix;
  record the reason when making that exception.
- Never run `npm audit fix --force`. Review the advisory and make the smallest explicit
  upgrade instead.
- If a package genuinely needs its install script, document the exact package, version
  and command and run it explicitly rather than re-enabling scripts globally.
- GitHub Actions are pinned to full commit SHAs with the release tag in a comment.
