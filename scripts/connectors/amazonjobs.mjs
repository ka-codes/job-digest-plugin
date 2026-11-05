#!/usr/bin/env node
// Fetches open roles from Amazon's public jobs search API and normalizes
// them to the roles.json shape. Covers AWS (and in principle any other
// Amazon business category) — not a named ATS vendor, but amazon.jobs
// exposes the same search its own site uses as a plain, unauthenticated
// JSON endpoint.
//
// Unlike the single-token connectors (Greenhouse/Lever/Ashby/Workable),
// this one REQUIRES a search query: Amazon's full job board runs into the
// tens of thousands of postings (AWS alone is ~7,000), far beyond what's
// practical to pull and score in one run. `baseQuery` narrows the board-side
// search itself (same idea as the preview route's downstream keyword
// filter, just applied earlier because the raw volume here makes that
// filter impractical to run after the fact).
//
// Usage: node amazonjobs.mjs <business-category-slug> <base-query> [employer-display-name]
// Example: node amazonjobs.mjs amazon-web-services "public policy" "Amazon Web Services (AWS)"

import { normalizeRole, makeId, printJSON, fail, extractPayFromText, filterBySeniority, normalizeEmploymentType } from './common.mjs';

const [, , category, baseQuery, employerName] = process.argv;
if (!category || !baseQuery) {
  fail('Usage: node amazonjobs.mjs <business-category-slug> <base-query> [employer-display-name]');
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5; // 500 roles is already far more than any one run should score

function parsePostedDate(text) {
  // Amazon's API returns dates like "October 30, 2026" — normalizeRole wants
  // the same YYYY-MM-DD shape every other connector uses.
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchPage(offset) {
  const url = `https://www.amazon.jobs/en/search.json?offset=${offset}&result_limit=${PAGE_SIZE}&sort=recent&business_category%5B%5D=${encodeURIComponent(category)}&base_query=${encodeURIComponent(baseQuery)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    fail(`Could not reach amazon.jobs: ${err.message}`);
  }
  if (!res.ok) fail(`amazon.jobs returned ${res.status} for category "${category}"`);
  return res.json();
}

const org = employerName || 'Amazon';
const first = await fetchPage(0);
let allJobs = first.jobs || [];
const totalHits = first.hits || allJobs.length;

for (let page = 1; page < MAX_PAGES && page * PAGE_SIZE < totalHits; page++) {
  const next = await fetchPage(page * PAGE_SIZE);
  allJobs = allJobs.concat(next.jobs || []);
}

const roles = allJobs.map((job) =>
  normalizeRole({
    id: makeId('amazonjobs', category, job.id_icims || job.id),
    title: (job.title || '').trim(),
    org,
    location: job.normalized_location || job.location || '',
    source: 'amazonjobs',
    source_url: job.job_path ? `https://www.amazon.jobs${job.job_path}` : null,
    posted_date: parsePostedDate(job.posted_date),
    employment_type: normalizeEmploymentType(job.job_schedule_type),
    ...extractPayFromText(job.description || ''),
  })
);

printJSON(filterBySeniority(roles));
