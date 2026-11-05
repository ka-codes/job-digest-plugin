// Shells out to the Claude Code CLI headlessly. This is the only AI
// integration in the whole app — every "live" action in the dashboard
// (digest run, cover-letter draft, resolving an employer) goes through here,
// reusing whatever Claude Code login/subscription the user already has.
//
// Verified against `claude -p --help` on this machine (2026-11-02):
//   --permission-mode acceptEdits   auto-accepts edits/tool calls within --allowedTools
//   --permission-prompts none       anything else is denied, never hung waiting on a prompt
// Together these guarantee a headless run never blocks on input it can't answer.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The job-digest-plugin repo's own root (this file lives at app/lib/claude.mjs).
// A headless `claude -p` run's cwd is the user's PRIVATE workspace, a completely
// separate, unrelated directory — without explicitly loading the plugin from
// its real location, Claude Code has no idea `/job-digest` exists at all
// ("isn't installed in this session") and silently falls back to ad hoc
// behavior instead of running SKILL.md's actual instructions. --plugin-dir
// loads it for just this one invocation; --add-dir additionally grants Read/
// Bash access to it so SKILL.md's own scripts/connectors/*.mjs are reachable.
export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// On Windows, `claude` on PATH is a .cmd shim, not a real executable — Node's
// child_process cannot spawn a .cmd file directly without going through
// cmd.exe (shell:true). That turned out to be unsafe here: Node's own
// deprecation warning confirms shell:true does NOT escape array arguments,
// only concatenates them, which is a real injection risk given prompt text
// (role titles, user input) ends up as an argument. The correct fix is to
// spawn the real .exe the shim wraps instead — a genuine native executable,
// safe to call with an args array and no shell at all. Resolved once and
// cached; falls back to the .cmd shim (degraded, shell:true) only if the
// real exe can't be found, since other install layouts may differ.
let resolvedBin = null;

function resolveClaudeBin() {
  if (resolvedBin) return resolvedBin;

  if (process.platform !== 'win32') {
    resolvedBin = { command: 'claude', shell: false };
    return resolvedBin;
  }

  try {
    const shimPath = execFileSync('where', ['claude.cmd'], { encoding: 'utf8' }).trim().split('\n')[0].trim();
    const candidateExe = join(dirname(shimPath), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (existsSync(candidateExe)) {
      resolvedBin = { command: candidateExe, shell: false };
      return resolvedBin;
    }
  } catch {
    // fall through to the degraded fallback below
  }

  console.warn(
    '[claude] Could not resolve the real claude.exe beneath the .cmd shim; ' +
    'falling back to claude.cmd via shell:true, which does not safely escape arguments.'
  );
  resolvedBin = { command: 'claude.cmd', shell: true };
  return resolvedBin;
}

// Used by the packaged app's first-run setup to confirm Claude Code CLI is
// actually installed before the rest of the wizard runs, instead of today's
// behavior of only surfacing it as an opaque failure deep inside the first
// real AI call (background-generation, a digest run, etc).
export function checkClaudeInstalled() {
  const { command, shell } = resolveClaudeBin();
  try {
    const version = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 10_000, shell }).trim();
    return { installed: true, version };
  } catch (err) {
    return { installed: false, error: err.message };
  }
}

const BASE_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'WebFetch',
  'WebSearch',
  'Bash(node scripts/connectors/*.mjs*)',
];

export function runClaudeHeadless(workspaceDir, prompt, { extraAllowedTools = [], timeoutMs = 20 * 60 * 1000 } = {}) {
  const allowedTools = [...BASE_ALLOWED_TOOLS, ...extraAllowedTools];
  const args = [
    '--print',
    prompt,
    '--permission-mode',
    'acceptEdits',
    '--permission-prompts',
    'none',
    '--plugin-dir',
    PLUGIN_DIR,
    '--add-dir',
    PLUGIN_DIR,
    // Without these, a headless run silently inherits this machine's personal
    // interactive-session defaults (verified via a real run's stream-json
    // trace: an older model, "high" effort, and a pile of irrelevant inherited
    // MCP servers like Google Drive/Playwright) — none of which were ever
    // chosen for this task and which measurably slowed it down. Pin them
    // explicitly instead: "sonnet" always resolves to the latest Sonnet
    // generation rather than going stale as a hardcoded dated ID; "medium"
    // effort matches the fast, good-quality result a direct claude.ai test
    // got on the same task; --strict-mcp-config with no --mcp-config loads
    // zero MCP servers, removing both their overhead and a "pending" one
    // that's a real hang risk.
    '--model',
    'sonnet',
    '--effort',
    'medium',
    '--strict-mcp-config',
    '--allowedTools',
    ...allowedTools,
  ];
  const { command, shell } = resolveClaudeBin();

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: workspaceDir, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, shell },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`claude -p failed: ${err.message}\n${stderr || ''}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
