# Connectors

Deterministic fetch + normalize scripts for public job-board APIs. Each one takes a board token/slug, hits the board's own public JSON endpoint, and prints an array of roles in the shared shape (see `docs/DATA-SCHEMA.md`). Fit scoring is left to the model — these scripts don't judge fit, they just fetch cleanly and quickly.

## Available now
- `greenhouse.mjs <board-token> [employer-display-name]` — `https://boards-api.greenhouse.io/v1/boards/{token}/jobs`
- `lever.mjs <company-slug> [employer-display-name]` — `https://api.lever.co/v0/postings/{slug}`
- `ashby.mjs <org-slug> [employer-display-name]` — `https://api.ashbyhq.com/posting-api/job-board/{org}`
- `unjobnet.mjs [--pages N] [--level "<level>"]` — UN Jobnet public listing pages (`https://www.unjobnet.org/jobs?page=N`). An aggregator, not an employer: not in `employer-boards.json`; the skill runs it when UN Jobnet is listed under Aggregators / job boards.
- `workable.mjs <account-subdomain> [employer-display-name]` — `https://apply.workable.com/api/v1/widget/accounts/{account}`
- `workday.mjs <tenant> <wd-host> <site> [employer-display-name]` — `https://{tenant}.{wdHost}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`. Workday has no single consistent slug per employer: `tenant`, `wdHost` (the per-tenant shard, e.g. `wd1`/`wd5`/`wd12`), and `site` (the career-site name, often but not always the tenant name) all have to be confirmed live per employer — find the real careers-page link (often via the employer's own careers page or a search engine hit on `{tenant}.wdN.myworkdayjobs.com`) before adding an entry.

`employer-boards.json` maps employer names to a connector config. Only verified, live entries belong here — a wrong guess returns a clean error, not silent bad data. Employers with no entry fall back to WebFetch/WebSearch in `skills/job-digest/SKILL.md`.
