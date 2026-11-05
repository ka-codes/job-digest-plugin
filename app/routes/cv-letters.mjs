import { Router } from 'express';
import multer from 'multer';
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { getWorkspaceDir } from '../lib/config.mjs';
import { getReferenceDocuments, getProfileSection, replaceSection } from '../lib/profile-md.mjs';
import { getRoles } from '../lib/store.mjs';
import { runClaudeHeadless, PLUGIN_DIR } from '../lib/claude.mjs';
import { writeTextSidecar } from '../lib/extract-text.mjs';
import { generateBackground } from '../lib/background.mjs';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function requireWorkspace(req, res, next) {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  req.workspaceDir = workspaceDir;
  next();
}
router.use(requireWorkspace);

// Snapshots .docx mtimes in a directory before a headless run, then finds
// whichever file was created OR modified during the run. A plain "new
// filename" diff misses a regenerated file that reuses the same name (e.g.
// re-tailoring a CV for a role you already tailored once) — this catches both.
function snapshotDocx(dir) {
  const snap = new Map();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.docx')) snap.set(f, statSync(join(dir, f)).mtimeMs);
    }
  }
  return snap;
}

function findTouchedDocx(dir, before, claudeOutput) {
  const after = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.docx')) : [];
  const touched = after.filter((f) => {
    const prevMtime = before.get(f);
    return prevMtime === undefined || statSync(join(dir, f)).mtimeMs > prevMtime;
  });
  touched.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  if (touched[0]) return touched[0];

  // Fall back to parsing Claude's reply: the filename should be the last
  // non-empty line even if it added explanatory text before it.
  const lastLine = (claudeOutput || '').trim().split('\n').filter(Boolean).pop() || '';
  if (lastLine && existsSync(join(dir, lastLine))) return lastLine;
  return null;
}

// This app is local-first — the server and the browser are on the same
// machine, so "open" can mean launch-in-Word, not just download-then-open.
// Windows: `cmd /c start "" <path>` (the empty "" is the window-title arg
// `start` expects before the real argument). macOS/Linux use their own
// standard "open the default handler for this file" commands.
function openFileInOsDefault(filePath, res) {
  const [command, args] =
    process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', filePath]]
    : process.platform === 'darwin' ? ['open', [filePath]]
    : ['xdg-open', [filePath]];
  execFile(command, args, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
}

// Lists every generated tailored-CV and cover-letter .docx, newest first, so
// a user can reopen a past one for a different job without hunting through
// the filesystem. No link back to a specific role — just a flat archive.
const DOCUMENT_DIRS = { 'tailor-cv': 'cv-tailored', reword: 'cover-letters' };

router.get('/documents', (req, res) => {
  const listDir = (dir, folder) => {
    const fullDir = join(req.workspaceDir, dir);
    if (!existsSync(fullDir)) return [];
    return readdirSync(fullDir)
      .filter((f) => f.endsWith('.docx'))
      .map((filename) => ({
        filename,
        folder,
        mtime: statSync(join(fullDir, filename)).mtimeMs,
        downloadUrl: `/api/${folder}/download/${encodeURIComponent(filename)}`,
        openUrl: `/api/${folder}/open/${encodeURIComponent(filename)}`,
        deleteUrl: `/api/documents/${folder}/${encodeURIComponent(filename)}`,
      }));
  };
  const docs = [...listDir('cv-tailored', 'tailor-cv'), ...listDir('cover-letters', 'reword')].sort(
    (a, b) => b.mtime - a.mtime
  );
  res.json(docs);
});

// Deletes a generated document. Scoped to the two known folders and
// basename-only, so this can never touch anything outside cv-tailored/ or
// cover-letters/.
router.delete('/documents/:folder/:filename', (req, res) => {
  const dir = DOCUMENT_DIRS[req.params.folder];
  if (!dir) return res.status(400).json({ error: 'unknown folder' });
  const filename = basename(req.params.filename);
  const filePath = join(req.workspaceDir, dir, filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
  unlinkSync(filePath);
  res.json({ ok: true });
});

router.get('/files', (req, res) => {
  res.json(getReferenceDocuments(req.workspaceDir));
});

router.post('/files', upload.fields([{ name: 'cv', maxCount: 3 }, { name: 'coverLetter', maxCount: 3 }]), async (req, res) => {
  const saveAll = async (files = []) => {
    const names = [];
    for (const f of files) {
      const safeName = f.originalname.replace(/[\\/:*?"<>|]/g, '_');
      const fullPath = join(req.workspaceDir, safeName);
      writeFileSync(fullPath, f.buffer);
      await writeTextSidecar(fullPath); // same reason as setup.mjs: lets the headless skill read it without opening the binary
      names.push(safeName);
    }
    return names;
  };

  const newCv = await saveAll(req.files?.cv);
  const newLetters = await saveAll(req.files?.coverLetter);
  const current = getReferenceDocuments(req.workspaceDir);

  const cvFiles = [...new Set([...current.cvFiles, ...newCv])];
  const letterFiles = [...new Set([...current.letterFiles, ...newLetters])];

  const lines = [];
  if (cvFiles.length) lines.push(`- CV: ${cvFiles.join(', ')}`);
  if (letterFiles.length) lines.push(`- Cover-letter style and reusable sections: ${letterFiles.join(', ')}`);
  if (lines.length) replaceSection(req.workspaceDir, 'reference documents', lines.join('\n'));

  // A replaced/added CV after setup should refresh the Background summary
  // too, not leave it describing whatever CV was uploaded during the wizard.
  let background;
  if (newCv.length) {
    try {
      const result = await generateBackground(req.workspaceDir);
      if (result.background) {
        replaceSection(req.workspaceDir, 'background', result.background);
        background = result.background;
      }
    } catch (err) {
      console.error('[cv-letters] background refresh failed:', err.message);
    }
  }

  res.json({ cvFiles, letterFiles, background });
});

// Reads/writes the "Writing rules for cover letters" section of profile.md —
// the drafting flow (and `/reword` below) already reads this section by name.
router.get('/style-guidance', (req, res) => {
  res.json({ guidance: getProfileSection(req.workspaceDir, 'writing rules for cover letters') });
});

router.post('/style-guidance', (req, res) => {
  const { guidance } = req.body;
  replaceSection(req.workspaceDir, 'writing rules for cover letters', guidance || '(none set)');
  res.json({ ok: true });
});

// Draft a cover letter for a role, live. Shells out to the same drafting
// flow the /cover-letter command uses — no separate AI integration.
router.post('/reword', async (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  const role = getRoles(req.workspaceDir).find((r) => r.id === roleId);
  if (!role) return res.status(404).json({ error: 'role not found' });

  const lettersDir = join(req.workspaceDir, 'cover-letters');
  if (!existsSync(lettersDir)) mkdirSync(lettersDir, { recursive: true });
  const before = snapshotDocx(lettersDir);

  try {
    const skillPath = join(PLUGIN_DIR, 'skills', 'job-digest', 'SKILL.md');
    const prompt = `Read the exact file "${skillPath}" and follow its "## Drafting a cover letter" section precisely, for the role with id ${roleId} (${role.title} at ${role.org}) from roles.json. That path is exact and correct — do not Glob, Grep, or otherwise search the filesystem to find it or the skill it belongs to.

This is a direct instruction to execute the full task now, not a question and not a status check. Even if cover-letters/ already contains a file for this role from an earlier run, generate a fresh one now and overwrite it — do not stop early to report what already exists instead of doing the work. Carry out every step of that section, including reading skills/job-digest/reference/cover-letter-generator.md and the user's own example letters, and calling the docx skill, through to actually saving the new .docx file.

Produce a real .docx file via the docx skill as that section describes — not a text summary. Save it to cover-letters/ and, once saved, reply with only the saved file's name (just the filename, nothing else — no path, no other text).`;
    // The docx skill needs the Skill tool and real Bash access, same as /tailor-cv.
    const output = await runClaudeHeadless(req.workspaceDir, prompt, { extraAllowedTools: ['Skill', 'Bash'] });

    const filename = findTouchedDocx(lettersDir, before, output);
    if (!filename) {
      return res.json({ error: `Could not find the generated file. Claude said: ${output.trim()}` });
    }
    res.json({
      filename,
      downloadUrl: `/api/reword/download/${encodeURIComponent(filename)}`,
      openUrl: `/api/reword/open/${encodeURIComponent(filename)}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serves a generated cover-letter file for download. Scoped strictly to
// cover-letters/ and basename-only to prevent path traversal.
router.get('/reword/download/:filename', (req, res) => {
  const filename = basename(req.params.filename);
  const filePath = join(req.workspaceDir, 'cover-letters', filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
  res.download(filePath, filename);
});

// Launches the file directly in its default app (Word) — this app is
// local-first, so the server and the browser share a machine, and "open"
// can mean that instead of download-then-open-from-Downloads.
router.post('/reword/open/:filename', (req, res) => {
  const filename = basename(req.params.filename);
  const filePath = join(req.workspaceDir, 'cover-letters', filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
  openFileInOsDefault(filePath, res);
});

// Tailor the CV for a specific role, live. Shells out to the same tailoring
// flow the job-digest skill's "Tailoring a CV" section defines.
router.post('/tailor-cv', async (req, res) => {
  const { roleId } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  const role = getRoles(req.workspaceDir).find((r) => r.id === roleId);
  if (!role) return res.status(404).json({ error: 'role not found' });

  const tailoredDir = join(req.workspaceDir, 'cv-tailored');
  if (!existsSync(tailoredDir)) mkdirSync(tailoredDir, { recursive: true });
  const before = snapshotDocx(tailoredDir);

  try {
    const skillPath = join(PLUGIN_DIR, 'skills', 'job-digest', 'SKILL.md');
    const prompt = `Read the exact file "${skillPath}" and follow its "## Tailoring a CV" section precisely, for the role with id ${roleId} (${role.title} at ${role.org}) from roles.json. That path is exact and correct — do not Glob, Grep, or otherwise search the filesystem to find it or the skill it belongs to.

This is a direct instruction to execute the full task now, not a question and not a status check. Even if cv-tailored/ already contains a file for this role from an earlier run, generate a fresh one now and overwrite it — do not stop early to report what already exists instead of doing the work. Carry out every step of that section, including reading the two reference files it names and calling the docx skill, through to actually saving the new .docx file.

Produce a real .docx file via the docx skill as that section describes — not a text summary. Save it to cv-tailored/ and, once saved, reply with only the saved file's name (just the filename, nothing else — no path, no other text).`;
    // The docx skill needs the Skill tool and real Bash access (to run its own
    // document-generation scripts) beyond the base connector-only Bash scope.
    const output = await runClaudeHeadless(req.workspaceDir, prompt, { extraAllowedTools: ['Skill', 'Bash'] });

    const filename = findTouchedDocx(tailoredDir, before, output);
    if (!filename) {
      return res.json({ error: `Could not find the generated file. Claude said: ${output.trim()}` });
    }
    res.json({
      filename,
      downloadUrl: `/api/tailor-cv/download/${encodeURIComponent(filename)}`,
      openUrl: `/api/tailor-cv/open/${encodeURIComponent(filename)}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serves a generated tailored-CV file for download. Scoped strictly to
// cv-tailored/ and basename-only to prevent path traversal.
router.get('/tailor-cv/download/:filename', (req, res) => {
  const filename = basename(req.params.filename);
  const filePath = join(req.workspaceDir, 'cv-tailored', filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
  res.download(filePath, filename);
});

// Launches the file directly in its default app (Word) — see the reword
// route above for why this app can do that.
router.post('/tailor-cv/open/:filename', (req, res) => {
  const filename = basename(req.params.filename);
  const filePath = join(req.workspaceDir, 'cv-tailored', filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
  openFileInOsDefault(filePath, res);
});

export default router;
