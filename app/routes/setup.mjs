import { Router } from 'express';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, writeConfig, ensureWorkspaceDir, getWorkspaceDir } from '../lib/config.mjs';
import { ensureProfileMd, replaceSection, getTemplateSection, getProfileSection } from '../lib/profile-md.mjs';
import { getApplications, setApplications, setSettings } from '../lib/store.mjs';
import { runDigestNow } from '../lib/scheduler.mjs';
import { runClaudeHeadless, checkClaudeInstalled } from '../lib/claude.mjs';
import { writeTextSidecar } from '../lib/extract-text.mjs';
import { generateBackground } from '../lib/background.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrateScript = join(__dirname, '..', '..', 'scripts', 'migrate-job-log.mjs');

// The "Priority employers" section of profile.md only ever lists currently-
// enabled employers (that's what the digest skill reads), so unchecking one
// in the UI and saving used to drop it from that markdown entirely — with
// nowhere else recording it existed, there was no way to see or re-check it.
// This catalog file is the durable, UI-only record of every employer the
// user has ever had (checked or not), kept separate from profile.md so the
// skill's contract (that section = enabled employers only) never changes.
function employersCatalogPath(workspaceDir) {
  return join(workspaceDir, 'employers-catalog.json');
}

function readEmployersCatalog(workspaceDir) {
  const p = employersCatalogPath(workspaceDir);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(parsed?.groups) ? parsed : null;
  } catch {
    return null;
  }
}

function writeEmployersCatalog(workspaceDir, catalog) {
  writeFileSync(employersCatalogPath(workspaceDir), JSON.stringify(catalog, null, 2));
}

function parseEmployersSection(md) {
  const groups = [];
  let current = null;
  for (const line of (md || '').split('\n')) {
    const h = line.match(/^###\s+(.*)/);
    const item = line.match(/^-\s*(.+?)\s*—\s*(\S+.*)$/);
    if (h) {
      current = { category: h[1].trim(), items: [] };
      groups.push(current);
    } else if (item && current) {
      current.items.push({ name: item[1].trim(), url: item[2].trim() });
    }
  }
  return groups;
}

// Runs once, the first time a workspace is read after this catalog was
// introduced. The template's full roster is the only remaining record of
// which employers exist at all (an employer unchecked-then-saved under the
// old behavior is no longer in profile.md anywhere) — so it doubles as the
// master list here, with checked state recovered from whichever of those
// employers are still present in the user's current (enabled-only) section.
function bootstrapEmployersCatalog(workspaceDir, currentEmployersMd) {
  const templateGroups = parseEmployersSection(getTemplateSection('priority employers'));
  const currentGroups = parseEmployersSection(currentEmployersMd);
  const currentNamesByCategory = new Map(currentGroups.map((g) => [g.category, new Set(g.items.map((i) => i.name))]));

  const groups = templateGroups.map((g) => ({
    category: g.category,
    items: g.items.map((i) => ({ ...i, checked: currentNamesByCategory.get(g.category)?.has(i.name) ?? false })),
  }));

  // Carry over any category/employer in the user's current list that isn't
  // part of the template roster at all (e.g. custom "Your additions") — it
  // only exists there because the user actively added it, so it's checked.
  for (const cg of currentGroups) {
    let g = groups.find((x) => x.category === cg.category);
    if (!g) { g = { category: cg.category, items: [] }; groups.push(g); }
    for (const item of cg.items) {
      if (!g.items.some((x) => x.name === item.name)) g.items.push({ ...item, checked: true });
    }
  }

  const catalog = { groups };
  writeEmployersCatalog(workspaceDir, catalog);
  return catalog;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/status', (_req, res) => {
  const config = readConfig();
  res.json({ setupComplete: !!config.setupComplete, workspaceDir: config.workspaceDir || null });
});

// Wizard step 0 (packaged-app first run): is Claude Code CLI actually
// installed? Every real AI feature shells out to it — without this check,
// the first sign of a missing install is an opaque error buried deep in
// step 3 (background generation) or a silently logged scheduler failure.
router.get('/setup/check-claude', (_req, res) => {
  res.json(checkClaudeInstalled());
});

// Opens a native OS folder-picker dialog server-side and returns the chosen
// absolute path. A browser can't do this itself: the File System Access API
// shows a picker but deliberately hides the real filesystem path. Since this
// is a local server with full OS access (not a sandboxed page), it can shell
// out to a real native dialog instead.
router.post('/setup/browse-folder', (_req, res) => {
  if (process.platform === 'win32') {
    // ShowDialog() with no owner can open behind the active window (no focus
    // to claim). A zero-size, invisible, centered, TopMost owner window gives
    // the dialog something real to center on and bring to the front —
    // minimizing the owner instead (an earlier attempt) put it in the corner.
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $owner = New-Object System.Windows.Forms.Form
      $owner.StartPosition = 'CenterScreen'
      $owner.Size = New-Object System.Drawing.Size(0,0)
      $owner.FormBorderStyle = 'None'
      $owner.ShowInTaskbar = $false
      $owner.Opacity = 0
      $owner.TopMost = $true
      $owner.Show()
      $owner.Activate()
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.Description = 'Choose or create your private job-search folder'
      $dialog.ShowNewFolderButton = $true
      if ($dialog.ShowDialog($owner) -eq 'OK') { Write-Output $dialog.SelectedPath }
      $owner.Dispose()
    `;
    execFile('powershell', ['-NoProfile', '-STA', '-Command', script], (err, stdout) => {
      const path = stdout?.trim();
      res.json({ path: path || null });
    });
  } else if (process.platform === 'darwin') {
    const script = `POSIX path of (choose folder with prompt "Choose or create your private job-search folder")`;
    execFile('osascript', ['-e', script], (err, stdout) => {
      res.json({ path: stdout?.trim() || null });
    });
  } else {
    execFile('zenity', ['--file-selection', '--directory', '--title=Choose your private job-search folder'], (err, stdout) => {
      res.json({ path: stdout?.trim() || null });
    });
  }
});

router.get('/setup/defaults', (_req, res) => {
  res.json({
    employers: getTemplateSection('priority employers'),
    aggregators: getTemplateSection('aggregators'),
  });
});

// Drafts a Background summary from the CV(s) already uploaded in step 2, so
// the user edits a real starting point instead of typing one from scratch.
router.post('/setup/generate-background', async (req, res) => {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  try {
    res.json(await generateBackground(workspaceDir));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A sensible default workspace location, for "just create one for me" — a
// discoverable folder (Documents, not a hidden app-data path) so a non-
// technical user can actually find it later if they ever want to.
router.get('/setup/suggested-path', (_req, res) => {
  res.json({ path: join(homedir(), 'Documents', 'job-search-private') });
});

router.post('/setup/workspace', (req, res) => {
  const { path } = req.body;
  if (!path) return res.status(400).json({ error: 'path is required' });
  ensureWorkspaceDir(path);
  writeConfig({ workspaceDir: path });
  ensureProfileMd(path);
  if (!existsSync(join(path, 'applications.json'))) setApplications(path, []);

  // Run the (idempotent) migration — safe whether or not a legacy job-log.md exists.
  execFile('node', [migrateScript, path], (err, stdout, stderr) => {
    if (err) console.error('[setup] migration step failed:', stderr || err.message);
    res.json({ ok: true, workspaceDir: path, migration: stdout?.trim() || null });
  });
});

router.post(
  '/setup/upload',
  upload.fields([{ name: 'cv', maxCount: 3 }, { name: 'coverLetter', maxCount: 3 }]),
  async (req, res) => {
    const workspaceDir = getWorkspaceDir();
    if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });

    const saveAll = async (files = []) => {
      const names = [];
      for (const f of files) {
        const safeName = f.originalname.replace(/[\\/:*?"<>|]/g, '_');
        const fullPath = join(workspaceDir, safeName);
        writeFileSync(fullPath, f.buffer);
        await writeTextSidecar(fullPath); // lets the headless skill read CV/letter text without opening the binary file
        names.push(safeName);
      }
      return names;
    };

    const cvFiles = await saveAll(req.files?.cv);
    const letterFiles = await saveAll(req.files?.coverLetter);

    const lines = [];
    if (cvFiles.length) lines.push(`- CV: ${cvFiles.join(', ')}`);
    if (letterFiles.length) lines.push(`- Cover-letter style and reusable sections: ${letterFiles.join(', ')}`);
    if (lines.length) replaceSection(workspaceDir, 'reference documents', lines.join('\n'));

    res.json({ ok: true, cvFiles, letterFiles });
  }
);

// Reads current values back out of profile.md, so the Profile & Preferences
// screen can be edited any time, not just during first-run setup.
router.get('/setup/preferences', (_req, res) => {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });

  const background = getProfileSection(workspaceDir, 'background');
  const target = getProfileSection(workspaceDir, 'target');
  const locationsRaw = getProfileSection(workspaceDir, 'locations');
  const locations = locationsRaw
    .split('\n')
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
  const payRaw = getProfileSection(workspaceDir, 'pay');
  const payFloorMatch = payRaw.match(/floor[^:]*:\s*([\d,]+)/i);
  const payGoalMatch = payRaw.match(/goal:\s*([\d,]+)/i);
  const employers = getProfileSection(workspaceDir, 'priority employers');
  const employersCatalog = readEmployersCatalog(workspaceDir) || bootstrapEmployersCatalog(workspaceDir, employers);

  res.json({
    background,
    target,
    locations,
    payFloor: payFloorMatch ? payFloorMatch[1].replace(/,/g, '') : '',
    payGoal: payGoalMatch ? payGoalMatch[1].replace(/,/g, '') : '',
    employers,
    employersCatalog,
  });
});

router.post('/setup/preferences', (req, res) => {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });

  const { background, target, locations, payFloor, payGoal, employers, employersCatalog } = req.body;

  if (background) replaceSection(workspaceDir, 'background', background);
  if (target) replaceSection(workspaceDir, 'target', target);
  if (Array.isArray(locations) && locations.length) {
    replaceSection(workspaceDir, 'locations', locations.map((l, i) => `${i + 1}. ${l}`).join('\n'));
  }
  if (payFloor || payGoal) {
    replaceSection(
      workspaceDir,
      'pay',
      `- Floor (top of range must exceed): ${payFloor || '(not set)'}\n- Goal: ${payGoal || '(not set)'}`
    );
  }
  if (employers) replaceSection(workspaceDir, 'priority employers', employers);
  if (employersCatalog && Array.isArray(employersCatalog.groups)) writeEmployersCatalog(workspaceDir, employersCatalog);

  res.json({ ok: true });
});

router.post('/setup/settings', (req, res) => {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  const { frequency, timeOfDay } = req.body;
  setSettings(workspaceDir, {
    frequency: frequency || 'daily',
    time_of_day: timeOfDay || '06:00',
    last_run: null,
  });
  res.json({ ok: true });
});

router.post('/setup/finish', (req, res) => {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  writeConfig({ setupComplete: true });
  // Kick off the first digest in the background — don't make the wizard wait on it.
  runDigestNow(workspaceDir).catch((err) => console.error('[setup] first run failed:', err.message));
  res.json({ ok: true });
});

export default router;
