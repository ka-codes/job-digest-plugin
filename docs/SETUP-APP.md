# Running the dashboard

## If you installed via the packaged app (recommended)

Download the installer for your OS from [Releases](https://github.com/ka-codes/job-digest-plugin/releases), run it, and launch **DevJob Digest** from your Start Menu / Applications folder — see the main [README](../README.md#install) for the full install steps (including the SmartScreen/Gatekeeper click-through, since the app is unsigned). It's a normal desktop app: it opens in its own window. Closing that window doesn't quit the app — it keeps running in your system tray so scheduled digest runs still happen whether or not the window is open. Click the tray icon to reopen the dashboard, or right-click it → **Quit** to fully exit (this is also what stops scheduled runs). The app also launches automatically (hidden in the tray, not a popped-up window) when you log in, so scheduled runs survive a computer restart too — you don't have to remember to reopen it. Everything below this section describes the older from-source route and still applies if you're running from a git clone instead.

## Running from source (for development, or if you'd rather not use the installer)

**Windows:** double-click `bin/start-dashboard.cmd`.
**Mac/Linux:** run `bin/start-dashboard.sh` (first time: `chmod +x bin/start-dashboard.sh`).

The first run installs a few things automatically — that takes a minute. After that it runs quietly in the background (no window to leave open), and your browser opens to the dashboard a few seconds later.

## Stopping it

You normally won't need to. If a scheduled refresh is meant to happen every day, the point is to start it once and leave it running — there's nothing to babysit.

If you ever do want to pause or remove it: double-click `bin/stop-dashboard.cmd` (Windows), or on Mac/Linux find and stop the `node server.mjs` process (`pkill -f server.mjs`, or Activity Monitor).

## What's actually running, and why closing your browser tab is fine

- **Your browser tab** — just a window onto your data. Close it whenever; nothing breaks, and nothing stops running.
- **The background process** — a small program on your own computer, started by the launcher, that (a) serves the dashboard to your browser and (b) checks on its own, every couple of minutes, whether a scheduled digest run is due. This is what actually needs to be running for scheduled runs to happen, and it runs invisibly — no window, no taskbar icon.

Claude Code itself does **not** run continuously. When a scheduled run is actually due, this background process briefly starts it, it does its work for a few minutes, then it exits completely. Nothing related to Claude stays running in between runs.

## Running automatically every day, without starting it yourself

If you want the background process to come up on its own after a reboot (rather than you remembering to double-click the launcher), set it to start at login:

**Windows:**
1. Press `Win + R`, type `shell:startup`, press Enter — this opens your Startup folder.
2. Right-click `bin/start-dashboard.cmd` → **Create shortcut**.
3. Move that shortcut into the Startup folder you just opened.

Now it starts automatically every time you log in.

**macOS:** create a LaunchAgent plist pointing at `bin/start-dashboard.sh`, or add the script as a Login Item in System Settings → General → Login Items.

This is optional — without it, you just double-click the launcher whenever you want it running.

## What a scheduled run actually costs

A thorough run — checking every priority employer and every aggregator, not just the ones with a confirmed connector — is real work: in testing, a full run across ~65 search-based employers plus 11 aggregators took roughly **15 minutes of continuous Claude Code activity**. Employers with a confirmed connector (Greenhouse/Lever/Ashby) are fast and essentially free; everything else needs a live WebFetch/WebSearch per source, which is both the slow part and (on a metered plan) the costly part. Check `digest-run-log.txt` in your working folder after any run to see exactly which sources were checked and how.

What that means depends entirely on how Claude Code is logged in:

- **Claude subscription (Pro/Max/Team)** — no separate bill, but it's not unlimited either: a run draws from the **same shared 5-hour/weekly usage pool** as your regular interactive Claude Code sessions (Pro's limits aren't published as a fixed number — check `/status` in any session to see your remaining allocation). A 15-minute run every day is a real, non-trivial slice of that pool if you also use Claude Code heavily for other work. If you're on Pro and this matters to you, watch `/status` for a few days of daily runs before assuming it's a non-issue.
- **Pay-per-token API key** — a real, metered cost per run, scaling with how many of your priority employers need the WebSearch fallback (most large employers' career sites block direct fetches and need it). Run `/job-digest` manually once and check actual usage in your Anthropic console before turning on daily automation, rather than guessing.
