#!/usr/bin/env node
// Fetches open roles from a public Workable job board widget and
// normalizes them to the roles.json shape. Fit scoring is left to the
// model — this script only does the deterministic fetch + normalize.
//
// Usage: node workable.mjs <account-subdomain> [employer-display-name]
// Example: node workable.mjs huggingface "Hugging Face"

import { normalizeRole, makeId, printJSON, fail, extractPayFromText, filterBySeniority, normalizeEmploymentType } from './common.mjs';

const [, , account, employerName] = process.argv;
if (!account) fail('Usage: node workable.mjs <account-subdomain> [employer-display-name]');

const url = `https://apply.workable.com/api/v1/widget/accounts/${account}`;

let res;
try {
  res = await fetch(url);
} catch (err) {
  fail(`Could not reach Workable for account "${account}": ${err.message}`);
}
if (!res.ok) fail(`Workable API returned ${res.status} for account "${account}"`);

const data = await res.json();
const org = employerName || data.name || account;

const roles = (data.jobs || []).map((job) => {
  const location = [job.city, job.state, job.country].filter(Boolean).join(', ') || (job.telecommuting ? 'Remote' : '');
  return normalizeRole({
    id: makeId('workable', account, job.shortcode),
    title: job.title,
    org,
    location,
    source: 'workable',
    source_url: job.shortlink || job.url,
    posted_date: job.published_on || job.created_at || null,
    employment_type: normalizeEmploymentType(job.employment_type),
    ...extractPayFromText([job.title, job.department, job.function].join(' ')),
  });
});

printJSON(filterBySeniority(roles));
