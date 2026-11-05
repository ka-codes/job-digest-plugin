#!/usr/bin/env node
// Fetches open roles from a public Ashby job board and normalizes them to
// the roles.json shape. Fit scoring is left to the model — this script
// only does the deterministic fetch + normalize.
//
// Usage: node ashby.mjs <org-slug> [employer-display-name]
// Example: node ashby.mjs openai-foundation "OpenAI Foundation"

import { normalizeRole, makeId, printJSON, fail, extractPayRangeDirect, extractPayFromText, filterBySeniority, normalizeEmploymentType } from './common.mjs';

const [, , orgSlug, employerName] = process.argv;
if (!orgSlug) fail('Usage: node ashby.mjs <org-slug> [employer-display-name]');

// includeCompensation surfaces the structured field for employers that fill
// it in; most don't (shouldDisplayCompensationOnJobPostings is often false),
// so the description-text fallback below still matters.
const url = `https://api.ashbyhq.com/posting-api/job-board/${orgSlug}?includeCompensation=true`;

let res;
try {
  res = await fetch(url);
} catch (err) {
  fail(`Could not reach Ashby for board "${orgSlug}": ${err.message}`);
}
if (!res.ok) fail(`Ashby API returned ${res.status} for board "${orgSlug}"`);

const data = await res.json();
const org = employerName || orgSlug;

const roles = (data.jobs || []).map((job) => {
  const summary = job.compensation?.compensationTierSummary;
  const payFields = summary ? extractPayRangeDirect(summary) : extractPayFromText(job.descriptionPlain);

  return normalizeRole({
    id: makeId('ashby', orgSlug, job.id),
    title: job.title,
    org,
    location: job.location || '',
    source: 'ashby',
    source_url: job.jobUrl || job.applyUrl || '',
    posted_date: job.publishedAt ? job.publishedAt.slice(0, 10) : null,
    employment_type: normalizeEmploymentType(job.employmentType),
    ...payFields,
  });
});

printJSON(filterBySeniority(roles));
