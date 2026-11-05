#!/usr/bin/env node
// Fetches open roles from a public Lever postings board and normalizes them
// to the roles.json shape. Fit scoring is left to the model — this script
// only does the deterministic fetch + normalize.
//
// Usage: node lever.mjs <company-slug> [employer-display-name]
// Example: node lever.mjs netflix "Netflix"

import { normalizeRole, makeId, printJSON, fail, extractPayFromText, filterBySeniority, normalizeEmploymentType } from './common.mjs';

const [, , slug, employerName] = process.argv;
if (!slug) fail('Usage: node lever.mjs <company-slug> [employer-display-name]');

const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

let res;
try {
  res = await fetch(url);
} catch (err) {
  fail(`Could not reach Lever for company "${slug}": ${err.message}`);
}
if (!res.ok) fail(`Lever API returned ${res.status} for company "${slug}"`);

const postings = await res.json();
const org = employerName || slug;

const roles = postings.map((p) => {
  // Lever's structured salaryRange field (when a company fills it in) is
  // the real source of truth; free-text description is the fallback.
  let payFields;
  if (p.salaryRange && (p.salaryRange.min || p.salaryRange.max)) {
    payFields = {
      pay_min: p.salaryRange.min ?? null,
      pay_max: p.salaryRange.max ?? null,
      pay_currency: p.salaryRange.currency || 'USD',
      pay_stated: true,
    };
  } else {
    const text = [p.descriptionPlain, p.additionalPlain, ...(p.lists || []).map((l) => l.content)].join(' ');
    payFields = extractPayFromText(text);
  }

  return normalizeRole({
    id: makeId('lever', slug, p.id),
    title: p.text,
    org,
    location: p.categories?.location || '',
    source: 'lever',
    source_url: p.hostedUrl,
    posted_date: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : null,
    employment_type: normalizeEmploymentType(p.categories?.commitment),
    ...payFields,
  });
});

printJSON(filterBySeniority(roles));
