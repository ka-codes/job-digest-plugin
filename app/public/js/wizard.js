// First-run setup wizard. Writes profile.md and settings.json as the user
// goes, step by step, rather than hand-editing files.

const api = {
  get: (path) => fetch(`/api${path}`).then((r) => r.json()),
  post: (path, body) =>
    fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()),
  postForm: (path, formData) => fetch(`/api${path}`, { method: 'POST', body: formData }).then((r) => r.json()),
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

const DEFAULT_WORKSPACE = (() => {
  // Best guess at a sensible default — the user can override it.
  return '';
})();

export function startWizard(onComplete) {
  const root = document.getElementById('wizard-content');
  const state = { step: 0, totalSteps: 7, cvFiles: [], letterFiles: [] };

  // ---- Priority-employers markdown <-> structured list, for step 4 ----
  function parseEmployersMarkdown(md) {
    // Windows-built releases can ship this file with \r\n line endings
    // (confirmed: a GitHub Actions Windows-runner checkout converted it,
    // even though the repo itself has \n) — a trailing \r breaks the item
    // regex's `$` anchor on every line except the last, so only the final
    // employer in the whole list ever parsed. Normalize defensively here
    // regardless of what produced the line endings upstream.
    const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
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

  function progress() {
    return `<div class="wizard-progress">Step ${state.step + 1} of ${state.totalSteps}</div>`;
  }

  function actions(backDisabled, nextLabel, nextHandler) {
    return `
      <div class="wizard-actions">
        <button class="btn" id="wiz-back" ${backDisabled ? 'disabled' : ''}>Back</button>
        <button class="btn primary" id="wiz-next">${nextLabel}</button>
      </div>`;
  }

  async function renderStep0() {
    root.innerHTML = `
      ${progress()}
      <div class="wizard-step">
        <h1>Checking for Claude Code</h1>
        <p class="lead">DevJob Digest does all its AI work — job search, fit scoring, tailored CVs and cover letters — through Claude Code, installed and signed in with your own account. Checking…</p>
        <div class="hint" id="wiz-claude-status">Checking…</div>
      </div>
      ${actions(true, 'Continue')}`;

    const nextBtn = document.getElementById('wiz-next');
    const statusEl = document.getElementById('wiz-claude-status');
    nextBtn.disabled = true;

    async function check() {
      statusEl.textContent = 'Checking…';
      const result = await api.get('/setup/check-claude');
      if (result.installed) {
        statusEl.textContent = `✓ Found Claude Code (${result.version})`;
        nextBtn.disabled = false;
      } else {
        statusEl.innerHTML = `Claude Code wasn't found on this computer. Install it from
          <a href="https://docs.claude.com/en/docs/claude-code" target="_blank" rel="noopener">claude.com/claude-code</a>,
          sign in with your Claude account, then recheck.
          <button type="button" class="btn" id="wiz-claude-recheck" style="margin-top:10px;">Recheck</button>`;
        document.getElementById('wiz-claude-recheck').addEventListener('click', check);
        nextBtn.disabled = true;
      }
    }
    check();

    document.getElementById('wiz-next').addEventListener('click', () => {
      state.step = 1;
      renderStep1();
    });
  }

  async function renderStep1() {
    root.innerHTML = `
      ${progress()}
      <div class="wizard-step">
        <h1>Welcome</h1>
        <p class="lead">Set up your profile for scheduled job scraping matched to your CV and CV/cover letter writing support, or just see what's available right now.</p>
        <button type="button" class="btn" id="wiz-browse-first" style="width:100%; margin-bottom:22px; height:48px;">Show me what's available →</button>
        <div class="field">
          <label>Workspace folder path</label>
          <div style="display:flex; gap:10px;">
            <input type="text" id="wiz-workspace" placeholder="C:\\Users\\you\\job-search-private" style="flex:1;">
            <button type="button" class="btn" id="wiz-browse">Browse…</button>
          </div>
          <div class="hint" id="wiz-folder-status">Create a folder automatically if it doesn't exist yet — your private data (profile, CV, tracked roles) lives here, outside this app, never shared.</div>
          <button type="button" class="btn" id="wiz-create-folder" style="width:100%; margin-top:10px;">Create</button>
        </div>
      </div>
      ${actions(false, 'Continue')}`;

    document.getElementById('wiz-back').addEventListener('click', () => { state.step = 0; renderStep0(); });

    const nextBtn = document.getElementById('wiz-next');
    const pathInput = document.getElementById('wiz-workspace');
    const createBtn = document.getElementById('wiz-create-folder');
    nextBtn.disabled = true; // explicit: Continue only unlocks once the folder step is actually done

    function updateCreateLabel() {
      createBtn.textContent = pathInput.value.trim() ? 'Use This Folder' : 'Create';
    }
    pathInput.addEventListener('input', updateCreateLabel);
    updateCreateLabel();

    document.getElementById('wiz-browse-first').addEventListener('click', () => {
      window.showBrowsePreview();
    });

    document.getElementById('wiz-browse').addEventListener('click', async () => {
      const btn = document.getElementById('wiz-browse');
      btn.disabled = true;
      btn.textContent = 'Choose…';
      const { path } = await api.post('/setup/browse-folder');
      btn.disabled = false;
      btn.textContent = 'Browse…';
      if (path) {
        pathInput.value = path;
        updateCreateLabel();
      }
    });

    createBtn.addEventListener('click', async () => {
      const status = document.getElementById('wiz-folder-status');
      status.style.color = '';
      pathInput.style.borderColor = '';
      createBtn.disabled = true;

      let path = pathInput.value.trim();
      if (!path) {
        // Nothing typed/browsed — propose a sensible default instead of
        // making the user go find one themselves.
        createBtn.textContent = 'Proposing a folder…';
        const suggestion = await api.get('/setup/suggested-path');
        path = suggestion.path;
        pathInput.value = path;
      }

      createBtn.textContent = 'Creating…';
      status.textContent = `Creating ${path}…`;
      await api.post('/setup/workspace', { path });
      createBtn.disabled = false;
      createBtn.textContent = '✓ Folder set';
      createBtn.classList.add('success');
      status.textContent = `✓ Folder ready at ${path}`;
      nextBtn.disabled = false;
      setTimeout(() => { createBtn.classList.remove('success'); updateCreateLabel(); }, 1500);
    });

    document.getElementById('wiz-next').addEventListener('click', async () => {
      state.step = 2;
      renderStep2();
    });
  }

  async function renderStep2() {
    root.innerHTML = `
      ${progress()}
      <div class="wizard-step">
        <h1>Your documents</h1>
        <p class="lead">Upload your CV (required) and an example cover letter (optional, for voice and style).</p>
        <div class="field">
          <label>CV</label>
          <div class="upload-box" id="cv-box">Click to choose a file (Word, PDF, Excel, Markdown, or a screenshot)</div>
          <input type="file" id="wiz-cv" accept=".docx,.doc,.pdf,.md,.xlsx,.xls,image/*" style="display:none">
          <div id="cv-chip"></div>
        </div>
        <div class="field">
          <label>Cover-letter example (optional)</label>
          <div class="upload-box" id="letter-box">Click to choose a file</div>
          <input type="file" id="wiz-letter" accept=".docx,.doc,.pdf,.md,.xlsx,.xls,image/*" style="display:none">
          <div id="letter-chip"></div>
        </div>
      </div>
      ${actions(false, 'Continue')}`;

    const cvInput = document.getElementById('wiz-cv');
    const letterInput = document.getElementById('wiz-letter');
    document.getElementById('cv-box').addEventListener('click', () => cvInput.click());
    document.getElementById('letter-box').addEventListener('click', () => letterInput.click());
    const checkIcon = '<svg class="check" viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>';
    cvInput.addEventListener('change', () => {
      document.getElementById('cv-chip').innerHTML = cvInput.files[0] ? `<span class="file-chip">${checkIcon}${cvInput.files[0].name}</span>` : '';
    });
    letterInput.addEventListener('change', () => {
      document.getElementById('letter-chip').innerHTML = letterInput.files[0] ? `<span class="file-chip">${checkIcon}${letterInput.files[0].name}</span>` : '';
    });

    document.getElementById('wiz-back').addEventListener('click', () => { state.step = 1; renderStep1(); });
    document.getElementById('wiz-next').addEventListener('click', async () => {
      if (!cvInput.files.length) { cvInput.focus(); return; }
      const btn = document.getElementById('wiz-next');
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      const fd = new FormData();
      fd.append('cv', cvInput.files[0]);
      if (letterInput.files[0]) fd.append('coverLetter', letterInput.files[0]);
      await api.postForm('/setup/upload', fd);
      state.step = 3;
      renderStep3();
    });
  }

  async function renderStep3() {
    root.innerHTML = `
      ${progress()}
      <div class="wizard-step">
        <h1>Your targets</h1>
        <p class="lead">Background, role levels, and locations — this drives fit scoring and ordering.</p>
        <div class="field">
          <label>Background (years, sectors, current/prior roles)</label>
          <textarea id="wiz-background" placeholder="17 years in international development..." disabled></textarea>
          <div class="hint" id="wiz-background-hint">Reading your CV to draft this…</div>
        </div>
        <div class="field"><label>Target roles and levels</label><textarea id="wiz-target" placeholder="Director, Senior Director, Program Director..."></textarea></div>
        <div class="field">
          <label>Locations (one per line)</label>
          <textarea id="wiz-locations" placeholder="Washington DC\nNew York\nRemote"></textarea>
          <div class="hint">All locations are searched every time — this just sets the default order results are shown in.</div>
        </div>
        <div class="field-row">
          <div class="field"><label>Pay floor</label><input type="text" inputmode="numeric" id="wiz-pay-floor" placeholder="200,000"></div>
          <div class="field"><label>Pay goal</label><input type="text" inputmode="numeric" id="wiz-pay-goal" placeholder="250,000"></div>
        </div>
      </div>
      ${actions(false, 'Continue')}`;

    bindThousandsInput(document.getElementById('wiz-pay-floor'));
    bindThousandsInput(document.getElementById('wiz-pay-goal'));

    const bgField = document.getElementById('wiz-background');
    const bgHint = document.getElementById('wiz-background-hint');
    const bgReady = api.post('/setup/generate-background').then(({ background, error }) => {
      bgField.disabled = false;
      bgField.value = !error && background ? background : '';
      bgHint.textContent = !error && background
        ? 'Drafted from your CV — edit as needed.'
        : (error ? `Could not auto-draft: ${error}` : "Couldn't read your CV yet — write your own.");
    });

    document.getElementById('wiz-back').addEventListener('click', () => { state.step = 2; renderStep2(); });
    document.getElementById('wiz-next').addEventListener('click', async () => {
      const btn = document.getElementById('wiz-next');
      btn.disabled = true;
      btn.textContent = bgField.disabled ? 'Finishing CV summary…' : 'Saving…';
      await bgReady; // never save the "still loading" placeholder as a real background
      btn.textContent = 'Saving…';
      const locations = document.getElementById('wiz-locations').value.split('\n').map((s) => s.trim()).filter(Boolean);
      await api.post('/setup/preferences', {
        background: bgField.value,
        target: document.getElementById('wiz-target').value,
        locations,
        payFloor: unformatThousands(document.getElementById('wiz-pay-floor').value),
        payGoal: unformatThousands(document.getElementById('wiz-pay-goal').value),
      });
      state.step = 4;
      renderStep4();
    });
  }

  async function renderStep4() {
    const defaults = await api.get('/setup/defaults');
    const parsed = parseEmployersMarkdown(defaults.employers || '');
    parsed.groups.forEach((g) => g.items.forEach((i) => (i.checked = true)));
    const customGroup = { category: 'Your additions', items: [] };

    function row(name, url, checkedAttr, dataAttr) {
      return `
        <label style="display:flex; align-items:center; gap:10px; padding:6px 0; font-weight:500; cursor:pointer;">
          <input type="checkbox" ${dataAttr} ${checkedAttr} style="width:16px; height:16px; flex:none;">
          <span>${esc(name)} <span style="opacity:.7; font-size:12px;">— ${esc(url)}</span></span>
        </label>`;
    }

    function render() {
      const customHtml = customGroup.items.length
        ? `<div class="field"><label>Your additions</label>${customGroup.items
            .map((item, ii) => row(item.name, item.url, item.checked ? 'checked' : '', `data-custom="${ii}"`))
            .join('')}</div>`
        : '';
      const groupsHtml = parsed.groups
        .map(
          (g, gi) =>
            `<div class="field"><label>${esc(g.category)}</label>${g.items
              .map((item, ii) => row(item.name, item.url, item.checked ? 'checked' : '', `data-group="${gi}" data-item="${ii}"`))
              .join('')}</div>`
        )
        .join('');

      root.innerHTML = `
        ${progress()}
        <div class="wizard-step">
          <h1>Priority employers</h1>
          <p class="lead">Turn off anything irrelevant, and add your own by name or careers-page URL.</p>
          <div class="field-row" style="margin-bottom:10px;">
            <input type="text" id="wiz-add-employer" placeholder="Organization name or careers URL" style="flex:1;">
          </div>
          <button type="button" class="btn" id="wiz-add-employer-btn" style="width:100%; margin-bottom:20px;">Add</button>
          ${customHtml}
          ${groupsHtml}
        </div>
        ${actions(false, 'Continue')}`;
      bind();
    }

    function bind() {
      document.getElementById('wiz-back').addEventListener('click', () => { state.step = 3; renderStep3(); });

      document.querySelectorAll('input[type=checkbox][data-group]').forEach((cb) => {
        cb.addEventListener('change', () => {
          parsed.groups[cb.dataset.group].items[cb.dataset.item].checked = cb.checked;
        });
      });
      document.querySelectorAll('input[type=checkbox][data-custom]').forEach((cb) => {
        cb.addEventListener('change', () => { customGroup.items[cb.dataset.custom].checked = cb.checked; });
      });

      document.getElementById('wiz-add-employer-btn').addEventListener('click', () => {
        const input = document.getElementById('wiz-add-employer');
        const value = input.value.trim();
        if (!value) return;
        let name = value;
        let url = '(search for current openings)';
        if (/^https?:\/\//i.test(value)) {
          url = value;
          try { name = new URL(value).hostname.replace(/^www\./, ''); } catch { /* keep raw value as name */ }
        }
        customGroup.items.push({ name, url, checked: true });
        render();
      });

      document.getElementById('wiz-next').addEventListener('click', async () => {
        const btn = document.getElementById('wiz-next');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        const allGroups = customGroup.items.length ? [...parsed.groups, customGroup] : parsed.groups;
        const employers = serializeEmployersMarkdown(parsed.intro, allGroups);
        await api.post('/setup/preferences', { employers });
        state.step = 5;
        renderStep5();
      });
    }

    render();
  }

  async function renderStep5() {
    root.innerHTML = `
      ${progress()}
      <div class="wizard-step">
        <h1>How often?</h1>
        <p class="lead">The dashboard app refreshes on its own while it's running — set how often.</p>
        <div class="field">
          <label>Frequency</label>
          <select id="wiz-frequency">
            <option value="daily" selected>Daily</option>
            <option value="every-3-days">Every 3 days</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div class="field">
          <label>Time of day</label>
          <input type="time" id="wiz-time" value="06:00">
        </div>
        <p class="hint" style="font-weight:600;">A thorough run checks every priority employer and aggregator in your profile and typically takes 10-15+ minutes of real Claude Code activity. On a Claude subscription (Pro/Max/Team) this doesn't cost extra, but it draws from the same 5-hour/weekly usage pool as your regular Claude Code sessions.</p>
        <p class="hint">You can close this window any time — the app keeps running quietly in the background and still checks for jobs on schedule.</p>
      </div>
      ${actions(false, 'Continue')}`;

    document.getElementById('wiz-back').addEventListener('click', () => { state.step = 4; renderStep4(); });
    document.getElementById('wiz-next').addEventListener('click', async () => {
      const btn = document.getElementById('wiz-next');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      await api.post('/setup/settings', {
        frequency: document.getElementById('wiz-frequency').value,
        timeOfDay: document.getElementById('wiz-time').value,
      });
      state.step = 6;
      renderStep6();
    });
  }

  async function renderStep6() {
    root.innerHTML = `
      ${progress()}
      <div class="wizard-step">
        <h1>All set</h1>
        <p class="lead">Your profile is saved. Starting your first digest now — this runs in the background and can take a few minutes; the dashboard will fill in as it finishes.</p>
      </div>
      <div class="wizard-actions">
        <span></span>
        <button class="btn primary" id="wiz-finish">Go to dashboard</button>
      </div>`;

    document.getElementById('wiz-finish').addEventListener('click', async () => {
      await api.post('/setup/finish');
      onComplete();
    });
  }

  renderStep0();
}
