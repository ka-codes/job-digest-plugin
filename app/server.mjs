import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import setupRoutes from './routes/setup.mjs';
import digestRoutes from './routes/digest.mjs';
import applicationsRoutes from './routes/applications.mjs';
import cvLettersRoutes from './routes/cv-letters.mjs';
import employersRoutes from './routes/employers.mjs';
import previewRoutes from './routes/preview.mjs';
import { startScheduler } from './lib/scheduler.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4317;

const app = express();
app.use(express.json());
// This app is local-only, served to exactly one browser — there's no real
// benefit to caching, and it was masking edits during development (the
// browser kept serving a stale wizard.js after changes). Always fetch fresh.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(join(__dirname, 'public')));

app.use('/api', setupRoutes);
app.use('/api', digestRoutes);
app.use('/api', applicationsRoutes);
app.use('/api', cvLettersRoutes);
app.use('/api', employersRoutes);
app.use('/api', previewRoutes);

app.listen(PORT, () => {
  console.log(`job-digest dashboard running at http://localhost:${PORT}`);
  startScheduler();
});
