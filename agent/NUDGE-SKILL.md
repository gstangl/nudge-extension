---
name: nudge
description: >
  Pull and work through Nudge prompts (UI prompting from the browser: Gerald picks an
  element on any localhost page via the Roots Nudge Chrome extension and prompts the
  agent — with selector, xpath, text, styles, screenshots as context). Use whenever
  Gerald says "/nudge", "Nudge(s)", "Pins" (legacy), "Kommentare", "was ist markiert",
  or asks whether new prompts arrived — and whenever he references a nudge by
  number („Nudge 123 macht das"). Works in EVERY project — the store is global
  (~/.claude/nudge). Lists open prompts compactly, processes them strictly oldest-first
  (explicitly named ids jump the queue), resolves ONLY after the fix is verified
  (after-screenshot as evidence).
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
- **Refused → heal the chain, don't just hand-start the bridge.** Chrome owns the
  bridge lifecycle (native host), so in order:
  1. **Chrome not running → open it.** `pgrep -x "Google Chrome" >/dev/null || open -a "Google Chrome"`.
     Opening Chrome starts the extension's service worker, which starts the bridge
     via the native host (`sw.js` calls `ensureBridge()` on SW start — no localhost
     tab needed for the bridge itself). Wait ~5 s, then re-check `/.identity`.
  2. **Chrome running but bridge refused → self-heal.** Any open localhost tab makes
     the extension restart the bridge within ~10 s. Re-check once.
  3. **Last resort only** (native host not installed, or still down after the above):
     `(nohup node /Users/gst/Developer/nudge-extension/bridge/bridge.mjs >/tmp/nudge-bridge.log 2>&1 &)`
  Fire the nudge overlay itself still needs a localhost app tab open — but arming +
  heartbeat (green icon) work as soon as the bridge is up.
- `agentLive: false` → no watcher heartbeating: arm watch mode (below).
- Browser side: status circle grey = overlay off, red = no bridge, amber = bridge
  but no agent listening, green = agent live. The feedback FEED (chips top right)
  tells the per-prompt truth: „— agent working" / „saved — no agent" /
  „Bridge offline — queued" / „nudge_X done".

## Watch mode (live following — the prompt channel)

**Invoking /nudge IS the registration.** A session becomes available to the
extension ONLY through Gerald: he types /nudge (or „übernimm die Nudges" /
„nenn dich X") in the session he wants — then FIRST arm the watcher (topic
label!), then list/process the queue. NEVER arm without that explicit gesture.
The fence is also technical: the watcher REFUSES to start without
NUDGE_AGENT_LABEL, so arming outside this path is impossible; double-arming
is harmless (the bridge replaces the older sibling of the same session).
The BRIDGE keeps a ROSTER of armed sessions (losers idle in silent standby),
Gerald picks the owner in the browser toolbar dropdown; newest wins only as
fallback among armed ones. Arm host-aware — the ONLY difference between Zed and
the terminal CLI is HOW the watcher is kept alive; the watcher script, the label
fence and the roster are identical.

**Zed (the `Monitor` tool is available):** persistent Monitor whose stdout lines
are surfaced back into the conversation — that IS the autonomous wake (a new
nudge starts the agent by itself):
`Monitor({ command: "NUDGE_AGENT_LABEL='<2-4 Worte: Thema DIESER Session>' node /Users/gst/Developer/nudge-extension/bridge/watch-nudges.mjs", persistent: true, description: "Nudge-Watch — <dasselbe Thema>" })`
The description is VISIBLE as the collapsed tool card in Zed's panel — it must
carry the session identity so Gerald sees at a glance who owns the channel.

**Claude CLI in the terminal / Ghostty (no `Monitor` tool):** arm the SAME
watcher as a BACKGROUND Bash — `run_in_background: true`, NOT `nohup`. Background
keeps the process a child of the session, so the watcher's orphan tripwire
(`ppid === 1`) cleans up honestly when the session ends; a detached `nohup` would
reparent to launchd, self-exit as "orphan", and the icon would never go green.
`Bash({ command: "NUDGE_AGENT_LABEL='<2-4 Worte: Thema DIESER Session>' node /Users/gst/Developer/nudge-extension/bridge/watch-nudges.mjs", run_in_background: true, description: "Nudge-Watch — <dasselbe Thema>" })`
The CLI has NO autonomous wake: the background watcher only heartbeats (green
icon + roster + opt-in). The prompt channel is PULL — Gerald sets nudges in the
browser, sees the number pills, and references them here by number („Nudge 23
macht das, Nudge 24 …"); the UserPromptSubmit hook injects each named nudge's
full context on that prompt (no wake needed). A bare „weiter" also surfaces the
open queue via the hook. Everything else — queue discipline, resolve-with-proof,
origin scoping — is identical to Zed.

ALWAYS set the topic label (both hosts) — it is how Gerald recognizes the session
in the dropdown (Zed thread titles summarize the same conversation, so they
converge). If Gerald NAMES the session ("nenn dich Nudge-Dev"), arm with that as
the `NUDGE_AGENT_LABEL` override — it becomes the label in the browser toolbar.

**Right after arming, print an IDENTITY line so Gerald can match this session to
the browser toolbar** (his explicit need — the toolbar shows the label, this ties
it to a localhost). The script POLLS until this session's first heartbeat lands
in the roster (up to ~8 s) — an immediate curl would race the watcher and print
"?" for a session that is arming fine. Run and show the output verbatim:
```
node -e 'const me=(process.env.CLAUDE_CODE_SESSION_ID||"").slice(0,8);(async()=>{let j=null,mine=null;for(let i=0;i<16;i++){try{j=await(await fetch("http://localhost:4700/.identity",{signal:AbortSignal.timeout(1500)})).json();mine=(j.agents||[]).find(a=>a.session===me);if(mine)break}catch{}await new Promise(r=>setTimeout(r,500))}if(!j){console.log("Bridge ✗ — kein Report");return}console.log(`Nudge aktiv · „${mine?.label||"?"}" · session ${me}`);for(const r of j.routes||[]){const own=r.owner?.session===me?" ← DIESE Session":"";const fb=r.viaFallback?" ⚠ nur Fallback (im Switch-session-Dropdown fixieren)":"";console.log(`  ${r.host} → ${r.owner?.label||"—"}${own}${fb}`)}if(!(j.routes||[]).length)console.log("  (keine localhost-Tabs offen)")})()'
```
The label is your `NUDGE_AGENT_LABEL` (== the toolbar `Agent:` text); `session` is
the un-collidable key — the same id8 shows on each row of the browser's
Switch-session dropdown, so Gerald can match chat ↔ toolbar 1:1 even when two
sessions share a label. A route `⚠ nur Fallback` means that localhost has NO
live explicit owner and only reaches an agent via newest-wins — if that host is
someone else's app (e.g. estimate on :5175), tell Gerald to pin the RIGHT session
on it in the Switch-session dropdown, or its nudges land here by accident. Re-run
this any time Gerald asks "which localhost am I / who owns what".
**On wake (Zed) — or when Gerald references a nudge by number (CLI) — treat the
nudge as if he had typed it into the conversation**: fetch details, do the work,
verify, resolve. The watcher also heartbeats the bridge — that is what turns the
browser icon green (both hosts).
A wake line `Nudge X ergänzt: …` means Gerald **appended a follow-up to an
already-sent nudge** (append-only): re-read the inbox `X.md` — the original plus
every `> **Nachtrag:**` is ONE work order, newest first is the latest thought.
An amendment can land mid-task; fold it into the same fix, do not treat it as a
separate nudge, and resolve X only once the whole order (original + nachträge) is
addressed.

## Port scope — parallel localhosts (one worktree per app)

Several worktrees can each run their own app on their own port (see the /local
skill). The store is ONE flat global list and the compact pin line drops the
origin — so pins from other windows look identical here. When this session is
bound to ONE localhost, scope to it:

- **Your port** = the vite serving THIS worktree. The /local recap named it
  (`Nudge-Scope: :<port>`); else it is the listening vite whose cwd is under
  `$PWD`.
- **Arm with the port in the label** so Gerald tells the windows apart in the
  toolbar dropdown: `NUDGE_AGENT_LABEL='<app> :<port>'`.
- **Filter the queue**: in `store.json` process ONLY pins whose `url` contains
  `:<port>`. A pin on another port belongs to another window — skip it, never
  resolve it. The full `url` (with port) lives in `store.json` and
  `inbox/<id>.md`; the compact list alone can't tell two apps apart.
- No scope (single localhost, no worktree stack) → no filter, whole queue as
  before.

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

Pull works ANY TIME mid-turn: the store is plain files, the bridge answers
`GET http://localhost:4700/.identity` — no wake needed to look something up.
References in Gerald's prompt („Nudge 123", `#123`) arrive pre-injected by the
UserPromptSubmit hook; for anything deeper read the inbox `.md` directly.

## 3. Queue discipline (rapid-fire work sessions)

Gerald often fires prompts faster than the agent processes them. The store IS the
session queue: ids are strictly monotonic = arrival order. Process open prompts
**strictly oldest-first, one at a time, never skip** — new arrivals join the back.
Finish (verify + resolve) the current one before pulling the next.

Two overrides (0.20.0):
- **Named beats oldest-first.** When Gerald references ids in chat („Nudge 123
  macht das, Nudge 170 …"), work exactly those, in the order named, before the
  rest of the queue — the hook has injected each named nudge's context already.
- **Mark-only nudges are anchors, not work orders.** A text-less nudge (empty
  send in the browser; wake line `[Nur Markierung …]`) exists so its number
  pill on the page can be referenced later. SKIP it in oldest-first and never
  resolve it unprompted — it becomes a work order only when Gerald references
  it with an instruction; then fix, verify, resolve as usual.

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
