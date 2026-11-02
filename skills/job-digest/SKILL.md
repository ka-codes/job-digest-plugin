---
name: job-digest
description: Search for currently open roles that match the user's profile.md, score each 1-10 against their real experience, avoid repeats using job-log.md, and return a scannable digest. Use when the user asks for a job digest, job search, or to check saved roles.
---

# Job digest

Never apply, contact anyone, create accounts, log in, or bypass paywalls. Drafting cover letters for the user to send is fine.

## Inputs (in the user's working folder)
- `profile.md`: background, target roles and levels, priority employers, locations in priority order, pay floor and goal, exclusions. Copy from `templates/profile.example.md` if missing and ask the user to fill it in.
- `job-log.md`: saved roles, previously reported roles, closed roles, checked-not-qualifying. Create from `templates/job-log.md` if missing.

## Steps
1. Read profile.md and job-log.md.
2. Check every priority employer's own board first, then aggregators and general web search. Prefer public job-board endpoints (Greenhouse, Lever, Ashby, Workday) over scraping HTML.
3. Confirm each role is still accepting applications. Skip closed or past-deadline roles.
4. Apply the pay rule from profile.md to the TOP of the range. If pay is not stated, estimate from comparable roles and say so.
5. Score fit 1-10 against experience actually in the profile. Never credit experience the user lacks.
6. A role in the saved, reported or closed sections of the log is "previously reported"; everything else is NEW.

## Reply format
1. **New**: up to 10 NEW qualifying roles, ordered by location priority, then fit. Per role: title, org, tag, location, pay (with goal label), posted, deadline, fit, link, one-line Why, one-line Gap.
2. **Your saved roles**: one line each with status; flag closed or deadline within 7 days.
3. **Still open**: previously reported roles scoring 7+ that are still open; flag deadlines within 14 days.
4. One closing line: listings reviewed, sources covered, any boards that could not be read.

## After the run
Append NEW qualifying roles to job-log.md (date | title | org | location | pay | fit | link | status), mark closed roles, keep all other sections intact.
