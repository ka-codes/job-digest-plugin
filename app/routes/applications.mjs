import { Router } from 'express';
import { getWorkspaceDir } from '../lib/config.mjs';
import { getApplications, setApplications, todayISO } from '../lib/store.mjs';

const router = Router();

function requireWorkspace(req, res, next) {
  const workspaceDir = getWorkspaceDir();
  if (!workspaceDir) return res.status(400).json({ error: 'no workspace configured yet' });
  req.workspaceDir = workspaceDir;
  next();
}
router.use(requireWorkspace);

const VALID_STATUSES = ['not_applied', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];

router.get('/applications', (req, res) => {
  res.json(getApplications(req.workspaceDir));
});

// Create or update the application for a role. Body: { roleId, status, nextStep, nextStepDate, note }
router.post('/applications', (req, res) => {
  const { roleId, status, nextStep, nextStepDate, note } = req.body;
  if (!roleId) return res.status(400).json({ error: 'roleId is required' });
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
  }

  const apps = getApplications(req.workspaceDir);
  let app = apps.find((a) => a.role_id === roleId);
  const today = todayISO();

  if (!app) {
    app = {
      id: `app_${today}_${Math.random().toString(36).slice(2, 8)}`,
      role_id: roleId,
      status: status || 'not_applied',
      applied_date: status === 'applied' ? today : null,
      status_date: today,
      next_step: nextStep || '',
      next_step_date: nextStepDate || null,
      cv_version_used: null,
      cover_letter_file: null,
      history: [{ date: today, status: status || 'not_applied', note: note || 'created' }],
    };
    apps.push(app);
  } else {
    if (status && status !== app.status) {
      app.status = status;
      app.status_date = today;
      if (status === 'applied' && !app.applied_date) app.applied_date = today;
      app.history.push({ date: today, status, note: note || '' });
    }
    if (nextStep !== undefined) app.next_step = nextStep;
    if (nextStepDate !== undefined) app.next_step_date = nextStepDate;
  }

  setApplications(req.workspaceDir, apps);
  res.json(app);
});

export default router;
