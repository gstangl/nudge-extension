#!/bin/bash
# SessionStart hook (USER-LEVEL: runs in every project) — Nudge self-healing.
# It does EXACTLY ONE thing: ensure the bridge is up (a harmless local service
# Gerald's Chrome extension needs). It injects NO context — a session learns
# about Nudge only when Gerald types /nudge (the skill carries the opt-in rule).
# Injecting "[Nudge] …" into every session made foreign agents Nudge-aware and
# had them relate to the owner's session (Gerald 2026-07-05) — removed.
# The bridge keeps a roster; dead sessions age out via their stopped heartbeat.
BRIDGE="/Users/gst/Developer/roots-apps/nudge/bridge/bridge.mjs"
[ -f "$BRIDGE" ] || exit 0

if ! lsof -tnP -iTCP:4700 -sTCP:LISTEN >/dev/null 2>&1; then
  (nohup node "$BRIDGE" >/tmp/nudge-bridge.log 2>&1 &)
fi

exit 0
