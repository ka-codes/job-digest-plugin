// job-digest dashboard — vanilla JS, no build step. Talks to the local
// server's /api/* routes, which are the only thing that touches disk or
// shells out to Claude Code.

const api = {
  get: (path) => fetch(`/api${path}`).then((r) => r.json()),
  post: (path, body) =>
    fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json()),
  postForm: (path, formData) =>
    fetch(`/api${path}`, { method: 'POST', body: formData }).then((r) => r.json()),
  del: (path) => fetch(`/api${path}`, { method: 'DELETE' }).then((r) => r.json()),
};

function formatThousands(digits) {
  return String(digits || '').replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function unformatThousands(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

// Reformats a pay input with thousands separators as the user types, keeping
// the cursor in the right place relative to the surrounding digits.
function bindThousandsInput(input) {
  input.addEventListener('input', () => {
    const cursor = input.selectionStart;
    const digitsBeforeCursor = input.value.slice(0, cursor).replace(/[^\d]/g, '').length;
    const formatted = formatThousands(input.value);
    input.value = formatted;
    let seen = 0, pos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) seen++;
      if (seen === digitsBeforeCursor) { pos = i + 1; break; }
    }
    if (digitsBeforeCursor === 0) pos = 0;
    input.setSelectionRange(pos, pos);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtPay(role) {
  if (!role.pay_stated && role.pay_min == null && role.pay_max == null) return 'Pay not stated';
  const cur = role.pay_currency || '';
  if (role.pay_min != null && role.pay_max != null) return `${cur}${role.pay_min.toLocaleString()}–${cur}${role.pay_max.toLocaleString()}`;
  if (role.pay_max != null) return `up to ${cur}${role.pay_max.toLocaleString()}`;
  return 'Pay not stated';
}

function fitPill(score) {
  if (score == null) return `<span class="pill neutral">not scored</span>`;
  const cls = score >= 7 ? 'positive' : score >= 4 ? 'accent' : 'neutral';
  return `<span class="pill ${cls}">fit ${score}/10</span>`;
}

function deadlinePill(deadline) {
  if (!deadline) return '';
  const days = Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `<span class="pill negative">deadline passed</span>`;
  if (days <= 7) return `<span class="pill warning">due in ${days}d</span>`;
  return `<span class="pill neutral">due ${esc(deadline)}</span>`;
}

const EMPLOYMENT_TYPE_LABELS = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship' };
function employmentPill(type) {
  const label = EMPLOYMENT_TYPE_LABELS[type];
  return label ? `<span class="pill neutral">${label}</span>` : '';
}

function rosterBadge(isRoster) {
  return isRoster ? `<span class="pill accent">Roster</span>` : '';
}

const ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_BOOKMARK = '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>';
const ICON_THUMBS_DOWN = '<svg viewBox="0 0 24 24"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zm0 0 4-8a2 2 0 0 1 2 2v5h5.5a2 2 0 0 1 1.95 2.45l-1.5 7A2 2 0 0 1 17 20H9a2 2 0 0 1-2-2v-7z" transform="rotate(180 12 12)"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_DOCUMENT = '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6V2z"/><path d="M9 13h6M9 17h6"/></svg>';
const ICON_PENCIL = '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
function panelHeader(icon, title, right = '') {
  return `<div class="panel-header"><div class="panel-header-title"><span class="panel-header-icon">${icon}</span><h2>${esc(title)}</h2></div>${right}</div>`;
}

// Tailor CV / Draft Cover Letter run for minutes, and the user wants to keep
// browsing other pages while they finish — so progress/results can't live
// only in the DOM row that started the request (navigating away destroys
// it). This map is the source of truth; a global ticker (below) refreshes
// whatever row is currently visible for a tracked role, and a fresh render
// of that role anywhere (any view) picks its current state back up.
const cvJobs = new Map(); // key: `${type}:${roleId}` -> { type, roleId, status, startedAt, filename, downloadUrl, openUrl, error }

function cvJobKey(type, roleId) {
  return `${type}:${roleId}`;
}

function launchCvJob(type, roleId) {
  const key = cvJobKey(type, roleId);
  const existing = cvJobs.get(key);
  if (existing && existing.status === 'running') return existing; // already in flight — don't double-launch
  const job = { type, roleId, status: 'running', startedAt: Date.now() };
  cvJobs.set(key, job);
  const endpoint = type === 'tailor-cv' ? '/tailor-cv' : '/reword';
  api
    .post(endpoint, { roleId })
    .then((res) => {
      if (res.error) {
        job.status = 'error';
        job.error = res.error;
      } else {
        job.status = 'done';
        job.filename = res.filename;
        job.downloadUrl = res.downloadUrl;
        job.openUrl = res.openUrl;
      }
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message;
    });
  return job;
}

function renderJobStatus(job, labelWhenRunning) {
  if (!job) return '';
  if (job.status === 'running') {
    const elapsedSec = Math.round((Date.now() - job.startedAt) / 1000);
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const elapsedLabel = mins ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
    return `<div class="progress-line"><span class="spinner"></span>${esc(labelWhenRunning)} — ${elapsedLabel} elapsed</div>`;
  }
  if (job.status === 'error') return `Could not finish: ${esc(job.error)}`;
  const kind = job.type === 'tailor-cv' ? 'Tailored CV' : 'Cover letter';
  return `${kind} ready — <button type="button" class="draft-open-btn" data-open-url="${esc(job.openUrl)}">Open file</button> or <a href="${esc(job.downloadUrl)}" target="_blank" rel="noopener">download</a>`;
}

function draftOutputContent(roleId) {
  const parts = [
    renderJobStatus(cvJobs.get(cvJobKey('tailor-cv', roleId)), 'Tailoring your CV as a Word doc — this can take a few minutes'),
    renderJobStatus(cvJobs.get(cvJobKey('reword', roleId)), 'Drafting your cover letter as a Word doc — this can take a few minutes'),
  ].filter(Boolean);
  return parts.join('<hr style="border:none; border-top:1px solid rgba(0,0,0,.08); margin:8px 0;">');
}

// Keeps every visible role card's status box live regardless of which view
// is on screen — the actual work (launchCvJob above) runs independently of
// this, so navigating away and back just means missing some ticks, not
// losing the job.
setInterval(() => {
  if (cvJobs.size === 0) return;
  document.querySelectorAll('.role-row[data-role-id]').forEach((rowEl) => {
    const out = rowEl.querySelector('.draft-output');
    if (!out) return;
    const content = draftOutputContent(rowEl.dataset.roleId);
    if (content) {
      out.style.display = 'block';
      out.innerHTML = content;
    }
  });
}, 1000);

document.addEventListener('click', async (e) => {
  const openBtn = e.target.closest('.draft-open-btn');
  if (openBtn) {
    openBtn.disabled = true;
    await api.post(openBtn.dataset.openUrl.replace(/^\/api/, ''), {});
    openBtn.disabled = false;
    return;
  }
  const removeBtn = e.target.closest('.doc-remove-btn');
  if (removeBtn) {
    const row = removeBtn.closest('.role-row');
    removeBtn.disabled = true;
    await api.del(removeBtn.dataset.deleteUrl.replace(/^\/api/, ''));
    row?.remove();
  }
});

function roleRow(role, actions) {
  const existingOutput = draftOutputContent(role.id);
  return `
    <div class="role-row" data-role-id="${esc(role.id)}">
      <div class="role-top">
        <div class="role-title-line">
          ${ICON_BOOKMARK}
          <span class="role-title">${esc(role.title)}</span>
        </div>
        <div style="display:flex; gap:6px; flex:none;">${rosterBadge(role.is_roster)}${employmentPill(role.employment_type)}${fitPill(role.fit_score)}${deadlinePill(role.deadline)}</div>
      </div>
      <div class="role-meta">${esc(role.org)} · ${esc(role.location || '—')} · ${fmtPay(role)}</div>
      ${role.fit_why ? `<div class="role-why">${esc(role.fit_why)}${role.fit_gap ? ` — <em>${esc(role.fit_gap)}</em>` : ''}</div>` : ''}
      <div class="draft-output" style="${existingOutput ? '' : 'display:none;'}">${existingOutput}</div>
      <div class="role-actions">
        ${role.source_url ? `<a href="${esc(role.source_url)}" target="_blank" rel="noopener">${ICON_EYE}View listing</a>` : ''}
        ${actions || ''}
      </div>
    </div>`;
}

function emptyNote(text) {
  return `<div class="empty-note">${esc(text)}</div>`;
}

// ---------------------------------------------------------------- Views

const ICON_STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.5L21 9.3l-4.9 4.3L17.5 21 12 17.6 6.5 21l1.4-7.4L3 9.3l6.1-.8L12 2z"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';

async function renderHome() {
  const [roles, applications] = await Promise.all([api.get('/roles'), api.get('/applications')]);
  const savedCount = roles.filter((r) => r.digest_status === 'saved').length;
  const highFitCount = roles.filter((r) => (r.fit_score || 0) >= 9 && r.digest_status !== 'closed' && r.digest_status !== 'not_qualifying').length;
  const appliedApps = applications.filter((a) => a.status !== 'not_applied');
  const appByRoleId = Object.fromEntries(applications.map((a) => [a.role_id, a]));
  const todoCount = roles.filter((r) => {
    if (r.digest_status !== 'saved') return false;
    const app = appByRoleId[r.id];
    return !app || app.status === 'not_applied';
  }).length;

  const roleById = Object.fromEntries(roles.map((r) => [r.id, r]));
  const appliedRoles = appliedApps
    .map((a) => roleById[a.role_id])
    .filter(Boolean)
    .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
  currentViewCount = appliedRoles.length;

  const actions = `<button data-action="tailor-cv">${ICON_DOCUMENT}Tailor CV</button>
    <button data-action="reword">${ICON_PENCIL}Draft Cover Letter</button>
    <span class="role-actions-spacer"></span>
    <button data-action="mark-applied" class="action-positive is-applied">${ICON_CHECK}Mark Applied</button>
    <button data-action="closed" class="action-danger">${ICON_X}Remove</button>`;
  const rows = appliedRoles.map((r) => roleRow(r, actions)).join('');

  return `
    <div class="view-home">
      <div class="kpi-row">
        <div class="kpi-tile spectrum-1" data-nav="saved">
          <div class="kpi-icon">${ICON_BOOKMARK}</div>
          <div class="kpi-body">
            <div class="kpi-label">Saved jobs</div>
            <div class="kpi-value">${savedCount}</div>
          </div>
        </div>
        <div class="kpi-tile spectrum-2" data-nav="digest">
          <div class="kpi-icon">${ICON_STAR}</div>
          <div class="kpi-body">
            <div class="kpi-label">High fit (9+)</div>
            <div class="kpi-value">${highFitCount}</div>
          </div>
        </div>
        <div class="kpi-tile spectrum-3" data-nav="applications">
          <div class="kpi-icon">${ICON_CHECK}</div>
          <div class="kpi-body">
            <div class="kpi-label">Applied</div>
            <div class="kpi-value">${appliedApps.length}</div>
          </div>
        </div>
        <div class="kpi-tile spectrum-4" data-nav="applications">
          <div class="kpi-icon">${ICON_CLOCK}</div>
          <div class="kpi-body">
            <div class="kpi-label">To do</div>
            <div class="kpi-value">${todoCount}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        ${panelHeader(ICON_CHECK, 'Applied jobs')}
        ${appliedRoles.length ? rows : emptyNote('Nothing applied to yet — mark a saved role as applied from Saved Jobs.')}
      </div>
    </div>`;
}

// Rolls any role's employer into one of the three broad groups the Job
// digest view filters by, using the org->group map read from profile.md's
// curated Priority employers list. Falls back to a substring match (handles
// e.g. "World Bank" vs. the list's "World Bank Group") and finally to
// "Other" for employers found via aggregators that aren't on that list.
const EMPLOYER_GROUP_ORDER = ['Multilaterals & bilaterals', 'INGOs & foundations', 'Tech', 'Other'];
function classifyOrgGroup(org, employerGroups) {
  const key = (org || '').toLowerCase().trim();
  if (!key) return 'Other';
  if (employerGroups[key]) return employerGroups[key];
  for (const [k, group] of Object.entries(employerGroups)) {
    if (k.length >= 3 && (key.includes(k) || k.includes(key))) return group;
  }
  return 'Other';
}

function groupFilterBar() {
  return `
    <div class="group-filter" id="digest-group-filter">
      <button type="button" class="group-filter-btn active" data-group="">All</button>
      ${EMPLOYER_GROUP_ORDER.map((g) => `<button type="button" class="group-filter-btn" data-group="${esc(g)}">${esc(g)}</button>`).join('')}
      <select id="digest-employment-filter">
        <option value="">All employment types</option>
        <option value="full_time">Full-time</option>
        <option value="part_time">Part-time</option>
        <option value="contract">Contract</option>
        <option value="internship">Internship</option>
      </select>
    </div>`;
}

// Group (buttons) and employment type (select) both filter the same rows —
// combined into one visibility pass so neither control clobbers the other's
// hidden rows (two independent listeners each setting style.display would
// race and only the last one to run would "win").
function applyDigestFilters(root, roles, employerGroups) {
  const bar = root.querySelector('#digest-group-filter');
  const employmentSelect = root.querySelector('#digest-employment-filter');
  if (!bar) return;
  const byId = Object.fromEntries(roles.map((r) => [r.id, r]));
  let activeGroup = '';

  const run = () => {
    const employmentFilter = employmentSelect.value;
    root.querySelectorAll('.role-row[data-role-id]').forEach((rowEl) => {
      const r = byId[rowEl.dataset.roleId];
      if (!r) return;
      let ok = true;
      if (activeGroup && classifyOrgGroup(r.org, employerGroups) !== activeGroup) ok = false;
      if (employmentFilter && r.employment_type !== employmentFilter) ok = false;
      rowEl.style.display = ok ? '' : 'none';
    });
  };

  bar.querySelectorAll('.group-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.group-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeGroup = btn.dataset.group;
      run();
    });
  });
  employmentSelect.addEventListener('input', run);
}

async function renderDigest() {
  const roles = await api.get('/roles');
  const byFit = (a, b) => (b.fit_score || 0) - (a.fit_score || 0);
  const isOpen = (r) => r.digest_status === 'new' || r.digest_status === 'reported';
  // Rosters/standing vacancies are a different thing from a real-time
  // opening (common at UN agencies and large INGOs) — pulled into their own
  // section rather than mixed into New/Still open, where they'd overstate
  // urgency.
  const newRoles = roles.filter((r) => r.digest_status === 'new' && !r.is_roster).sort(byFit);
  const stillOpenRoles = roles.filter((r) => r.digest_status === 'reported' && !r.is_roster).sort(byFit);
  const rosterRoles = roles.filter((r) => r.is_roster && isOpen(r)).sort(byFit);
  currentViewCount = newRoles.length + stillOpenRoles.length + rosterRoles.length;

  const actionButtons = `<button data-action="tailor-cv">${ICON_DOCUMENT}Tailor CV</button>
    <button data-action="reword">${ICON_PENCIL}Draft Cover Letter</button>
    <span class="role-actions-spacer"></span>
    <button data-action="save">${ICON_BOOKMARK}Save</button>
    <button data-action="not_qualifying">${ICON_THUMBS_DOWN}Not for me</button>`;
  const rowsFor = (list) => list.map((r) => roleRow(r, actionButtons)).join('');

  return `
    <div class="view-digest">
      ${groupFilterBar()}
      <div class="panel">
        <div class="panel-header"><h2>New roles</h2><span class="count-chip">${newRoles.length}</span></div>
        ${newRoles.length ? rowsFor(newRoles) : emptyNote('No new roles since the last run.')}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Still open roles</h2><span class="count-chip">${stillOpenRoles.length}</span></div>
        ${stillOpenRoles.length ? rowsFor(stillOpenRoles) : emptyNote('Nothing previously reported is still open.')}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Rosters &amp; standing vacancies</h2><span class="count-chip">${rosterRoles.length}</span></div>
        <div class="empty-note">Standing opportunities, not single real-time openings — getting on a roster isn't a guarantee of a specific role.</div>
        ${rosterRoles.length ? rowsFor(rosterRoles) : emptyNote('No open rosters right now.')}
      </div>
      ${employerPanel()}
    </div>`;
}

function roleFilterBar(orgs) {
  return `
    <div class="filter-bar">
      <input type="search" id="rf-search" placeholder="Search saved jobs...">
      <select id="rf-fit">
        <option value="">All fit scores</option>
        <option value="9">9+ fit</option>
        <option value="7">7+ fit</option>
        <option value="4">4+ fit</option>
      </select>
      <select id="rf-org">
        <option value="">All organizations</option>
        ${orgs.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
      </select>
      <select id="rf-employment">
        <option value="">All employment types</option>
        <option value="full_time">Full-time</option>
        <option value="part_time">Part-time</option>
        <option value="contract">Contract</option>
        <option value="internship">Internship</option>
      </select>
      <select id="rf-sort">
        <option value="fit">Sort: fit score</option>
        <option value="org">Sort: organization</option>
        <option value="title">Sort: title</option>
      </select>
    </div>`;
}

// Filters/sorts by toggling visibility and reordering the already-rendered,
// already-bound .role-row elements — avoids regenerating HTML and re-binding
// click handlers on every keystroke.
function applyRoleFilters(root, roles) {
  const resultsEl = root.querySelector('#rf-results');
  const search = root.querySelector('#rf-search');
  const fit = root.querySelector('#rf-fit');
  const org = root.querySelector('#rf-org');
  const employment = root.querySelector('#rf-employment');
  const sort = root.querySelector('#rf-sort');
  if (!resultsEl || !search) return;
  const byId = Object.fromEntries(roles.map((r) => [r.id, r]));

  const run = () => {
    const q = (search.value || '').toLowerCase().trim();
    const minFit = fit.value ? Number(fit.value) : 0;
    const orgFilter = org.value;
    const employmentFilter = employment.value;
    const rows = Array.from(resultsEl.querySelectorAll('.role-row'));
    rows.forEach((rowEl) => {
      const r = byId[rowEl.dataset.roleId];
      if (!r) return;
      let ok = true;
      if (minFit && (r.fit_score || 0) < minFit) ok = false;
      if (orgFilter && r.org !== orgFilter) ok = false;
      if (employmentFilter && r.employment_type !== employmentFilter) ok = false;
      if (q && !`${r.title} ${r.org}`.toLowerCase().includes(q)) ok = false;
      rowEl.style.display = ok ? '' : 'none';
    });
    if (sort.value !== 'fit') {
      rows.sort((a, b) => {
        const ra = byId[a.dataset.roleId], rb = byId[b.dataset.roleId];
        if (!ra || !rb) return 0;
        if (sort.value === 'org') return (ra.org || '').localeCompare(rb.org || '');
        if (sort.value === 'title') return (ra.title || '').localeCompare(rb.title || '');
        return 0;
      });
      rows.forEach((r) => resultsEl.appendChild(r));
    }
  };
  [search, fit, org, employment, sort].forEach((el) => el.addEventListener('input', run));
}

async function renderSaved() {
  const roles = await api.get('/roles');
  const saved = roles.filter((r) => r.digest_status === 'saved').sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
  currentViewCount = saved.length;
  const orgs = [...new Set(saved.map((r) => r.org))].sort();

  const savedActions = `<button data-action="tailor-cv">${ICON_DOCUMENT}Tailor CV</button>
     <button data-action="reword">${ICON_PENCIL}Draft Cover Letter</button>
     <span class="role-actions-spacer"></span>
     <button data-action="mark-applied" class="action-positive">${ICON_CHECK}Mark Applied</button>
     <button data-action="closed" class="action-danger">${ICON_X}Remove</button>`;
  const rowsFor = (list) => list.map((r) => roleRow(r, savedActions)).join('');

  return `
    <div class="view-saved">
      ${roleFilterBar(orgs)}
      <div class="panel">
        <div class="panel-header"><h2>Saved jobs</h2><span class="count-chip">${saved.length}</span></div>
        <div id="rf-results">${saved.length ? rowsFor(saved) : emptyNote('Nothing saved yet — save a role from the Job digest tab.')}</div>
      </div>
    </div>`;
}

const APPLICATION_STATUSES = ['not_applied', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'];
const STATUS_LABELS = {
  not_applied: 'Saved, not yet applied', applied: 'Applied', interviewing: 'Interviewing',
  offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn',
};

function applicationRow(roleId, title, org, status, extra = '') {
  return `
    <div class="role-row" data-role-id="${esc(roleId)}">
      <div class="role-top">
        <div class="role-title-line">${ICON_BOOKMARK}<span class="role-title">${esc(title)}</span></div>
      </div>
      <div class="role-meta">${esc(org)}${extra}</div>
      <div class="role-actions">
        <select data-action="change-status">
          ${APPLICATION_STATUSES.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

async function renderApplications() {
  const [apps, roles] = await Promise.all([api.get('/applications'), api.get('/roles')]);
  const roleById = Object.fromEntries(roles.map((r) => [r.id, r]));
  const appByRoleId = Object.fromEntries(apps.map((a) => [a.role_id, a]));
  currentViewCount = apps.filter((a) => a.status !== 'not_applied').length;

  // "Saved, not yet applied" is every saved role that hasn't progressed past
  // not_applied — whether or not it has an application record at all, since
  // most saved roles never get one until Mark Applied (or this dropdown) is
  // actually used. The other status groups still come from real application
  // records only, same as before.
  const savedNotApplied = roles.filter((r) => {
    if (r.digest_status !== 'saved') return false;
    const app = appByRoleId[r.id];
    return !app || app.status === 'not_applied';
  });
  const notAppliedRows = savedNotApplied
    .map((r) => applicationRow(r.id, r.title, r.org, 'not_applied'))
    .join('');

  const otherGroups = APPLICATION_STATUSES.filter((s) => s !== 'not_applied').map((status) => {
    const inGroup = apps.filter((a) => a.status === status);
    const rows = inGroup
      .map((a) => {
        const role = roleById[a.role_id];
        const title = role ? role.title : '(role no longer in roles.json)';
        const org = role ? role.org : '';
        const extra = `${a.next_step ? ` · Next: ${esc(a.next_step)}` : ''}${a.next_step_date ? ` (${esc(a.next_step_date)})` : ''}`;
        return applicationRow(a.role_id, title, org, status, extra);
      })
      .join('');
    return `
      <div class="panel">
        <div class="panel-header"><h2>${STATUS_LABELS[status]}</h2><span class="count-chip">${inGroup.length}</span></div>
        ${inGroup.length ? rows : emptyNote('Nothing here.')}
      </div>`;
  });

  return `<div class="view-applications">
    <div class="panel">
      <div class="panel-header"><h2>${STATUS_LABELS.not_applied}</h2><span class="count-chip">${savedNotApplied.length}</span></div>
      ${savedNotApplied.length ? notAppliedRows : emptyNote('Nothing here.')}
    </div>
    ${otherGroups.join('')}
  </div>`;
}

const STYLE_PRESETS = [
  { label: 'Formal & polished', text: 'Keep the tone formal and polished — traditional structure, no contractions, precise institutional language.' },
  { label: 'Warm & personal', text: 'Keep the tone warm and personal — conversational but professional, first-person stories welcome.' },
  { label: 'Confident & direct', text: 'Keep the tone confident and direct — short sentences, lead with impact and results, no hedging.' },
  { label: 'Storytelling', text: 'Favor a narrative structure — open with a specific moment or anecdote before connecting it to the role.' },
  { label: 'Concise & data-driven', text: 'Keep it concise and data-driven — lead with metrics and outcomes, minimal narrative framing.' },
];

function fmtDocDate(mtime) {
  return new Date(mtime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function renderCvLetters() {
  const [files, roles, style, documents] = await Promise.all([
    api.get('/files'),
    api.get('/roles'),
    api.get('/style-guidance'),
    api.get('/documents'),
  ]);
  const candidates = roles.filter((r) => r.digest_status === 'saved');
  currentViewCount = null;

  const documentRows = documents
    .map(
      (d) => `
      <div class="role-row" data-role-id="doc:${esc(d.filename)}" style="padding:12px 16px;">
        <div class="role-top" style="align-items:center;">
          <div class="role-title-line">
            ${d.folder === 'tailor-cv' ? ICON_DOCUMENT : ICON_PENCIL}
            <span class="role-title" style="font-size:14px;">${esc(d.filename)}</span>
          </div>
          <span class="role-meta" style="margin:0;">${fmtDocDate(d.mtime)}</span>
        </div>
        <div class="role-actions" style="margin-top:10px;">
          <button type="button" class="draft-open-btn" data-open-url="${esc(d.openUrl)}">Open file</button>
          <a href="${esc(d.downloadUrl)}" target="_blank" rel="noopener">Download</a>
          <button type="button" class="doc-remove-btn action-danger" data-delete-url="${esc(d.deleteUrl)}">${ICON_X}Remove</button>
        </div>
      </div>`
    )
    .join('');

  const checkIcon = '<svg class="check" viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>';
  const fileChips = (list) => (list.length ? list.map((f) => `<span class="file-chip">${checkIcon}${esc(f)}</span>`).join('') : '<span class="empty-note" style="display:inline-block">None uploaded yet</span>');

  const roleOptions = candidates
    .map((r) =>
      roleRow(
        r,
        `<button data-action="tailor-cv">${ICON_DOCUMENT}Tailor CV</button>
         <button data-action="reword">${ICON_PENCIL}Draft Cover Letter</button>
         <span class="role-actions-spacer"></span>
         <button data-action="mark-applied" class="action-positive">${ICON_CHECK}Mark Applied</button>
         <button data-action="closed" class="action-danger">${ICON_X}Remove</button>`
      )
    )
    .join('');

  return `
    <div class="view-cv-letters">
    <div class="panel">
      <div class="panel-header"><h2>Your documents</h2></div>
      <div class="field"><label>CV</label>${fileChips(files.cvFiles)}</div>
      <div class="field"><label>Cover-letter examples</label>${fileChips(files.letterFiles)}</div>
      <form id="upload-more-form" style="display:flex; gap:10px; align-items:center; margin-top:10px;">
        <input type="file" name="cv" id="upload-cv" style="display:none" accept=".docx,.doc,.pdf,.md,.xlsx,.xls,image/*">
        <input type="file" name="coverLetter" id="upload-letter" style="display:none" accept=".docx,.doc,.pdf,.md,.xlsx,.xls,image/*">
        <button type="button" class="btn" id="upload-cv-btn">Upload CV</button>
        <button type="button" class="btn" id="upload-letter-btn">Upload cover letter</button>
      </form>
    </div>
    <div class="panel">
      <div class="panel-header"><h2>Additional style guidance</h2></div>
      <p class="screen-subtitle" style="margin-bottom:14px;">Pick a starting point or write your own — this guides every drafted cover letter, alongside your uploaded examples.</p>
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        ${STYLE_PRESETS.map((p, i) => `<button type="button" class="btn" data-preset="${i}">${esc(p.label)}</button>`).join('')}
      </div>
      <div class="field">
        <textarea id="style-guidance-field" placeholder="e.g. Keep it under one page, avoid buzzwords, always mention multilingual experience...">${esc(style.guidance === '(none set)' ? '' : style.guidance)}</textarea>
      </div>
      <button class="btn primary" id="style-guidance-save">Save style guidance</button>
    </div>
    <div class="panel">
      <div class="panel-header"><h2>Work on a saved role</h2></div>
      ${candidates.length ? roleOptions : emptyNote('Save a role from the Job digest tab first.')}
    </div>
    <div class="panel">
      <div class="panel-header"><h2>Generated documents</h2><span class="count-chip">${documents.length}</span></div>
      <p class="screen-subtitle" style="margin-bottom:10px;">Every tailored CV and cover letter you've generated — reopen one for a different job without regenerating it.</p>
      ${documents.length ? documentRows : emptyNote('Nothing generated yet.')}
    </div>
    </div>`;
}

function employerPanel() {
  return `
    <div class="panel">
      <div class="panel-header"><h2>Add an employer</h2></div>
      <p class="screen-subtitle" style="margin-bottom:14px;">Type a name, or drop a screenshot — the server resolves it and adds it to your priority list.</p>
      <div class="field-row">
        <div class="field" style="margin-bottom:0"><input type="text" id="employer-name" placeholder="Organization name"></div>
        <div class="field" style="margin-bottom:0; display:flex; gap:10px;">
          <button class="btn" id="employer-add-btn">Add</button>
          <label class="btn" style="cursor:pointer;">Upload screenshot<input type="file" id="employer-screenshot" accept="image/*" style="display:none"></label>
        </div>
      </div>
      <div id="employer-result" class="empty-note" style="display:none; margin-top:10px;"></div>
    </div>`;
}

// ---- Priority-employers markdown <-> structured list, shared with the
// setup wizard's step-4 format (see wizard.js) so both read/write the same shape.
function parseEmployersMarkdown(md) {
  const lines = (md || '').split('\n');
  let intro = '';
  const groups = [];
  let current = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(.*)/);
    const item = line.match(/^-\s*(.+?)\s*—\s*(\S+.*)$/);
    if (h) {
      current = { category: h[1].trim(), items: [] };
      groups.push(current);
    } else if (item && current) {
      current.items.push({ name: item[1].trim(), url: item[2].trim() });
    } else if (!current && line.trim()) {
      intro += (intro ? '\n' : '') + line;
    }
  }
  return { intro, groups };
}

function serializeEmployersMarkdown(intro, groups) {
  const lines = [];
  if (intro) lines.push(intro, '');
  for (const g of groups) {
    const checked = g.items.filter((i) => i.checked);
    if (!checked.length) continue;
    lines.push(`### ${g.category}`, ...checked.map((i) => `- ${i.name} — ${i.url}`), '');
  }
  return lines.join('\n').trim();
}

function employerRow(name, url) {
  return `
    <label style="display:flex; align-items:center; gap:10px; padding:6px 0; font-weight:500; cursor:pointer;">
      <input type="checkbox" data-employer-name="${esc(name)}" data-employer-url="${esc(url)}" checked style="width:16px; height:16px; flex:none;">
      <span>${esc(name)} <span style="opacity:.7; font-size:12px;">— ${esc(url)}</span></span>
    </label>`;
}

async function renderProfile() {
  const [prefs, settings] = await Promise.all([api.get('/setup/preferences'), api.get('/settings')]);
  const parsed = parseEmployersMarkdown(prefs.employers || '');

  const groupsHtml = parsed.groups
    .map((g) => `<div class="field" data-category="${esc(g.category)}">
        <label>${esc(g.category)}</label>${g.items.map((i) => employerRow(i.name, i.url)).join('')}
      </div>`)
    .join('');

  return `
    <div class="view-profile">
      <div class="panel">
        <div class="panel-header"><h2>Targets</h2></div>
        <div class="field">
          <label>Background (years, sectors, current/prior roles)</label>
          <textarea id="pf-background">${esc(prefs.background)}</textarea>
          <button type="button" class="btn" id="pf-redraft-background" style="margin-top:10px;">Redraft from CV</button>
        </div>
        <div class="field"><label>Target roles and levels</label><textarea id="pf-target">${esc(prefs.target)}</textarea></div>
        <div class="field">
          <label>Locations (one per line)</label>
          <textarea id="pf-locations">${esc((prefs.locations || []).join('\n'))}</textarea>
          <div class="hint">All locations are searched every time — this just sets the default order results are shown in.</div>
        </div>
        <div class="field-row">
          <div class="field"><label>Pay floor</label><input type="text" inputmode="numeric" id="pf-pay-floor" value="${esc(formatThousands(prefs.payFloor))}"></div>
          <div class="field"><label>Pay goal</label><input type="text" inputmode="numeric" id="pf-pay-goal" value="${esc(formatThousands(prefs.payGoal))}"></div>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
          <button class="btn primary" id="pf-save-targets">Save changes</button>
        </div>
      </div>
      <div class="panel schedule-panel">
        <div class="panel-header"><h2>Schedule</h2></div>
        <div class="field-row">
          <div class="field">
            <label>Frequency</label>
            <select id="pf-frequency">
              <option value="daily" ${settings.frequency === 'daily' ? 'selected' : ''}>Daily</option>
              <option value="every-3-days" ${settings.frequency === 'every-3-days' ? 'selected' : ''}>Every 3 days</option>
              <option value="weekly" ${settings.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
            </select>
          </div>
          <div class="field">
            <label>Time of day</label>
            <input type="time" id="pf-time" value="${esc(settings.time_of_day || '06:00')}">
          </div>
        </div>
        <p class="hint">A thorough run checks every priority employer and aggregator and typically takes 10-15+ minutes of real Claude Code activity. On a subscription plan this draws from the same usage pool as your regular Claude Code sessions, not a separate bill.</p>
        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
          <button class="btn primary" id="pf-save-schedule">Save changes</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Priority employers</h2></div>
        <p class="screen-subtitle" style="margin-bottom:14px;">Turn off anything irrelevant, and add your own by name or careers-page URL.</p>
        <div class="field-row" style="margin-bottom:10px;">
          <input type="text" id="pf-add-employer" placeholder="Organization name or careers URL" style="flex:1;">
        </div>
        <button type="button" class="btn" id="pf-add-employer-btn" style="width:100%; margin-bottom:20px;">Add</button>
        <div id="pf-employers">${groupsHtml}</div>
        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button class="btn primary" id="pf-save-employers">Save changes</button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- Router

const VIEWS = {
  home: { title: 'Home', render: renderHome },
  digest: { title: 'Job digest', render: renderDigest },
  saved: { title: 'Saved jobs', render: renderSaved },
  applications: { title: 'Applications', render: renderApplications },
  'cv-letters': { title: 'CV and Cover Letters', render: renderCvLetters },
  profile: { title: 'Profile & preferences', render: renderProfile },
};

let currentViewCount = null;

async function navigate(view) {
  if (!VIEWS[view]) view = 'home';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.getElementById('topbar-title').textContent = VIEWS[view].title;
  const main = document.getElementById('main');
  main.innerHTML = '<div class="empty-note">Loading…</div>';
  currentViewCount = null;
  main.innerHTML = await VIEWS[view].render();
  bindViewActions(main, view);
  const countEl = document.getElementById('topbar-count');
  if (currentViewCount == null) {
    countEl.hidden = true;
  } else {
    countEl.hidden = false;
    countEl.textContent = `${currentViewCount} ${currentViewCount === 1 ? 'job' : 'jobs'}`;
  }
}

window.addEventListener('hashchange', () => navigate(location.hash.replace('#/', '') || 'home'));

// ---------------------------------------------------------------- Actions

function bindViewActions(root, view) {
  root.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => (location.hash = `#/${el.dataset.nav}`));
  });

  if (view === 'saved' && root.querySelector('#rf-search')) {
    api.get('/roles').then((roles) => applyRoleFilters(root, roles.filter((r) => r.digest_status === 'saved')));
  }

  if (view === 'digest' && root.querySelector('#digest-group-filter')) {
    Promise.all([api.get('/roles'), api.get('/employer-groups')]).then(([roles, employerGroups]) =>
      applyDigestFilters(root, roles, employerGroups)
    );
  }

  root.querySelectorAll('.role-row [data-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const row = btn.closest('.role-row');
      const roleId = row?.dataset.roleId;
      const action = btn.dataset.action;

      if (action === 'save') await api.post(`/roles/${encodeURIComponent(roleId)}/status`, { status: 'saved' });
      if (action === 'not_qualifying') await api.post(`/roles/${encodeURIComponent(roleId)}/status`, { status: 'not_qualifying' });
      if (action === 'closed') await api.post(`/roles/${encodeURIComponent(roleId)}/status`, { status: 'closed' });
      if (action === 'mark-applied') {
        const isApplied = btn.classList.contains('is-applied');
        await api.post('/applications', { roleId, status: isApplied ? 'not_applied' : 'applied' });
        btn.classList.toggle('is-applied', !isApplied);
        return;
      }
      if (action === 'goto-letter') { location.hash = '#/cv-letters'; return; }
      if (action === 'reword' || action === 'tailor-cv') {
        // Fire-and-forget: the job lives in cvJobs (keyed by role), not in
        // this button/row, so it keeps running — and keeps showing progress
        // on whichever page you're on — even if you navigate away and back,
        // or to a different view that also lists this same role.
        launchCvJob(action, roleId);
        const out = row.querySelector('.draft-output');
        out.style.display = 'block';
        out.innerHTML = draftOutputContent(roleId);
        return;
      }
      navigate(view);
    });
  });

  root.querySelectorAll('[data-action="change-status"]').forEach((select) => {
    select.addEventListener('change', async () => {
      const roleId = select.closest('.role-row').dataset.roleId;
      await api.post('/applications', { roleId, status: select.value });
      navigate('applications');
    });
  });

  if (view === 'digest') {
    const nameInput = root.querySelector('#employer-name');
    const addBtn = root.querySelector('#employer-add-btn');
    const screenshotInput = root.querySelector('#employer-screenshot');
    const resultBox = root.querySelector('#employer-result');

    const showResult = (text) => { resultBox.style.display = 'block'; resultBox.textContent = text; };

    addBtn?.addEventListener('click', async () => {
      if (!nameInput.value.trim()) return;
      showResult('Resolving…');
      const { result, error } = await api.post('/employers', { name: nameInput.value.trim() });
      showResult(error ? `Could not add: ${error}` : result);
      nameInput.value = '';
    });

    screenshotInput?.addEventListener('change', async () => {
      const file = screenshotInput.files[0];
      if (!file) return;
      showResult('Reading screenshot…');
      const fd = new FormData();
      fd.append('screenshot', file);
      const { result, error } = await api.postForm('/employers', fd);
      showResult(error ? `Could not add: ${error}` : result);
      screenshotInput.value = '';
    });
  }

  if (view === 'cv-letters') {
    const bindUpload = (btnId, inputId, field) => {
      const btn = root.querySelector(`#${btnId}`);
      const input = root.querySelector(`#${inputId}`);
      btn?.addEventListener('click', () => input.click());
      input?.addEventListener('change', async () => {
        if (!input.files.length) return;
        const fd = new FormData();
        for (const f of input.files) fd.append(field, f);
        await api.postForm('/files', fd);
        navigate('cv-letters');
      });
    };
    bindUpload('upload-cv-btn', 'upload-cv', 'cv');
    bindUpload('upload-letter-btn', 'upload-letter', 'coverLetter');

    const styleField = root.querySelector('#style-guidance-field');
    root.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = STYLE_PRESETS[btn.dataset.preset].text;
        styleField.value = styleField.value.trim() ? `${styleField.value.trim()}\n${text}` : text;
      });
    });
    root.querySelector('#style-guidance-save').addEventListener('click', async () => {
      const btn = root.querySelector('#style-guidance-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      await api.post('/style-guidance', { guidance: styleField.value });
      btn.disabled = false;
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save style guidance'; }, 2000);
    });
  }

  if (view === 'profile') {
    bindThousandsInput(root.querySelector('#pf-pay-floor'));
    bindThousandsInput(root.querySelector('#pf-pay-goal'));

    root.querySelector('#pf-redraft-background').addEventListener('click', async () => {
      const btn = root.querySelector('#pf-redraft-background');
      const field = root.querySelector('#pf-background');
      btn.disabled = true;
      btn.textContent = 'Reading your CV…';
      const { background, error, note } = await api.post('/setup/generate-background');
      btn.disabled = false;
      btn.textContent = 'Redraft from CV';
      if (background) field.value = background;
      else alert(error || note || 'Could not redraft from your CV.');
    });
    const employersBox = root.querySelector('#pf-employers');

    root.querySelector('#pf-add-employer-btn').addEventListener('click', () => {
      const input = root.querySelector('#pf-add-employer');
      const value = input.value.trim();
      if (!value) return;
      let name = value;
      let url = '(search for current openings)';
      if (/^https?:\/\//i.test(value)) {
        url = value;
        try { name = new URL(value).hostname.replace(/^www\./, ''); } catch { /* keep raw value as name */ }
      }
      let customField = employersBox.querySelector('[data-category="Your additions"]');
      if (!customField) {
        customField = document.createElement('div');
        customField.className = 'field';
        customField.dataset.category = 'Your additions';
        customField.innerHTML = '<label>Your additions</label>';
        employersBox.prepend(customField);
      }
      customField.insertAdjacentHTML('beforeend', employerRow(name, url));
      input.value = '';
    });

    const flashSaved = (btn) => {
      btn.disabled = false;
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save changes'; }, 2000);
    };

    root.querySelector('#pf-save-targets').addEventListener('click', async () => {
      const btn = root.querySelector('#pf-save-targets');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const locations = root.querySelector('#pf-locations').value.split('\n').map((s) => s.trim()).filter(Boolean);
      await api.post('/setup/preferences', {
        background: root.querySelector('#pf-background').value,
        target: root.querySelector('#pf-target').value,
        locations,
        payFloor: unformatThousands(root.querySelector('#pf-pay-floor').value),
        payGoal: unformatThousands(root.querySelector('#pf-pay-goal').value),
      });
      flashSaved(btn);
    });

    root.querySelector('#pf-save-schedule').addEventListener('click', async () => {
      const btn = root.querySelector('#pf-save-schedule');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      await api.post('/settings', {
        frequency: root.querySelector('#pf-frequency').value,
        time_of_day: root.querySelector('#pf-time').value,
      });
      refreshFreshness();
      flashSaved(btn);
    });

    root.querySelector('#pf-save-employers').addEventListener('click', async () => {
      const btn = root.querySelector('#pf-save-employers');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      const groups = Array.from(employersBox.querySelectorAll('[data-category]')).map((field) => ({
        category: field.dataset.category,
        items: Array.from(field.querySelectorAll('input[type=checkbox]'))
          .filter((cb) => cb.checked)
          .map((cb) => ({ name: cb.dataset.employerName, url: cb.dataset.employerUrl, checked: true })),
      }));
      const employers = serializeEmployersMarkdown('', groups);
      await api.post('/setup/preferences', { employers });
      flashSaved(btn);
    });
  }
}

// ---------------------------------------------------------------- Freshness / run-now

async function refreshFreshness() {
  const settings = await api.get('/settings');
  const text = document.getElementById('freshness-text');
  const footer = document.getElementById('sidebar-footer');
  const label = settings.last_run
    ? `Updated ${new Date(settings.last_run).toLocaleString()}`
    : 'Not run yet';
  text.textContent = label;
  footer.textContent = `Refreshes ${settings.frequency || 'daily'}`;
}

const RUN_NOW_ICON = '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z"/></svg>';

document.getElementById('run-now-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Starting…';
  await api.post('/run-now');

  let startedAt = Date.now();
  let lastDurationMs = null;
  let lastStatusCheck = 0;

  const timer = setInterval(async () => {
    const now = Date.now();
    if (now - lastStatusCheck >= 3000) {
      lastStatusCheck = now;
      const status = await api.get('/run-now/status');
      if (!status.running) {
        clearInterval(timer);
        btn.disabled = false;
        btn.innerHTML = `${RUN_NOW_ICON}Run now`;
        refreshFreshness();
        navigate(location.hash.replace('#/', '') || 'home');
        return;
      }
      if (status.startedAt) startedAt = status.startedAt;
      lastDurationMs = status.lastDurationMs;
    }
    const elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const elapsedLabel = mins ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
    const estimateLabel = lastDurationMs ? ` (usually ~${Math.max(1, Math.round(lastDurationMs / 60000))}m)` : '';
    btn.textContent = `Running… ${elapsedLabel}${estimateLabel}`;
  }, 1000);
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  navigate(location.hash.replace('#/', '') || 'home');
});

// ---------------------------------------------------------------- Browse before signup

async function showBrowsePreview() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('browse-preview').hidden = false;
  const main = document.getElementById('browse-main');
  main.innerHTML = emptyNote('Checking live boards for currently open roles…');

  const { roles, employerCount, totalOpenRoles, note, error } = await api.get('/preview/roles');
  if (error) {
    main.innerHTML = emptyNote(`Could not load a preview: ${error}`);
    return;
  }

  const rows = roles.map((r) => roleRow(r, '')).join('');
  main.innerHTML = `
    <p class="screen-subtitle" style="margin-bottom:18px;">
      Live roles from ${employerCount} employers with real board integrations (of ${totalOpenRoles} total openings).
      ${esc(note || '')} Set up your profile to search the full sector and get these scored against your real CV.
    </p>
    <div class="panel">
      <div class="panel-header"><h2>Open roles right now</h2><span class="count-chip">${roles.length}</span></div>
      ${roles.length ? rows : emptyNote('Nothing matched right now — check back later, or set up your profile for full sector search.')}
    </div>`;
}

document.getElementById('browse-setup-btn').addEventListener('click', () => {
  document.getElementById('browse-preview').hidden = true;
  document.getElementById('wizard').hidden = false;
});

// ---------------------------------------------------------------- Theme

function applyThemeIcon(theme) {
  const toggle = document.getElementById('theme-toggle');
  const sun = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  // Show the icon for the mode a click would switch TO, not the current one.
  sun.hidden = theme !== 'dark';
  moon.hidden = theme === 'dark';
  toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('job-digest-theme', next);
  applyThemeIcon(next);
});

applyThemeIcon(document.documentElement.getAttribute('data-theme'));

// ---------------------------------------------------------------- Boot

async function boot() {
  const status = await api.get('/status');
  if (!status.setupComplete) {
    document.getElementById('wizard').hidden = false;
    import('./wizard.js').then((m) => m.startWizard(() => {
      document.getElementById('wizard').hidden = true;
      document.getElementById('shell').hidden = false;
      refreshFreshness();
      navigate('home');
    }));
    return;
  }
  document.getElementById('shell').hidden = false;
  refreshFreshness();
  navigate(location.hash.replace('#/', '') || 'home');
}

boot();
