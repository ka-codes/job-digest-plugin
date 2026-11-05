# DevJob Digest

**International Development Personal DevJob Digest** — a free, local-first desktop app that searches senior international-development and AI-for-good roles, scores fit against your real CV, tracks your applications, and drafts tailored CVs and cover letters.

Everything runs on your own machine. Your CV, preferences, saved jobs, and application history never leave it. The app uses your own existing [Claude Code](https://claude.com/claude-code) installation for all AI work, so there's no separate API key to manage and no usage cost to anyone but you.

## What it does

- **Daily/weekly digest** — checks a curated list of multilateral/bilateral agencies, INGOs, foundations, and AI-for-good employers, plus general job aggregators, for new openings that match your target role and locations.
- **Fit scoring** — every role is scored against your actual CV and preferences, not just keyword-matched.
- **Real connectors, not just search** — 21 employers (Anthropic, OpenAI, Hugging Face, IMF, Gates Foundation, Salesforce, AWS, and more) are checked via their real public job-board APIs (Greenhouse, Lever, Ashby, Workday, Workable) instead of a web-search guess. Everyone else falls back to web search.
- **Saved jobs & applications tracker** — save roles you like, track status (saved → applied → interview → offer/rejected) without ever auto-applying or logging in anywhere on your behalf.
- **Tailored CV & cover letters** — drafts a tailored CV and cover letter for a specific role as a real `.docx` file, in your own voice if you give it an example letter.

## Requirements

- **Windows 10/11 or macOS.**
- **[Claude Code](https://claude.com/claude-code) installed and signed in** (a Claude subscription — Pro/Max/Team — or an Anthropic API key). This app has no AI of its own; every AI feature shells out to your Claude Code installation. The setup wizard checks for this on first run and links you to install instructions if it's missing.

## Install

1. Go to [Releases](https://github.com/ka-codes/job-digest-plugin/releases) and download the latest installer for your OS:
   - Windows: `DevJob Digest Setup x.x.x.exe`
   - macOS: `DevJob Digest-x.x.x.dmg`
2. Run the installer.
   - **Windows:** if SmartScreen warns "Windows protected your PC," click **More info → Run anyway**. This is because the app isn't code-signed (code-signing certificates cost money and aren't required for free/open-source tools) — not a sign of anything wrong.
   - **macOS:** if Gatekeeper blocks it as "unidentified developer," right-click (or Control-click) the app → **Open**, then confirm. Same reason as above.
3. Launch **DevJob Digest** from your Start Menu / Applications folder like any other app.
4. The first-run wizard checks that Claude Code is installed, then walks you through uploading your CV, setting preferences, and choosing a refresh schedule.

## Running from source

For development, or if you'd rather not use a prebuilt installer — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

Nothing about your search — your CV, your pay targets, your saved jobs, your application history — is sent anywhere except to the employer job boards you're actually searching and to Claude Code (which runs under your own account, the same way your regular Claude Code sessions do). There's no account, no telemetry, and no central server. Everything lives in a private folder on your own computer.

## License

[MIT](LICENSE) © [ka-codes](https://github.com/ka-codes)
