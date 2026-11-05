// The app's internal clock. As long as the server process is running, this
// checks every few minutes whether a digest run is due, per settings.json,
// and fires one headlessly. No OS-level cron/Task Scheduler entry needed —
// just this process staying alive (see docs/SETUP-APP.md for start-at-login).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSettings, setSettings } from './store.mjs';
import { runClaudeHeadless, PLUGIN_DIR } from './claude.mjs';
import { getWorkspaceDir, readConfig } from './config.mjs';

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // check every 2 minutes
const FREQUENCY_HOURS = { daily: 24, 'every-3-days': 72, weekly: 168 };

let timer = null;
let running = false;
let runStartedAt = null;

function isDue(settings) {
  if (!settings.last_run) return true;
  const hours = FREQUENCY_HOURS[settings.frequency] ?? 24;
  const elapsedMs = Date.now() - new Date(settings.last_run).getTime();
  return elapsedMs >= hours * 60 * 60 * 1000;
}

// The vague "/job-digest" slash command used to be passed here directly, but
// headless runs can't reliably resolve a slash command (this app has hit
// that exact failure before, for other routes) — it also never granted Bash,
// so none of scripts/connectors/*.mjs could run, silently downgrading every
// run (scheduled or manual "Run now", both call this same function) to
// WebFetch/WebSearch only. Fixed the same way as the other routes: point
// straight at SKILL.md's real path and grant full Bash for the connectors.
export async function runDigestNow(workspaceDir) {
  if (running) return { skipped: true, reason: 'already running' };
  running = true;
  runStartedAt = Date.now();
  try {
    const skillPath = join(PLUGIN_DIR, 'skills', 'job-digest', 'SKILL.md');
    const prompt = `Read the exact file "${skillPath}" and follow its main digest steps precisely (the numbered list under the "Inputs" section, not "Adding an employer" or "Tailoring a CV") — that path is exact and correct, do not Glob, Grep, or otherwise search for it or for the skill it belongs to. Run it against profile.md and roles.json in the current folder, including running every connector listed in scripts/connectors/employer-boards.json via Bash as that section instructs — do not skip the connector pass or substitute WebFetch for an employer that already has a working connector. Write the updated roles.json and reply with the digest per the skill's own reply format.`;
    const output = await runClaudeHeadless(workspaceDir, prompt, { extraAllowedTools: ['Bash'] });
    const durationMs = Date.now() - runStartedAt;
    writeFileSync(
      join(workspaceDir, 'last-run-log.txt'),
      `Run finished ${new Date().toISOString()} (${Math.round(durationMs / 1000)}s)\n\n${output}\n`
    );
    const settings = getSettings(workspaceDir);
    setSettings(workspaceDir, { ...settings, last_run: new Date().toISOString(), last_run_duration_ms: durationMs });
    return { skipped: false };
  } finally {
    running = false;
    runStartedAt = null;
  }
}

function tick() {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return; // no workspace chosen yet
  if (!readConfig().setupComplete) return; // workspace exists mid-wizard, but setup isn't finished — never run yet
  const settings = getSettings(workspaceDir);
  if (settings.paused) return;
  if (!isDue(settings)) return;
  runDigestNow(workspaceDir).catch((err) => {
    console.error('[scheduler] digest run failed:', err.message);
  });
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  tick(); // also check once at startup
}

export function isDigestRunning() {
  return running;
}

export function getRunStartedAt() {
  return runStartedAt;
}
