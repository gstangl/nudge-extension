#!/bin/bash
# SessionStart hook (USER-LEVEL: runs in every project) — Nudge self-healing.
# It does EXACTLY ONE thing: ensure the bridge is up (a harmless local service
# the Nudge Chrome and Safari extensions share). It injects NO context — a session learns
# about Nudge only when the user invokes groundworks-nudge (the Skill carries the opt-in rule).
# Injecting "[Nudge] …" into every session made foreign agents Nudge-aware and
# had them relate to the owner's session (2026-07-05) — removed.
# The bridge keeps a roster; dead sessions age out via their stopped heartbeat.
LAUNCHER="$HOME/.local/bin/groundworks-nudge"
[ -x "$LAUNCHER" ] || exit 0

# A listener is not necessarily a compatible Groundworks Nudge bridge. The
# shared lifecycle check verifies identity and canonical store before reuse.
(nohup "$LAUNCHER" ensure-bridge >/tmp/nudge-bridge.log 2>&1 &)

exit 0
