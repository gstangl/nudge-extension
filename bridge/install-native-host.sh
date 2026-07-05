#!/bin/bash
# Register the Nudge native messaging host with Chrome (one-time per machine).
# After this, the EXTENSION starts the bridge — no agent session or terminal needed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Unpacked extension ids derive from the DIRECTORY PATH (sha256 -> a-p alphabet);
# moving the extension folder CHANGES the id. This default matches
# /Users/gst/Developer/roots-apps/nudge/extension — on other machines/paths pass
# the id from chrome://extensions as $1.
EXT_ID="${1:-pnobkoaalohemdbokjikojiabnnbpjck}"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
WRAPPER="$HERE/native-host-wrapper.sh"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

cat > "$WRAPPER" <<EOF
#!/bin/bash
echo "\$(date +%T) native host spawned by: \$(ps -o comm= -p \$PPID)" >> /tmp/nudge-native.log
exec "$NODE_BIN" "$HERE/native-host.mjs"
EOF
chmod +x "$WRAPPER"

# Chrome + Chromium (Playwright test browser reads the Chromium path)
for DIR in "$MANIFEST_DIR" "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
  mkdir -p "$DIR"
  cat > "$DIR/energy.roots.nudge.json" <<EOF
{
  "name": "energy.roots.nudge",
  "description": "Roots Nudge bridge launcher (UI prompting for the Zed agent)",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "installed: $DIR/energy.roots.nudge.json"
done
echo "wrapper: $WRAPPER (ext $EXT_ID)"
