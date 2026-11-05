// Local app state: which workspace folder this server instance points at.
// Running from source, this lives next to the app code (gitignored, never
// committed). Running as a packaged Electron app, the install directory may
// not be writable, so electron/main.js points this at Electron's own
// userData directory instead via JOB_DIGEST_USER_DATA_DIR. Either way it's
// never in the user's actual workspace folder itself.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.JOB_DIGEST_USER_DATA_DIR || join(__dirname, '..');
const configPath = join(configDir, '.config.json');

export function readConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(patch) {
  const current = readConfig();
  const next = { ...current, ...patch };
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function getWorkspaceDir() {
  const { workspaceDir } = readConfig();
  return workspaceDir || null;
}

export function ensureWorkspaceDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
