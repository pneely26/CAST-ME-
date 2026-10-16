#!/bin/bash
# Double-click to start Stewart Blind Spot (macOS). Close this window to stop the app.
cd "$(dirname "$0")" || exit 1
# Start Postgres.app if it's installed and not already running
if [ -d "/Applications/Postgres.app" ] && ! pgrep -x postgres >/dev/null; then
  open -a Postgres
  sleep 3
fi
if [ ! -f .env ] || [ ! -d .next ]; then
  echo "First time? Running setup…"
  npm run setup || { echo; read -r -p "Setup didn't finish. Press Enter to close."; exit 1; }
fi
( sleep 4; open "http://localhost:3000" ) &
echo "Stewart Blind Spot is running at http://localhost:3000 — close this window to stop it."
npm start
