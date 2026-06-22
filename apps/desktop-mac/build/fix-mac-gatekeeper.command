#!/bin/bash
# Double-click this file after installing FTC Sim Player to Applications.
# Fixes "App is damaged" / quarantine blocks from browser downloads (not actual corruption).

set -e
APP="/Applications/FTC Sim Player.app"

if [ ! -d "$APP" ]; then
  osascript -e 'display alert "FTC Sim Player not in Applications" message "Open the .dmg, drag FTC Sim Player to Applications, then double-click this fix again."' \
    || echo "Install FTC Sim Player to /Applications first, then re-run this script."
  exit 1
fi

echo "Removing download quarantine flags…"
xattr -cr "$APP" 2>/dev/null || true

echo "Applying ad-hoc signature…"
codesign --force --deep --sign - "$APP"

osascript -e 'display alert "FTC Sim Player — ready" message "Open FTC Sim Player from Applications. If macOS still asks, right-click the app → Open → Open."' \
  || echo "Done. Open FTC Sim Player from Applications (right-click → Open if needed)."
