#!/usr/bin/env node
// Fetches open roles from a public Greenhouse job board and normalizes them
// to the roles.json shape. Fit scoring is left to the model — this script
// only does the deterministic fetch + normalize.
//
// Usage: node greenhouse.mjs <board-token> [employer-display-name]
// Example: node greenhouse.mjs anthropic "Anthropic"

import { normalizeRole, makeId, printJSON, fail, extractPayFromText, filterBySeniority, normalizeEmploymentType } from './common.mjs';

const [, , boardToken, employerName] = process.argv;
if (!boardToken) fail('Usage: node greenhouse.mjs <board-token> [employer-display-name]');

const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;

let res;
try {
  res = await fetch(url);
} catch (err) {
  fail(`Could not reach Greenhouse for board "${boardToken}": ${err.message}`);
}
if (!res.ok) fail(`Greenhouse API returned ${res.status} for board "${boardToken}"`);

const data = await res.json();
const org = employerName || boardToken;

const roles = (data.jobs || []).map((job) =>
  normalizeRole({
    id: makeId('greenhouse', boardToken, job.id),
    title: job.title,
    org,
    location: job.location?.name || '',
    source: 'greenhouse',
    source_url: job.absolute_url,
    posted_date: (job.updated_at || job.created_at || '').slice(0, 10) || null,
    // Greenhouse has no structured employment-type field. Scanning the full
    // description text produced a high false-positive rate (duties that
    // merely *mention* "contractors"/"consultants" aren't the role's own
    // employment type) — the title alone is a much smaller, cleaner signal:
    // most titles say nothing, which correctly falls through to
    // "unspecified" rather than guessing wrong.
    employment_type: normalizeEmploymentType(job.title),
    ...extractPayFromText(job.content),
  })
);

printJSON(filterBySeniority(roles));
