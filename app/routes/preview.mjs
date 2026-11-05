import { Router } from 'express';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectorsDir = join(__dirname, '..', '..', 'scripts', 'connectors');
const employerBoardsPath = join(connectorsDir, 'employer-boards.json');

const router = Router();

// With no CV yet, there's nothing to score fit against — but a connector's
// full board (e.g. Anthropic's ~600 openings) is mostly sales/engineering
// noise unrelated to international development. A keyword filter is a crude
// stand-in for fit scoring, not a replacement for it: good enough to make
// this preview honestly useful rather than a wall of irrelevant listings.
const RELEVANCE_KEYWORDS = [
  'polic', 'global affairs', 'international development', 'ai governance',
  'global governance', 'social impact', 'societal impact', 'nonprofit', 'non-profit', 'ngo',
  'humanitarian', 'philanthrop', 'diplomat', 'foreign affairs',
  'government affairs', 'responsible ai', 'ai safety', 'ai for good',
  'civil society', 'human rights', 'civic', 'advocacy', 'public interest',
  'program director', 'program officer', 'grants', 'grant operations',
];

function isLikelyRelevant(role) {
  const text = `${role.title} `.toLowerCase();
  return RELEVANCE_KEYWORDS.some((kw) => text.includes(kw));
}

function runConnector(connector, entry, employerName) {
  return new Promise((resolve) => {
    const script = join(connectorsDir, `${connector}.mjs`);
    // Workday needs three positional args (tenant/wdHost/site), and
    // amazonjobs needs a category + search query, instead of the single
    // token/slug every other connector takes — see those scripts' header
    // comments for why.
    let args;
    if (connector === 'workday') {
      args = [script, entry.tenant, entry.wdHost, entry.site, employerName];
    } else if (connector === 'amazonjobs') {
      args = [script, entry.category, entry.query, employerName];
    } else {
      args = [script, entry.token, employerName];
    }
    execFile('node', args, { timeout: 15000 }, (err, stdout) => {
      if (err) {
        resolve([]); // one employer's board being unreachable shouldn't break the whole preview
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve([]);
      }
    });
  });
}

// No workspace/profile needed — a quick live look at roles from employers
// with real Greenhouse/Lever board integrations, before anyone sets up a
// profile. No fit scoring (there's no CV yet); just what's actually open.
router.get('/preview/roles', async (_req, res) => {
  let employerBoards;
  try {
    employerBoards = JSON.parse(readFileSync(employerBoardsPath, 'utf8'));
  } catch {
    return res.json({ roles: [], note: 'No employer board list found.' });
  }

  const entries = Object.entries(employerBoards).filter(([key]) => !key.startsWith('_'));
  const results = await Promise.all(
    entries.map(([name, entry]) => runConnector(entry.connector, entry, name))
  );

  const allRoles = results.flat();
  const roles = allRoles
    .filter(isLikelyRelevant)
    .sort((a, b) => (b.posted_date || '').localeCompare(a.posted_date || ''))
    .slice(0, 20);

  res.json({
    roles,
    employerCount: entries.length,
    totalOpenRoles: allRoles.length,
    note: 'Keyword-filtered, not fit-scored — set up your profile for real matching against your CV.',
  });
});

export default router;
