#!/usr/bin/env node
// One-time migration: legacy job-log.md -> roles.json.
// Runs only if roles.json is absent and job-log.md exists in the target folder.
// "Saved roles" / "Digest-found roles" are strict pipe-delimited rows and are
// parsed into structured records. "Checked and closed" / "Checked, not
// qualifying" are free-form narrative in the legacy format, not row data —
// they are preserved verbatim under a "Legacy history" section instead of
// being force-parsed into fields that don't fit them.
//
// Usage: node migrate-job-log.mjs <workspace-folder>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const folder = process.argv[2] || process.cwd();
const jobLogPath = join(folder, 'job-log.md');
const rolesPath = join(folder, 'roles.json');

if (existsSync(rolesPath)) {
  console.log('roles.json already exists — nothing to migrate.');
  process.exit(0);
}
if (!existsSync(jobLogPath)) {
  console.log('No job-log.md found — nothing to migrate, starting fresh.');
  writeFileSync(rolesPath, '[]\n');
  process.exit(0);
}

const text = readFileSync(jobLogPath, 'utf8');

// Split into sections by "## heading" lines.
const sectionRe = /^##\s+(.+)$/gm;
const sections = [];
let match;
let lastIndex = 0;
let lastTitle = null;
while ((match = sectionRe.exec(text)) !== null) {
  if (lastTitle !== null) {
    sections.push({ title: lastTitle, body: text.slice(lastIndex, match.index).trim() });
  }
  lastTitle = match[1].trim();
  lastIndex = sectionRe.lastIndex;
}
if (lastTitle !== null) {
  sections.push({ title: lastTitle, body: text.slice(lastIndex).trim() });
}

// Matches by keyword, not exact text — real job-log.md headings vary a lot
// (users rename them, add parentheticals like "(do not re-report unless
// reposted)"). All keywords must appear, case-insensitive, substring match.
function findSection(...keywords) {
  const s = sections.find((s) =>
    keywords.every((k) => s.title.toLowerCase().includes(k.toLowerCase()))
  );
  return s ? s.body : '';
}

function makeWebId(title, org, url) {
  const hash = createHash('sha1').update(`${title}|${org}|${url}`).digest('hex').slice(0, 12);
  return `web:${hash}`;
}

function parseRows(body, digestStatus) {
  const roles = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') && !trimmed.includes('|')) continue;
    const cells = trimmed.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 6) continue; // not a real data row
    const [date, title, org, location, pay, fit, link, status] = cells;
    if (!title || title.toLowerCase() === 'title' || title.toLowerCase().includes('format')) continue; // header/format rows
    const fitScore = Number.parseInt(fit, 10);
    roles.push({
      id: makeWebId(title, org, link || ''),
      title,
      org: org || '',
      location: location || '',
      pay_min: null,
      pay_max: null,
      pay_currency: null,
      pay_stated: false,
      fit_score: Number.isFinite(fitScore) ? fitScore : null,
      fit_why: '',
      fit_gap: '',
      source: 'migrated',
      source_url: link || null,
      posted_date: null,
      deadline: null,
      first_seen: date || null,
      last_checked: date || null,
      digest_status: digestStatus,
      saved_by_user: digestStatus === 'saved',
      notes: [pay, status].filter(Boolean).join(' · '),
    });
  }
  return roles;
}

const savedRoles = parseRows(findSection('saved'), 'saved');
const reportedRoles = parseRows(findSection('digest-found') || findSection('digest found'), 'reported');
const allRoles = [...savedRoles, ...reportedRoles];

writeFileSync(rolesPath, JSON.stringify(allRoles, null, 2) + '\n');

const legacyClosed = findSection('checked', 'closed');
const legacyNotQualifying = findSection('checked', 'qualifying');

const legacyBlock = [
  '## Legacy history (pre-migration, unstructured)',
  '',
  'Preserved as-is from the old job-log.md. New entries from here on are written structurally into roles.json instead.',
  '',
  '### Checked and closed',
  legacyClosed || '(none)',
  '',
  '### Checked, not qualifying',
  legacyNotQualifying || '(none)',
].join('\n');

const newJobLog = [
  '# Job log',
  '',
  'Generated from roles.json — do not hand-edit, changes will be overwritten on the next run.',
  '',
  legacyBlock,
].join('\n');

writeFileSync(jobLogPath, newJobLog + '\n');

console.log(
  `Migrated ${savedRoles.length} saved + ${reportedRoles.length} reported roles into roles.json. ` +
  `Legacy narrative sections preserved in job-log.md.`
);
