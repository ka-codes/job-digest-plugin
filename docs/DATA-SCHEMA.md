# Data schema

Lives in the user's private working folder (never in this repo). Source of truth for the skill, the connectors, and the app — all three read/write the same two files.

## roles.json

Array of role records.

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

- `id`: `source:org-slug:external-id` for connector-sourced roles (stable across runs, used for dedupe); `web:<hash of title|org|url>` for WebFetch/WebSearch-sourced roles with no native id.
- `digest_status`: `new | saved | reported | closed | not_qualifying`.
- `employment_type`: `full_time | part_time | contract | internship | unspecified`. Populated from each connector's own structured field when one exists (Ashby, Workable, Lever, Amazon); connectors without one (Greenhouse, Workday) guess from the job title only — full-description scanning was tried and produced too many false positives (a duty that merely *mentions* "contractors" isn't the role's own employment type), so title-only is the deliberate tradeoff. For WebFetch/WebSearch-sourced roles, the skill captures it from the posting text when stated. Defaults to `unspecified` rather than guessing when nothing clearly indicates a type.
- `is_roster`: `true` when the posting is a standing/evergreen vacancy or roster-building announcement rather than a single real-time opening (common at UN agencies and large INGOs) — set by the skill based on posting-text language ("roster", "standing vacancy", "rolling basis", "pool of candidates"). Orthogonal to `digest_status`: a rostered role can still become `closed` if it's no longer listed at all.
- `fit_score`/`fit_why`/`fit_gap`: null/empty until the model scores it — connector scripts never fill these in, only the skill does.

## applications.json

Array of application records, referencing `roles.json` by id — no duplication of role fields.

```json
{
  "id": "app_2026-10-27_001",
  "role_id": "greenhouse:anthropic:5456619008",
  "status": "not_applied",
  "applied_date": null,
  "status_date": "2026-10-30",
  "next_step": "",
  "next_step_date": null,
  "cv_version_used": null,
  "cover_letter_file": null,
  "history": [{ "date": "2026-10-30", "status": "not_applied", "note": "saved" }]
}
```

- `status`: `not_applied | applied | interviewing | offer | rejected | withdrawn`.
- `history`: append-only log of status changes, oldest first.

## settings.json

Written by the app's setup wizard, read by its internal scheduler.

```json
{
  "frequency": "daily",
  "time_of_day": "06:00",
  "last_run": "2026-11-02T06:00:00Z"
}
```
