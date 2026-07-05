---
name: nudge
description: >
  Pull and work through Nudge prompts (UI prompting from the browser: Gerald picks an
  element on any localhost page via the Roots Nudge Chrome extension and prompts the
  agent — with selector, xpath, text, styles, screenshots as context). Use whenever
  Gerald says "/nudge", "Nudge(s)", "Pins" (legacy), "Kommentare", "was ist markiert",
  or asks whether new prompts arrived. Works in EVERY project — the store is global
  (~/.claude/nudge). Lists open prompts compactly, processes them strictly oldest-first,
  resolves ONLY after the fix is verified (after-screenshot as evidence).
---

# /nudge — UI prompting from the browser

A nudge is a **prompt with browser context**, not a note: Gerald prompts from the
Nudge extension the way he otherwise types here — mostly to polish rendered UI
(pixel nudging). Treat an incoming nudge as a work order.
Everything lives in the GLOBAL store `~/.claude/nudge/` (store.json, selection.json,
shots/, inbox/) — same truth for every agent in every project. Architecture refs:
`nudge/README.md` (technical), `PRODUCT.md` (goals/trade-offs),
`test/protocols.md` (suites).

## 0. Connection report (DEVIATIONS ONLY — silence means healthy)

Gerald sees the healthy state already (browser toolbar label + hook line).
Say NOTHING about the connection unless something is wrong; then one line:
`Bridge ✗` / `Agent-Watch ✗ — arming` (and fix it).
- `curl -s --max-time 2 http://localhost:4700/.identity` → `{version, agentLive, agentLabel, tabs}`.
- `agentLabel` names the OWNING session (project dir + pid) — if it is not
  yours, another session processes the nudges; arming here takes over.
- **Refused → don't rush to fix it yourself**: the chain SELF-HEALS — any open
  localhost tab makes Chrome restart the bridge via the native host within ~10 s.
  Re-check once. Only if Chrome isn't running (or no tab is open), start manually:
  `(nohup node /Users/gst/Developer/roots-apps/nudge/bridge/bridge.mjs >/tmp/nudge-bridge.log 2>&1 &)`
- `agentLive: false` → no watcher heartbeating: arm watch mode (below).
- Browser side: status circle grey = overlay off, red = no bridge, amber = bridge
  but no agent listening, green = agent live. The feedback FEED (chips top right)
  tells the per-prompt truth: „— agent working" / „saved — no agent" /
  „Bridge offline — queued" / „nudge_X done".

## Watch mode (live following — the prompt channel)

Every session that should react live arms its own watcher. The BRIDGE keeps a
ROSTER: all watchers stay alive (losers idle in silent standby), Gerald picks
the owner in the browser toolbar dropdown; newest wins only as fallback. Being
chosen prints one line („Watch-Kanal übernommen") — from then on new nudges
wake THIS session. Arming is therefore always safe and never steals visibly:
`Monitor({ command: "NUDGE_AGENT_LABEL='<2-4 Worte: Thema DIESER Session>' node /Users/gst/Developer/roots-apps/nudge/bridge/watch-nudges.mjs", persistent: true, description: "Nudge-Watch — <dasselbe Thema>" })`
ALWAYS set the topic label — it is how Gerald recognizes the session in the
dropdown (Zed thread titles summarize the same conversation, so they converge).
The description is VISIBLE as the collapsed tool card in Zed's panel — it must
carry the session identity so Gerald sees at a glance who owns the channel.
If Gerald NAMES the session ("nenn dich Nudge-Dev"), arm with the env override —
it becomes the label in the browser toolbar:
`Monitor({ command: "NUDGE_AGENT_LABEL='Nudge-Dev' node /Users/gst/Developer/roots-apps/nudge/bridge/watch-nudges.mjs", persistent: true, description: "Nudge-Watch — Nudge-Dev" })`
**On wake, treat the nudge as if Gerald had typed it into the conversation**: fetch
details, do the work, verify, resolve. The watcher also heartbeats the bridge —
that is what turns the browser icon green.

## 1. "Was ist markiert?" — the deictic recipe

Gerald picks an element (no send needed) and asks here. Answer from:
- `~/.claude/nudge/selection.json` — selector, xpath, innerText, source hint,
  categorized styles (typography/box/surface), url, `at` timestamp
- `~/.claude/nudge/shots/selection.png` (crop) + `selection_full.jpg` (page overview)
Describe WHAT it is (from the screenshot + innerText), not just the selector.
Current-mark semantics (same as the hook): newest of selection vs. latest nudge
wins; stale after 15 min — if older, say so instead of guessing.

## 2. Fetch the queue

Read the files — no MCP, no extra tools:
- `~/.claude/nudge/store.json` — all prompts (id order = arrival order)
- `~/.claude/nudge/inbox/<id>.md` + `shots/<id>*.png` — one file per prompt

## 3. Queue discipline (rapid-fire work sessions)

Gerald often fires prompts faster than the agent processes them. The store IS the
session queue: ids are strictly monotonic = arrival order. Process open prompts
**strictly oldest-first, one at a time, never skip** — new arrivals join the back.
Finish (verify + resolve) the current one before pulling the next.

## 4. Work one prompt at a time — MINIMAL PANEL FOOTPRINT

Zed renders every plain-text line in full; tool calls collapse. Therefore:
work through tools, not prose. Do NOT list the queue unprompted, do NOT
restate the nudge text (Gerald wrote it; it sits in his queue history), do
NOT dump outerHTML/styles/paths, do NOT narrate steps. Per prompt: read its
inbox .md (+ screenshot for Freeform), locate the code, apply the fix,
verify it (run/screenshot the app). The ENTIRE chat output for a finished
nudge is ONE line: `nudge_X ✓ <Ergebnis in ≤8 Worten>`. Only questions or
real blockers earn more text. Explicit `/nudge` asks for the list — then
one line per open nudge, nothing more.

## 4a. Quiet execution (fewer, smaller cards)

Zed can only collapse what exists — the agent controls HOW MUCH exists.
While working nudges:
- BATCH shell steps: one Bash call with `&&` instead of five calls — five
  cards become one.
- Keep tool RESULTS tiny: pipe to `grep`/`tail`/`wc -l`; never cat whole
  files into a result when a slice answers the question.
- Card labels ≤ 5 words (`description`), no step narration between calls.
- Screenshots/verification: one shot per nudge, not a gallery.

## 4b. No nudge citations in code

NEVER write nudge provenance into code comments („Gerald via Nudge", pin ids,
dates) — comments state constraints, not origin (house rule). Provenance
belongs in the COMMIT MESSAGE (e.g. „fix(estimate): icon-only toggle
[nudge_74]"). The store/inbox is the durable nudge ledger already.

## 5. Resolve gate

Resolve ONLY after the fix is actually addressed and verified — resolving captures
an after-screenshot of the same region as evidence (needs the page open in the
browser): `curl -X POST http://localhost:4700/comments/<id>/resolve`
Never resolve ahead of the fix; never resolve just to clear the list. Gerald sees
the „nudge_X done" chip in the page's feedback feed — that chip plus your
one-liner IS the completion report; write no summary beyond it.

## Setup (once per machine — e.g. team rollout)

End-user guide: `nudge/INSTALL.md`. Short version:
1. Chrome → `chrome://extensions` → Load unpacked → `nudge/extension/`
2. `nudge/bridge/install-native-host.sh <extension-id>` — Chrome then owns
   the bridge lifecycle (detached start, self-healing)
3. `nudge/agent/setup-agent.sh` — installs this skill + both hooks into
   `~/.claude/` (idempotent, merges settings.json without touching the rest)
