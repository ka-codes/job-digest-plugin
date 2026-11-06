---
name: job-digest
description: Search for currently open roles that match the user's profile.md, score each 1-10 against their real experience, avoid repeats using roles.json, and return a scannable digest. Use when the user asks for a job digest, job search, or to check saved roles.
---

# Job digest

Never apply, contact anyone, create accounts, log in, or bypass paywalls. Drafting cover letters for the user to send is fine.

This skill may run interactively (the user asked for it) or headlessly (an unattended scheduled run, nobody watching). If a step would normally need a clarifying question, make the conservative choice — skip the role, or note it — and continue. A scheduled run has no one to answer.

## Inputs (in the user's working folder)
- `profile.md`: background, target roles and levels, priority employers, locations in priority order, pay floor and goal, exclusions. Copy from `templates/profile.example.md` if missing and ask the user to fill it in. **Locations list semantics**: every entry must be a real place the user will actually work from (a city, "Remote", etc.) — except "Hybrid", which is not a place and never by itself satisfies the location criterion. A role is only a location match if its actual duty station/base city is one of the user's OTHER listed places (or the role is genuinely fully remote); "hybrid, based in Lagos" does not match a list that includes "Hybrid" but not Lagos, even though the word "hybrid" appears on both. A role whose only connection to the list is the word "hybrid" has no location match at all, and `fit_gap` must say so plainly rather than treating it as a partial match.
- `roles.json`: structured role records, the source of truth for what's already been seen. Create as `[]` if missing. **This exact shape, every field present on every record (use `null`/`""`/`false` for anything unknown — never omit a field or invent different field names):**
  ```json
  {
    "id": "greenhouse:anthropic:5456619008",
    "title": "Program Director",
    "org": "Example Foundation",
    "location": "Washington DC",
    "employment_type": "full_time",
    "is_roster": false,
    "pay_min": 180000,
    "pay_max": 220000,
    "pay_currency": "USD",
    "pay_stated": true,
    "fit_score": 7,
    "fit_why": "Direct match on multi-country program leadership.",
    "fit_gap": "No prior foundation-sector experience.",
    "source": "greenhouse",
    "source_url": "https://...",
    "posted_date": "2026-10-10",
    "deadline": "2026-11-20",
    "first_seen": "2026-10-19",
    "last_checked": "2026-11-02",
    "digest_status": "new",
    "saved_by_user": false,
    "notes": ""
  }
  ```
  `id`: `source:org-slug:external-id` for a connector-sourced role (stable across runs); `web:<sha1 of "title|org|url", first 12 hex chars, prefixed "web:">` for a WebFetch/WebSearch-sourced role with no native id. `digest_status` must be one of `new | saved | reported | closed | not_qualifying` — this is what the dashboard app filters on, so a missing or differently-named field means the role silently never appears anywhere in the UI even though it was found. `employment_type` must be one of `full_time | part_time | contract | internship | unspecified` — connector-sourced roles already come with this field filled in by the connector script, don't change it; for WebFetch/WebSearch-sourced roles, set it from what the posting text actually states, defaulting to `unspecified` rather than guessing. `is_roster` is `true` only when the posting is itself a standing/evergreen vacancy or roster-building announcement rather than a single real-time opening — common at UN agencies and large INGOs, language like "roster", "standing vacancy", "rolling basis", "pool of candidates", "indefinite vacancy announcement"; check this for every new role regardless of source, default `false`. (Full reference, if reachable: `docs/DATA-SCHEMA.md` in this plugin's own repo — but don't rely on being able to open it from inside the user's private working folder; the shape above is authoritative on its own.)
- `applications.json`: structured application-tracking records. Create as `[]` if missing; this skill reads it for context but only `commands/track.md` writes to it.
- `scripts/connectors/employer-boards.json`: employer name → connector config, for employers with a confirmed Greenhouse/Lever/Ashby/Workable/Workday/Amazon Jobs board.
- CV file(s) named in profile.md (.docx, .pdf, or .md; may be more than one version, e.g. a short and a detailed one). **If a file named `<filename>.txt` exists alongside one of these (e.g. `CV.docx.txt` next to `CV.docx`), read that instead of the original** — it's already-extracted plain text, and in a headless/unattended run the Read tool can't open the binary `.docx`/`.pdf` itself. Only fall back to the original file if no `.txt` sidecar exists. Treat all versions as one consistent source of truth: pull whichever level of detail or wording fits the context, but never credit experience that appears in none of them.
- Cover-letter example file(s) named in profile.md, if any (same `.txt`-sidecar-first rule applies). Used only when drafting a letter (see below).

## Steps
1. Read `profile.md`, `roles.json`, `scripts/connectors/employer-boards.json`, **and the CV file(s) named in profile.md** (`.txt` sidecar first, per the Inputs section above). The CV itself — not the "Background" summary in profile.md — is the authoritative record of the user's actual experience: `profile.md`'s Background is only a human-editable convenience summary and can go stale (e.g. after the user uploads a new/updated CV), so fit-scoring in step 7 (for newly found roles) must be checked against the real CV text read here, never against Background alone.
2. For each priority employer listed in `employer-boards.json`, run its connector via Bash and use the stdout JSON directly as candidate roles — do not also WebFetch that employer. Each entry's `connector` field says which of these to run, with args taken from that same entry's other fields:
   - Greenhouse: `node scripts/connectors/greenhouse.mjs <token> "<employer name>"`
   - Lever: `node scripts/connectors/lever.mjs <token> "<employer name>"`
   - Ashby: `node scripts/connectors/ashby.mjs <token> "<employer name>"`
   - Workable: `node scripts/connectors/workable.mjs <token> "<employer name>"`
   - Workday: `node scripts/connectors/workday.mjs <tenant> <wdHost> <site> "<employer name>"`
   - Amazon Jobs: `node scripts/connectors/amazonjobs.mjs <category> "<query>" "<employer name>"`
3. **Required, every run, for every remaining source — do not skip any of these to save time, and do not silently substitute a partial search for a full one:**
   - **Every priority employer with no entry in `employer-boards.json`**: WebFetch that employer's careers URL from `profile.md` directly first. If the page is empty, JS-rendered, or otherwise unreadable, fall back to one targeted WebSearch (e.g. `"<employer name> careers <target role keywords from profile.md>"`). Either way, attempt at least one of these two per employer — an employer with zero attempts this run is a coverage gap, not an acceptable skip.
   - **Every aggregator/job board listed under "Aggregators / job boards" in `profile.md`**: WebFetch its listing/search URL directly (these are already direct job-listing pages, not homepages) — don't substitute a generic WebSearch for a source whose exact listing URL is already known. Some of these (e.g. ReliefWeb, Devex, DevelopmentAid) block automated fetches outright (403) or require JS to render results — when WebFetch fails or comes back empty, fall back to a targeted WebSearch for that aggregator by name plus target role keywords, same as the employer fallback above. Don't drop the source just because the direct fetch failed once.
   - Keep each individual fetch/search lightweight (scan titles/snippets from the listing page or search results; only WebFetch a specific job posting's own page when its title looks like a plausible match worth scoring) so covering dozens of sources stays practical in one run.
   - If a headless run runs low on remaining time/turns before finishing this list, finish the sources already in progress, then stop and note which sources were not reached in `notes` on a placeholder/summary basis — never just quietly stop partway with no record of what was skipped.
4. Dedupe against `roles.json` by `id`. A connector-sourced role keeps its stable id across runs; a WebFetch/WebSearch-sourced role gets `web:<short hash of title|org|url>`. If an id already exists in `roles.json`, this is an **already-seen role** — update only `last_checked` and open/closed status (step 5); do not touch its existing `pay_min`/`pay_max`/`fit_score`/`fit_why`/`fit_gap`, and skip steps 6-7 for it entirely. If an already-seen role's `digest_status` is still `"new"` from a prior headless run, promote it to `"reported"` now — it's had a full run's worth of dashboard visibility since then, so it's no longer new. A role's fit against the user's CV doesn't change run to run, so re-scoring it every day is pure wasted work — this matters a lot in practice, since most open roles stay open for weeks and would otherwise get rescored on every single run. (The one exception: if the user has just uploaded a materially different CV, it's fine to note that in `notes` and let a future explicit request re-score everything — don't try to detect this automatically.)
5. Confirm each new or previously-open role is still accepting applications. Mark roles no longer found as `digest_status: "closed"` in `roles.json` rather than deleting them.
6. For each genuinely NEW role only (no existing `id` in `roles.json` before this run): apply the pay rule from `profile.md` to the TOP of the range. If pay is not stated, estimate from comparable roles and say so in `notes`.
7. For each genuinely NEW role only: score fit 1-10 against experience actually in the profile/CV. Never credit experience the user lacks. Fill in `fit_score`, `fit_why`, `fit_gap`.
8. For each genuinely NEW role only: set `is_roster` based on whether the posting text itself describes a standing/evergreen vacancy or roster-building announcement rather than a single real-time opening (language like "roster", "standing vacancy", "rolling basis", "pool of candidates", "indefinite vacancy announcement") — default `false`. For WebFetch/WebSearch-sourced new roles only (connector-sourced roles already arrive with this field set), also set `employment_type` from what the posting states — default `unspecified` rather than guessing when it isn't clear.
9. A role already in `roles.json` with `digest_status` of `saved` or `reported` is "previously reported"; a brand-new role gets `digest_status: "new"`.

## Reply format (interactive runs only — headless runs produce no chat reply)
1. **New**: up to 10 NEW qualifying roles, ordered by location priority, then fit. Per role: title, org, tag, location, pay (with goal label), posted, deadline, fit, link, one-line Why, one-line Gap.
2. **Your saved roles**: one line each with status; flag closed or deadline within 7 days.
3. **Still open**: previously reported roles scoring 7+ that are still open; flag deadlines within 14 days.
4. One closing line: listings reviewed, sources covered, any boards that could not be read.

## After the run
Write every new/updated role into `roles.json` (merge, don't overwrite the whole file — preserve existing `saved_by_user`/`digest_status` for roles the user has already acted on). For a genuinely new role found **this run**: on an interactive run, set `digest_status` to `"reported"` once it's been included in the chat reply — the reply itself is the viewing. On a **headless** run, leave it as `"new"` instead — there's no chat reply, so the dashboard app's own "New roles" view is the only place it'll ever be shown as new, and that only works if it's still `"new"` when this run's result gets read. It gets promoted to `"reported"` automatically on the *next* run via the already-seen-role dedup step above. `roles.json` is the durable result — if the dashboard app (`app/`) is running, it reads this file live on every request, so no separate regeneration step is needed.

**Always write `digest-run-log.txt` (overwrite each run), interactive or headless** — a headless run produces no chat reply, so this file is the only record of what actually happened and is required for the user to be able to tell a thorough run from a shallow one. Plain text, this exact structure:
```
Run: <ISO timestamp>
Connector employers checked (N): <names>
Priority employers checked via WebFetch/WebSearch (N of TOTAL): <names actually attempted this run>
Priority employers NOT attempted this run, if any: <names, and why — don't just omit them silently>
Aggregators checked (N of TOTAL): <names actually attempted>
Aggregators NOT attempted this run, if any: <names, and why>
New roles found: <count>
Already-seen roles skipped (not rescored): <count>
Roles closed this run: <count>
```
This log is the mechanism that makes "check every priority employer and aggregator every run" (above) auditable rather than a trust-me claim — if a run only has time to attempt a handful of the full employer/aggregator list, that must show up here as a short "checked" count against the real total, not be hidden by only listing what succeeded.

## Drafting a cover letter (only when asked, for a specific role)
This produces a full, usable, properly formatted cover letter ready to send — not a draft blurb.
1. Read the CV file(s) and cover-letter example file(s) named in profile.md, plus the writing rules there (length, font, tone, any line that must never appear).
2. Read `reference/cover-letter-generator.md`, in the `reference/` subfolder right next to this SKILL.md file (same directory — don't search for it, it's bundled with this plugin, not a separately-installed skill) for structure and persuasive-writing technique, and apply it in step 3 below alongside the user's own example letters.
3. Match the voice, tone, sentence length, paragraph count, and overall word count of the user's own example letters — they are the primary source of truth for this person's actual voice, and they override `cover-letter-generator.md` wherever the two conflict (e.g. if the example opens with a direct "I am writing to express my strong interest in..." rather than a rhetorical hook, or runs longer/shorter than the generator's suggested word count, follow the example, not the generator). Use `cover-letter-generator.md` only to fill in structural or persuasive gaps the examples genuinely don't address — never to override a choice the examples already make. Where a section of an example letter already makes a point that genuinely applies to the new role (a strength, an achievement, a framing of a transition), reuse it directly rather than rewriting it from scratch; adapt only what the new role actually requires changing. Before writing, read back through the example letter once and note: its actual word count, paragraph count, and how it opens — match those numbers, don't just gesture at "similar voice."
4. Never invent experience, numbers, or claims not present in the CV file(s).
5. Produce the output as a real Word document using the `docx` skill (not a markdown file, not a text summary) — call the Skill tool with `docx` and follow its instructions to build a properly formatted `.docx`, applying `skills/job-digest/reference/resume-formatter.md`'s general formatting rules (margins, fonts, no markdown syntax left visible) since cover letters share the same ATS/professional-document conventions.
6. Save the `.docx` to `cover-letters/` in the working folder (one file per role, named after the role and organization) and report the saved file path; never send or submit it.

## Tailoring a CV (only when asked, for a specific role)
This produces a full, usable, properly formatted CV — not a short summary blurb. Use it as the actual next CV version for this application, not just a preview.
1. Read the complete CV file(s) named in profile.md and the role's title/org/description from `roles.json`.
2. Read `reference/resume-tailor.md` and `reference/resume-formatter.md`, in the `reference/` subfolder right next to this SKILL.md file (same directory — don't search for them, they're bundled with this plugin, not a separately-installed skill). Apply the first's tailoring strategy in step 3 below and the second's ATS-safe formatting rules in step 5 below.
3. Rewrite the ENTIRE CV, preserving every real section (contact info, summary, full work history with every real employer/title/date range, education, skills, etc.) — nothing is dropped. Within that, reorder and reword for relevance to this specific role per `resume-tailor.md`'s guidance: foreground the experience, achievements, and framing that most directly apply; de-emphasize (but don't delete) what's less relevant. This is a reordering and rewording of real content, never a shortened excerpt.
4. Never invent experience, numbers, titles, dates, or claims not present in the original CV file(s). Every fact must trace back to the real CV.
5. Produce the output as a real Word document using the `docx` skill (not a markdown file, not a text summary) — call the Skill tool with `docx` and follow its instructions to build the file, applying `resume-formatter.md`'s ATS-safe formatting rules (margins, fonts, section order, length-by-seniority, and its DO/DON'T list — no tables/text boxes/columns/images/headers-footers for key info) to how the `docx` skill lays the content out.
6. Save the `.docx` to `cv-tailored/` in the working folder (one file per role, named after the role and organization) and report the saved file path. Never overwrite the user's original uploaded CV file.

## Adding an employer to the priority list (only when asked, by name or screenshot)
1. Resolve the organization to its careers page URL — from the name directly, or by reading an attached screenshot.
2. Check whether it's a Greenhouse (`https://boards-api.greenhouse.io/v1/boards/<token>/jobs`), Lever (`https://api.lever.co/v0/postings/<slug>?mode=json`), or Ashby (`https://api.ashbyhq.com/posting-api/job-board/<org>`) board by testing the likely token/slug. Only add to `scripts/connectors/employer-boards.json` if the request actually succeeds — a guessed token that 404s does not get added.
3. Append the employer (name + careers URL) to the appropriate category under "Priority employers" in `profile.md`, creating a new category if none fits.
