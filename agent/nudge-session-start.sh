#!/bin/bash
# SessionStart hook (USER-LEVEL: runs in every project) — Pin self-healing.
# 1. Bridge not running -> start it (absolute path; store is global ~/.claude/nudge).
# 2. Since 0.16.0 watchers are NOT killed here: the bridge keeps a roster
#    (standby sessions stay alive, Gerald picks the owner in the toolbar);
#    dead sessions age out of the roster via their stopped heartbeat.
# 3. Tell the model to arm the watcher NOW (Monitor is a tool only the model calls).
BRIDGE="/Users/gst/Developer/roots-apps/nudge/bridge/bridge.mjs"
[ -f "$BRIDGE" ] || exit 0

if ! lsof -tnP -iTCP:4700 -sTCP:LISTEN >/dev/null 2>&1; then
  (nohup node "$BRIDGE" >/tmp/nudge-bridge.log 2>&1 &)
fi

echo '{"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"[Nudge] Live-Watch ist in dieser neuen Session noch NICHT aktiv (Watcher sind session-gebunden; ein eventueller alter wurde soeben beendet). Arme ihn jetzt sofort: Monitor({ command: \"node /Users/gst/Developer/roots-apps/nudge/bridge/watch-nudges.mjs\", persistent: true, description: \"Nudge-Watch — <Projektordner dieser Session>\" }). Danach gilt: neuer Nudge = Prompt von Gerald, sofort behandeln (nudge-Skill, oldest-first)."}}'
