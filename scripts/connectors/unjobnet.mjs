#!/usr/bin/env node
// Fetches open roles from UN Jobnet's public listing pages (server-rendered
// HTML, no login or API key) and normalizes them to the roles.json shape.
// Fit scoring is left to the model. Identifies itself honestly and pauses
// between page requests.
//
// Usage: node unjobnet.mjs [--pages N] [--level "<level name>"]
// Example: node unjobnet.mjs --pages 5 --level "Director and Top Executive"
// Default is 5 pages (~20 roles each), newest first.

import { normalizeRole, makeId, printJSON, fail, stripHtml, filterBySeniority } from './common.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pages = Math.min(Math.max(Number.parseInt(flag('--pages') || '5', 10) || 5, 1), 15);
const level = flag('--level');

const UA = 'job-digest-plugin/0.1 (personal job search tool)';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseDeadline(text) {
  const m = /Closes\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function parsePage(html) {
  const blocks = html.split('p-3 job"').slice(1);
  const roles = [];
  for (const block of blocks) {
    const titleMatch = /<a class="py-2 link-primary fw-bold" href="(\/jobs\/detail\/([^"]+?)-(\d+))"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!titleMatch) continue;
    const orgMatch = /href="\/organizations\/([^"]+)"/.exec(block);
    const org = orgMatch ? decodeURIComponent(orgMatch[1]).replace(/-/g, ' ') : '';
    const cityMatch = /href="\/countries\/[^"\/]+\/[^"]+">([^<]+)<\/a>\s*\(<a[^>]*>([^<]+)<\/a>/.exec(block);
    const countryOnly = /href="\/countries\/[^"\/]+">([^<]+)<\/a>/.exec(block);
    const location = cityMatch ? `${stripHtml(cityMatch[1])}, ${stripHtml(cityMatch[2])}` : stripHtml(countryOnly?.[1] || '');
    const grade = /<span class="me-3">([^<]+)<\/span>/.exec(block)?.[1]?.trim() || '';
    roles.push(normalizeRole({
      id: makeId('unjobnet', 'all', titleMatch[3]),
      title: stripHtml(titleMatch[4]),
      org,
      location,
      employment_type: grade === 'CON' ? 'contract' : 'unspecified',
      source: 'unjobnet',
      source_url: `https://www.unjobnet.org${titleMatch[1]}`,
      deadline: parseDeadline(stripHtml(block)),
    }));
  }
  return roles;
}

const seen = new Map();
for (let page = 1; page <= pages; page++) {
  const qs = new URLSearchParams();
  if (level) qs.append('levels[]', level);
  if (page > 1) qs.set('page', String(page));
  const url = `https://www.unjobnet.org/jobs${qs.toString() ? `?${qs}` : ''}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  } catch (err) {
    if (page === 1) fail(`Could not reach UN Jobnet: ${err.message}`);
    break;
  }
  if (!res.ok) {
    if (page === 1) fail(`UN Jobnet returned ${res.status}`);
    break;
  }
  const found = parsePage(await res.text());
  if (!found.length) break;
  for (const r of found) seen.set(r.id, r);
  if (page < pages) await new Promise((r) => setTimeout(r, 1500));
}

printJSON(filterBySeniority([...seen.values()]));
