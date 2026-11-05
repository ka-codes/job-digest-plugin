import { Router } from 'express';
import multer from 'multer';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceDir } from '../lib/config.mjs';
import { runClaudeHeadless, PLUGIN_DIR } from '../lib/claude.mjs';
import { getEmployerGroups } from '../lib/profile-md.mjs';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireWorkspace(req, res, next) {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  req.workspaceDir = workspaceDir;
  next();
}
router.use(requireWorkspace);

// Maps each priority employer (and its common aliases) to one of three
// broad groups — Multilaterals & bilaterals / INGOs & foundations / Tech —
// read live from profile.md, so this stays in sync with whatever the user
// has added via Profile & Preferences without a separate list to maintain.
router.get('/employer-groups', (req, res) => {
  res.json(getEmployerGroups(req.workspaceDir));
});

// Add an employer by typed name or by an uploaded screenshot. Uses the
// job-digest skill's "Adding an employer to the priority list" section —
// same AI integration as everything else, no separate OCR/search service.
router.post('/employers', upload.single('screenshot'), async (req, res) => {
  const { name } = req.body;
  const screenshot = req.file;
  if (!name && !screenshot) return res.status(400).json({ error: 'name or screenshot is required' });

  let tempPath = null;
  try {
    const skillPath = join(PLUGIN_DIR, 'skills', 'job-digest', 'SKILL.md');
    const scope = `Read the exact file "${skillPath}" and follow ONLY its "## Adding an employer to the priority list" section — that path is exact and correct, do not Glob, Grep, or otherwise search for it or for the skill it belongs to. Do not run a job digest, do not search for or score any open roles, do not produce a digest-format reply — this request is only the 3 steps in that one section: resolve the organization's careers URL and ATS board, append it to profile.md's Priority employers list, and register a connector in employer-boards.json only if a board token actually works live.`;
    let prompt;
    if (screenshot) {
      tempPath = join(req.workspaceDir, '.tmp-employer-screenshot.png');
      writeFileSync(tempPath, screenshot.buffer);
      prompt = `${scope} Read the image at ${tempPath} to identify the organization, then follow the rest of that section. Reply with one line: the employer name and careers URL you added, or why you could not.`;
    } else {
      prompt = `${scope} The organization is "${name}". Reply with one line: the employer name and careers URL you added, or why you could not.`;
    }
    const output = await runClaudeHeadless(req.workspaceDir, prompt, { extraAllowedTools: ['Bash(node scripts/connectors/*.mjs*)'] });
    res.json({ result: output.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (tempPath && existsSync(tempPath)) unlinkSync(tempPath);
  }
});

export default router;
