#!/bin/sh
# Double-click (or run) this to start the job-digest dashboard.
# A terminal window stays open while it's running — no hidden background
# process. To stop the dashboard completely, close that window or press Ctrl+C.

cd "$(dirname "$0")/../app" || exit 1

if [ ! -d node_modules ]; then
  echo "First time setup — installing a few things, this takes a minute..."
  npm install
  echo
fi

echo "Starting job-digest... this window must stay open for the dashboard to work."
echo "Press Ctrl+C, or close this window, to stop it."
echo

( sleep 2 && (open http://localhost:4317 2>/dev/null || xdg-open http://localhost:4317 2>/dev/null) ) &

node server.mjs
