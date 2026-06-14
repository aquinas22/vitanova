#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Vita Nova Charting — local web server
# Serves the static app so it can be opened from any device on your network
# (phone, tablet, laptop). Designed to run on a Raspberry Pi.
#
#   ./run.sh           # serve on port 8080
#   ./run.sh 9000      # serve on a custom port
# ---------------------------------------------------------------------------
set -euo pipefail

PORT="${1:-8080}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Find the Pi's LAN IP address (best-effort; must never abort the script).
set +e
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
set -e
[ -z "${LAN_IP:-}" ] && LAN_IP="<this-device-ip>"

echo "🌸  Vita Nova Charting"
echo "    Serving $DIR"
echo
echo "    On this device:     http://localhost:$PORT/"
echo "    On your network:    http://$LAN_IP:$PORT/"
echo
echo "    Press Ctrl+C to stop."
echo

# Prefer python3's built-in server (present on Raspberry Pi OS). Bind to
# 0.0.0.0 so other devices on the LAN can reach it.
if command -v python3 >/dev/null 2>&1; then
    exec python3 -m http.server "$PORT" --bind 0.0.0.0
elif command -v python >/dev/null 2>&1; then
    exec python -m SimpleHTTPServer "$PORT"
elif command -v npx >/dev/null 2>&1; then
    exec npx --yes serve -l "$PORT" .
else
    echo "Error: need python3 (or python, or node/npx) to serve the app." >&2
    exit 1
fi
