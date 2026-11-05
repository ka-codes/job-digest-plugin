// Shared helpers for board connector scripts.
// Every connector normalizes to this same roles.json shape so the skill
// can treat all sources identically (see docs/DATA-SCHEMA.md).

import { readFileSync } from 'node:fs';

// Keeps a big board (Amazon alone runs ~7,000 open roles) from drowning the
// digest run's turn budget in junior listings it was never going to
// recommend anyway. Seeded from the user's own profile.md "## Target" line,
// expanded through a sector-aware synonym map (title inflation varies a lot
// — a "Director" at one org is a "Team Lead" or "Head of" at another),
// biased toward over-inclusion: missing a real match is worse than a few
// extra getting through to the skill's own screening step.
const TITLE_SYNONYMS = {
  director: ['director', 'managing director', 'executive director', 'regional director', 'country director',
    'vp', 'vice president', 'head of', 'country lead', 'programme lead', 'program lead', 'team lead', 'practice lead'],
  'chief of staff': ['chief of staff', 'cos'],
  'senior manager': ['senior manager', 'sr. manager', 'sr manager', 'lead manager', 'principal',
    'senior programme manager', 'senior program manager'],
};
const EXCLUDE_TITLES = ['intern', 'internship', 'trainee', 'apprentice', 'volunteer'];

function getTargetKeywords(workspaceDir) {
  try {
    const text = readFileSync(`${workspaceDir}/profile.md`, 'utf8');
    const match = text.match(/^## Target\s*\n(.+)$/m);
    if (!match) return [];
    return match[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function expandKeywords(seeds) {
  const expanded = new Set();
  for (const seed of seeds) {
    const synonyms = TITLE_SYNONYMS[seed];
    if (synonyms) synonyms.forEach((s) => expanded.add(s));
    else expanded.add(seed); // no map entry — fall back to the literal seed itself
  }
  return [...expanded];
}

// Drops roles whose title doesn't look senior enough to be worth the skill's
// attention, before the connector even prints its output. Returns the
// unfiltered list if profile.md has no "## Target" line (nothing to filter
// against) or no roles end up matching (fails open, not closed).
export function filterBySeniority(roles, workspaceDir = process.cwd()) {
  const keywords = expandKeywords(getTargetKeywords(workspaceDir));
  if (!keywords.length) return roles;
  const kept = roles.filter((r) => {
    const title = (r.title || '').toLowerCase();
    if (EXCLUDE_TITLES.some((x) => title.includes(x))) return false;
    return keywords.some((k) => title.includes(k));
  });
  return kept.length ? kept : roles;
}

// Normalizes each connector's own vocabulary for employment type into one
// fixed set. Works equally on a structured field value (Ashby's
// "FullTime", Workable's "Full-time", Amazon's "full-time") or a raw text
// blob (title + description, for connectors with no structured field at
// all) — if nothing matches, it fails toward "unspecified" rather than
// guessing, same philosophy as filterBySeniority's fail-open behavior.
const EMPLOYMENT_TYPE_PATTERNS = [
  [/\bintern(s|ship)?\b/i, 'internship'],
  [/\bpart[\s-]?time\b/i, 'part_time'],
  [/\b(contracts?|contractors?|consultants?|consultanc(y|ies)|temporary|temp|fixed[\s-]?term)\b/i, 'contract'],
  [/\bfull[\s-]?time\b/i, 'full_time'],
];

export function normalizeEmploymentType(raw) {
  const text = String(raw || '');
  if (!text) return 'unspecified';
  for (const [re, type] of EMPLOYMENT_TYPE_PATTERNS) {
    if (re.test(text)) return type;
  }
  return 'unspecified';
}

export function makeId(source, orgSlug, externalId) {
  return `${source}:${orgSlug}:${externalId}`;
}

export function normalizeRole(partial) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: partial.id,
    title: partial.title || '',
    org: partial.org || '',
    location: partial.location || '',
    employment_type: partial.employment_type || 'unspecified',
    is_roster: partial.is_roster ?? false,
    pay_min: partial.pay_min ?? null,
    pay_max: partial.pay_max ?? null,
    pay_currency: partial.pay_currency ?? null,
    pay_stated: partial.pay_stated ?? false,
    fit_score: null,
    fit_why: '',
    fit_gap: '',
    source: partial.source,
    source_url: partial.source_url,
    posted_date: partial.posted_date || null,
    deadline: partial.deadline || null,
    first_seen: today,
    last_checked: today,
    digest_status: 'new',
    saved_by_user: false,
    notes: '',
  };
}

// None of Greenhouse/Lever/Ashby reliably expose pay as a clean structured
// field across employers — it's usually free text buried in the job
// description ("Annual Salary: $190,000 — $230,000 USD"). This pulls it out
// well enough to be useful, without over-claiming: only extracts a range
// found near an actual pay-related phrase (never a bare "$25 billion
// commitment" elsewhere in the text), and only within a sane salary bound.
const PAY_KEYWORDS = /salary|compensation|pay range|annual pay|base pay/i;
const PAY_RANGE_RE = /\$\s?([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:-|–|—|to)\s*\$?\s?([\d,]+(?:\.\d+)?)\s*(k)?/i;

function decodeEntities(str) {
  let out = str;
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–');
  }
  return out;
}

export function stripHtml(html) {
  return decodeEntities(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOT_STATED = { pay_min: null, pay_max: null, pay_currency: null, pay_stated: false };

function rangeMatchToPayFields(rangeMatch) {
  if (!rangeMatch) return NOT_STATED;
  const toNumber = (numStr, kFlag) => {
    let n = Number.parseFloat(numStr.replace(/,/g, ''));
    if (kFlag) n *= 1000;
    return n;
  };
  const min = toNumber(rangeMatch[1], rangeMatch[2]);
  const max = toNumber(rangeMatch[3], rangeMatch[4]);
  // Sanity bound: reject anything that isn't plausibly an annual salary
  // (filters out equity/funding figures like "$25 billion commitment").
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min || max > 5_000_000) {
    return NOT_STATED;
  }
  const currency = /USD|US\$|\$/.test(rangeMatch[0]) ? 'USD' : null;
  return { pay_min: Math.round(min), pay_max: Math.round(max), pay_currency: currency, pay_stated: true };
}

// For text already known to be about compensation (e.g. Ashby's dedicated
// compensationTierSummary field) — same range parsing, no keyword search.
export function extractPayRangeDirect(rawText) {
  return rangeMatchToPayFields(PAY_RANGE_RE.exec(stripHtml(rawText)));
}

export function extractPayFromText(rawText) {
  const text = stripHtml(rawText);
  // A job description often mentions "compensation"/"salary" more than once
  // (a boilerplate disclaimer first, the actual "Salary: $X — $Y" later) —
  // the real figure can be well past the first match, so check every
  // occurrence until one has a dollar range nearby, not just the first.
  const keywordRe = new RegExp(PAY_KEYWORDS.source, 'gi');
  let keywordMatch;
  while ((keywordMatch = keywordRe.exec(text))) {
    const window = text.slice(Math.max(0, keywordMatch.index - 30), keywordMatch.index + 250);
    const result = rangeMatchToPayFields(PAY_RANGE_RE.exec(window));
    if (result.pay_stated) return result;
  }
  return NOT_STATED;
}

export function printJSON(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
