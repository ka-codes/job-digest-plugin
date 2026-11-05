import { Router } from 'express';
import { getWorkspaceDir } from '../lib/config.mjs';
import { getRoles, setRoles, getSettings, setSettings } from '../lib/store.mjs';
import { runDigestNow, isDigestRunning, getRunStartedAt } from '../lib/scheduler.mjs';

const router = Router();

function requireWorkspace(req, res, next) {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  req.workspaceDir = workspaceDir;
  next();
}
router.use(requireWorkspace);

router.get('/roles', (req, res) => {
  res.json(getRoles(req.workspaceDir));
});

// Mark a role's digest_status (e.g. "saved", "closed", "not_qualifying").
router.post('/roles/:id/status', (req, res) => {
  const roles = getRoles(req.workspaceDir);
  const role = roles.find((r) => r.id === req.params.id);
  if (!role) return res.status(404).json({ error: 'role not found' });
  role.digest_status = req.body.status;
  role.saved_by_user = req.body.status === 'saved' || role.saved_by_user;
  setRoles(req.workspaceDir, roles);
  res.json(role);
});

router.get('/settings', (req, res) => {
  res.json(getSettings(req.workspaceDir));
});

router.post('/settings', (req, res) => {
  const current = getSettings(req.workspaceDir);
  const next = { ...current, ...req.body };
  setSettings(req.workspaceDir, next);
  res.json(next);
});

router.get('/run-now/status', (req, res) => {
  const settings = getSettings(req.workspaceDir);
  res.json({
    running: isDigestRunning(),
    startedAt: getRunStartedAt(),
    lastDurationMs: settings.last_run_duration_ms || null,
  });
});

router.post('/run-now', async (req, res) => {
  if (isDigestRunning()) return res.json({ started: false, reason: 'already running' });
  res.json({ started: true }); // respond immediately, run in background
  try {
    await runDigestNow(req.workspaceDir);
  } catch (err) {
    console.error('[run-now] failed:', err.message);
  }
});

export default router;
