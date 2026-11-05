#!/usr/bin/env node
// Fetches open roles from a public Workday job board (CXS API) and
// normalizes them to the roles.json shape. Fit scoring is left to the
// model — this script only does the deterministic fetch + normalize.
//
// Unlike Greenhouse/Lever/Ashby, Workday has no single consistent slug: the
// public URL for a careers site looks like
//   https://{tenant}.{wdHost}.myworkdayjobs.com/{site}
// where {wdHost} is a per-tenant shard (wd1, wd3, wd5, ...) and {site} is a
// per-tenant career-site name (often the tenant name, "External", "Careers",
// etc. — no fixed convention). All three parts have to be confirmed live
// per employer (e.g. by finding the site's own careers-page link, or a
// search engine hit on "{tenant}.wdN.myworkdayjobs.com") before adding an
// entry to employer-boards.json.
//
// Usage: node workday.mjs <tenant> <wd-host> <site> [employer-display-name]
// Example: node workday.mjs imf wd5 IMF "IMF"
//
// Hits: POST https://{tenant}.{wdHost}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
// Paginates in pages of 20 (Workday's default/observed page size) until all
// postings are fetched.

import { normalizeRole, makeId, printJSON, fail, extractPayFromText, filterBySeniority, normalizeEmploymentType } from './common.mjs';

const [, , tenant, wdHost, site, employerName] = process.argv;
if (!tenant || !wdHost || !site) {
  fail('Usage: node workday.mjs <tenant> <wd-host> <site> [employer-display-name]');
}

const base = `https://${tenant}.${wdHost}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
const org = employerName || tenant;
const PAGE_SIZE = 20;

async function fetchPage(offset) {
  let res;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: PAGE_SIZE, offset, searchText: '' }),
    });
  } catch (err) {
    fail(`Could not reach Workday for tenant "${tenant}" site "${site}": ${err.message}`);
  }
  if (!res.ok) fail(`Workday API returned ${res.status} for tenant "${tenant}" site "${site}" (check wd-host/site)`);
  return res.json();
}

const first = await fetchPage(0);
let postings = first.jobPostings || [];
const total = first.total || postings.length;
for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
  const page = await fetchPage(offset);
  postings = postings.concat(page.jobPostings || []);
}

const roles = postings.map((job) => {
  const bullets = (job.bulletFields || []).join(' ');
  return normalizeRole({
    id: makeId('workday', tenant, job.externalPath || job.title),
    title: job.title,
    org,
    location: job.locationsText || '',
    source: 'workday',
    source_url: `https://${tenant}.${wdHost}.myworkdayjobs.com/${site}${job.externalPath || ''}`,
    posted_date: null, // Workday only gives a relative string ("Posted 30+ Days Ago"), not a real date
    // No structured employment-type field in the list endpoint. Scanning the
    // bullet/description text produced false positives (duties that merely
    // *mention* "contractors" aren't the role's own employment type) — the
    // title alone is a much cleaner signal, same fix as Greenhouse's.
    employment_type: normalizeEmploymentType(job.title),
    ...extractPayFromText(bullets),
  });
});

printJSON(filterBySeniority(roles));
