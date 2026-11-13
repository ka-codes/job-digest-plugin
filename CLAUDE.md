# Job Digest Plugin
Electron + Express app that runs a Claude-driven job digest. Docs: `docs/DATA-SCHEMA.md` (roles.json shape), `docs/RELEASING.md` (release steps), `docs/SETUP-APP.md`, `PRODUCT.md`.

## Layout
- `electron/` desktop shell; `app/server.mjs` Express server; `app/routes/*.mjs` API; `app/lib/` (scheduler, claude headless runner, store, profile-md)
- `app/public/js/app.js` main UI, `wizard.js` first-run wizard, `css/style.css`
- `skills/job-digest/SKILL.md` the digest instructions (steps 1-9); `scripts/connectors/` board scrapers; `templates/` profile template

## Run / test
- Source run: `cd app; $env:PORT=4319; npm start` (4317 belongs to the installed app, which runs old bundled code)
- Server `.mjs` changes need a restart; `app/public/js` is served live (hard refresh)
- Run `node --check <file>` after editing JS/MJS
- Real digest run takes 5-10 min; test via the app's Run Now

## Digest pipeline
- The skill reads profile.md "Priority employers"; `employers-catalog.json` (in the workspace) is UI-only, full roster with checked flags
- `employer-boards.json` is a lookup table of employer -> connector, not a run list; never run connectors for unchecked employers
- `digest_status`: new -> reported (promoted at start of next run) -> saved/closed/not_qualifying. "Still open" = reported
- High fit = fit_score >= 7, excluding closed/not_qualifying (includes new, reported, saved)
- Only close roles whose source was actually checked this run; an earlier run wrongly closed live roles
- Failed fetch (403/empty/JS-only) means WebSearch fallback is mandatory; aggregators need 3+ pages and 2+ keyword searches. A run under ~8 min probably skipped these
- New connector: follow `ashby.mjs` (`normalizeRole`, `makeId`, `printJSON(filterBySeniority(...))`, `fail`); allowed in runs via `Bash(node scripts/connectors/*.mjs*)` in `app/lib/claude.mjs`
- Aggregators with no connector (ReliefWeb, Devex, Impactpool, DevelopmentAid) block Claude's fetch; coverage relies on WebSearch

## UI conventions
- Save / not qualifying / closed remove the row in place (`removeRoleRow` + `updateHomeKpis`), never `navigate()` back to top
- Employer toggles: unchecked employers stay in the UI list and the catalog, only dropped from profile.md

## Rules
- Never commit, push or reference the private workspace (`Documents\job-search-private`); `app/.config.json` points to it
- Leave `app/package-lock.json` out of commits unless asked
- Scraping: honest UA `job-digest-plugin/0.1 (personal job search tool)`, public pages only. No spoofed UAs or scraped API keys
- Distribution: unsigned installer can be blocked by Windows Smart App Control. Paid certs and SignPath are ruled out; MSIX/Microsoft Store is the open option
