// Reads/writes sections of the user's profile.md from the wizard's steps.
// profile.md itself stays the same human-readable format the skill already
// reads — the wizard just fills it in instead of the user hand-editing it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'profile.example.md');

function profilePath(workspaceDir) {
  return join(workspaceDir, 'profile.md');
}

export function ensureProfileMd(workspaceDir) {
  const p = profilePath(workspaceDir);
  if (!existsSync(p)) {
    writeFileSync(p, readFileSync(TEMPLATE_PATH, 'utf8'));
  }
  return p;
}

export function readProfileMd(workspaceDir) {
  ensureProfileMd(workspaceDir);
  return readFileSync(profilePath(workspaceDir), 'utf8');
}

// Extracts a section's body straight from the shipped template (not a user's
// workspace) — used to prefill the wizard, e.g. the sector-default employer list.
export function getTemplateSection(headingStartsWith) {
  const text = readFileSync(TEMPLATE_PATH, 'utf8');
  const lines = text.split('\n');
  const needle = headingStartsWith.toLowerCase();
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      if (start === -1 && lines[i].slice(3).trim().toLowerCase().startsWith(needle)) {
        start = i;
        continue;
      }
      if (start !== -1 && i > start) {
        end = i;
        break;
      }
    }
  }
  if (start === -1) return '';
  return lines.slice(start + 1, end).join('\n').trim();
}

// Parses the "Reference documents" section of a user's profile.md into
// { cvFiles: [...], letterFiles: [...] } — the one place both the setup
// wizard and the CV & Letters screen read/write this from.
export function getReferenceDocuments(workspaceDir) {
  const text = readProfileMd(workspaceDir);
  const lines = text.split('\n');
  const result = { cvFiles: [], letterFiles: [] };
  for (const line of lines) {
    const cvMatch = line.match(/^-\s*CV:\s*(.+)$/i);
    const letterMatch = line.match(/^-\s*Cover-letter.*:\s*(.+)$/i);
    if (cvMatch) result.cvFiles = cvMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (letterMatch) result.letterFiles = letterMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return result;
}

// Same section-finder as getTemplateSection, but against a user's own live
// profile.md — used to pre-fill the Profile & Preferences screen with
// current values rather than a blank form.
export function getProfileSection(workspaceDir, headingStartsWith) {
  const text = readProfileMd(workspaceDir);
  const lines = text.split('\n');
  const needle = headingStartsWith.toLowerCase();
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      if (start === -1 && lines[i].slice(3).trim().toLowerCase().startsWith(needle)) {
        start = i;
        continue;
      }
      if (start !== -1 && i > start) {
        end = i;
        break;
      }
    }
  }
  if (start === -1) return '';
  return lines.slice(start + 1, end).join('\n').trim();
}

// Rolls profile.md's "## Priority employers" subheadings (one per employer
// category, e.g. "### Bilateral development agencies") up into the three
// broad groups the Job digest view filters by, and maps each listed
// employer name (plus common aliases split out of "A / B" and "Name
// (ABBR)" bullet forms) to its group, lowercased for case-insensitive
// lookup. Employers found via aggregators but not on this curated list
// aren't included here — the caller buckets those as "Other".
const EMPLOYER_GROUPS = ['Multilaterals & bilaterals', 'INGOs & foundations', 'Tech'];

// Returns null for a heading that doesn't clearly belong to one of the three
// groups (e.g. a new category someone adds later via "Add an employer" that
// doesn't fit any of them, like "Think tanks & policy research") — callers
// skip those employers rather than mislabeling them, so they fall through
// to the frontend's own "Other" bucket instead.
function groupForHeading(heading) {
  const h = heading.toLowerCase();
  if (h.includes('multilateral') || h.includes('bilateral')) return EMPLOYER_GROUPS[0];
  if (h.includes('ingo') || h.includes('humanitarian') || h.includes('foundation') || h.includes('philanthropy')) return EMPLOYER_GROUPS[1];
  if (h.includes('ai for good') || h.includes('tech')) return EMPLOYER_GROUPS[2];
  return null;
}

export function getEmployerGroups(workspaceDir) {
  const text = readProfileMd(workspaceDir);
  const lines = text.split('\n');
  const orgToGroup = {};

  let inSection = false;
  let currentGroup = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      inSection = line.slice(3).trim().toLowerCase().startsWith('priority employers');
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith('### ')) {
      currentGroup = groupForHeading(line.slice(4).trim());
      continue;
    }
    const bulletMatch = line.match(/^-\s*(.+?)\s+—\s+\S+/);
    if (!bulletMatch || !currentGroup) continue;
    let name = bulletMatch[1].trim();
    const aliases = new Set();
    const parenMatch = name.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (parenMatch) {
      aliases.add(parenMatch[1].trim());
      aliases.add(parenMatch[2].trim());
    } else {
      aliases.add(name);
    }
    name.split('/').forEach((part) => aliases.add(part.trim()));
    for (const alias of aliases) {
      if (alias) orgToGroup[alias.toLowerCase()] = currentGroup;
    }
  }
  return orgToGroup;
}

// Replaces the body of the first "## <heading...>" section whose heading
// starts with `headingStartsWith` (case-insensitive). Appends a new section
// at the end if no match is found. Body should not include the heading line.
export function replaceSection(workspaceDir, headingStartsWith, newBody) {
  const text = readProfileMd(workspaceDir);
  const lines = text.split('\n');
  const needle = headingStartsWith.toLowerCase();

  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      if (start === -1 && lines[i].slice(3).trim().toLowerCase().startsWith(needle)) {
        start = i;
        continue;
      }
      if (start !== -1 && i > start) {
        end = i;
        break;
      }
    }
  }

  let next;
  if (start === -1) {
    next = `${text.trimEnd()}\n\n## ${headingStartsWith}\n${newBody.trim()}\n`;
  } else {
    const before = lines.slice(0, start + 1).join('\n');
    const after = lines.slice(end).join('\n');
    next = `${before}\n${newBody.trim()}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
  }

  writeFileSync(profilePath(workspaceDir), next);
}
