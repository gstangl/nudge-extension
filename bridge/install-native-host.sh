#!/bin/bash
# Register the Nudge native messaging host with Chrome (once per machine).
# Afterwards Chrome itself starts the bridge whenever the extension needs it:
# no agent session and no terminal has to keep the bridge alive.
#
# Usage: ./install-native-host.sh [extension-id]
#
# Without an argument the extension id is derived from the extension directory,
# the same way Chrome computes the id of an unpacked extension (sha256 of the
# absolute path, first 32 hex digits mapped onto the letters a-p). If
# chrome://extensions shows a different id (for example because the folder was
# loaded through a symlink), pass that id explicitly. Moving the repository
# changes the id, so re-run this script after a move.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$HERE/../extension" && pwd -P)"
HOST_NAME="energy.roots.nudge"
WRAPPER="$HERE/native-host-wrapper.sh"

sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | cut -c1-64
  else sha256sum | cut -c1-64
  fi
}
derive_id() { printf '%s' "$1" | sha256_hex | head -c 32 | tr '0-9a-f' 'a-p'; }

EXT_ID="${1:-$(derive_id "$EXT_DIR")}"
if ! [[ "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "error: '$EXT_ID' is not a Chrome extension id (32 letters a-p)" >&2
  exit 2
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "error: node not found in PATH (Node.js 22 or newer is required)" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    DIRS=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    ) ;;
  Linux)
    DIRS=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/chromium/NativeMessagingHosts"
    ) ;;
  *)
    echo "error: unsupported platform $(uname -s). Native messaging on Windows needs a registry entry; see INSTALL.md." >&2
    exit 1 ;;
esac

# The wrapper pins the node binary and the absolute path of the launcher. It is
# generated per machine and therefore not tracked in git.
cat > "$WRAPPER" <<WRAP
#!/bin/bash
exec "$NODE_BIN" "$HERE/native-host.mjs"
WRAP
chmod +x "$WRAPPER"

# Chrome and Chromium both get the manifest (the Playwright test browser reads
# the Chromium location).
for DIR in "${DIRS[@]}"; do
  mkdir -p "$DIR"
  cat > "$DIR/$HOST_NAME.json" <<MANIFEST
{
  "name": "$HOST_NAME",
  "description": "Nudge bridge launcher (UI prompting for local coding agents)",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
MANIFEST
  echo "installed: $DIR/$HOST_NAME.json"
done
echo "extension id: $EXT_ID (derived from $EXT_DIR)"
echo "If chrome://extensions shows a different id, re-run: $0 <that-id>"
