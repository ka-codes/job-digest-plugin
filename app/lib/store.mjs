// Safe read/write for the JSON files in a user's workspace folder.
// Shared by every route — one place that knows the file shapes and defaults.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function readJSON(workspaceDir, filename, fallback) {
  const p = join(workspaceDir, filename);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(workspaceDir, filename, data) {
  writeFileSync(join(workspaceDir, filename), JSON.stringify(data, null, 2) + '\n');
}

export const getRoles = (dir) => readJSON(dir, 'roles.json', []);
export const setRoles = (dir, roles) => writeJSON(dir, 'roles.json', roles);

export const getApplications = (dir) => readJSON(dir, 'applications.json', []);
export const setApplications = (dir, apps) => writeJSON(dir, 'applications.json', apps);

export const getSettings = (dir) =>
  readJSON(dir, 'settings.json', { frequency: 'daily', time_of_day: '06:00', last_run: null });
export const setSettings = (dir, settings) => writeJSON(dir, 'settings.json', settings);

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
