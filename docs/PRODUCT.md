# Groundworks Nudge — Product Definition

2026-07-05. One page; the timeless core lives in
`VISION.md` (read that first), the technical frame in the top-level `README.md`,
the test contract in `test/protocols.md`. Standalone repo since 2026-07-08 (extracted
from the roots-apps monorepo — zero code dependencies).

**Mission — see `VISION.md`.** This page is the current embodiment of it: a
strong, bidirectional, always-honest connection between the active coding Agent
and the browser where the rendered UI lives: Chrome, with Safari available as
a temporary developer preview from the same extension core.
Everything below serves that line.

Safari is a **developer preview**, not a supported native-app distribution.
It uses the same prompt/context/ownership contract with browser-local author,
off-state and unsent queue. Shared changes in 0.33.0 serialize durable retries,
retain drafts on storage failure, and bind new image evidence to the source
browser/tab/document/mark. Missing or ineligible image evidence remains pending;
resolved work is not automatically verified pixels. Installation and current
verification limits live in [SAFARI.md](SAFARI.md).

## What Nudge is

**UI prompting for the active coding Agent — built for pixel nudging.** You pick an
element (or circle a region) in the running UI, say what you want, and the
Agent acts on it with full context: selector, xpath, text, styles,
console (and a screenshot for region marks). Open prompts stay subtly visible
as number pills — the number is what you reference in the Agent chat ("Nudge 123 does
that"); everything else is fire-and-forget. The pill number is deliberately
BOUNDED (wraps at 999, so it never grows into an unreadable id) and only has to
be unique among the handful of open prompts; the id behind it counts up forever
and is what files, commits and the CHANGELOG cite.

## Why "Nudge" (renamed from "Pin", 2026-07-05)

The pin was never the point — it is just the gesture. The CORE of the app is
**nudging: polishing the last details of a rendered UI** — spacing, alignment,
type, the final pixels. For UI designers this is one of the hardest parts of
agentic development: it has to happen ON the presentation layer, deterministic
and visual, where prose prompts ("a bit more spacing") are weakest and pointing
is everything. Nudge names that job; "Pin" named the mechanism.

## USP — what everything else is subordinated to

1. **Agent integration is the core.** Prompts land in the Agent that owns the
   codebase — not in a chat next to it. The agent fixes, verifies, resolves
   with before/after evidence. Claude Code and Codex have native Skill adapters;
   other local Agents use the same CLI and protocol.
2. **Speed.** Mark → agent knows it in ~1 s (event-time push, tiny payload
   first, live wake). The connection state is always visible and never lies
   (grey/red/amber/green = off / no bridge / no agent / agent live).
3. **Rapid-fire work sessions.** Fire 10 changes faster than the agent works —
   the store IS the queue: strictly ordered, oldest-first, nothing lost,
   in-page toast when each one is done. A sent nudge is not sealed: while it is
   still open you can append a follow-up to it ("+ amend") — the same nudge,
   a later thought (append-only, re-wakes its agent; 0.19.0).
4. **Best-in-class UI picking.** Gliding highlight, layer chips (pick the
   ancestor you meant), Shift+click multi-select ("swap these two"),
   freehand lasso, pick-without-send ("this one").

## Core: the connection must be reliable — and visibly so

The bridge between the browser extension and the active Agent is the product's
backbone. Chrome's native host and the shared CLI/session hooks provide startup
and recovery; the temporary Safari extension has no native autostart. Connection
state is visible in both directions. The shared implementation below is tested
in Chromium; it is not a blanket Safari acceptance claim:

- [x] **Browser, standing:** status circle (toolbar icon + pill dot) — grey off /
      red no bridge / amber no agent / **green = agent live**. Green never lies
      (heartbeat-backed). A green pull owner additionally shows a "Pull" tag:
      the Agent is live, but a Nudge arrives with the next prompt rather than by
      itself. Green must not imply autonomous wake.
- [x] **Browser, per nudge pill:** shows the nudge NUMBER (the chat referent);
      amber clock = accepted/stored, sweeping hand = agent live, gone = done
      (history with check marks lives in the queue popover only).
- [x] **Browser, per prompt:** feedback the moment you send — "nudge_X — agent
      working" (send), "nudge_X saved — no agent" (clock), "Bridge offline —
      queued" (alert), "nudge_X done" (check).
- [x] **Browser, feedback feed:** all events listed unobtrusively top right —
      small chips with Lucide icons, max 4, self-fading. Connection losses and
      recoveries land there too.
- [x] **Agent, standing:** the CLI reports bridge, roster, current mark and queue;
      native hooks may inject the same context where the runtime supports them.
- [x] **Agent, live:** push-capable runtimes wake on a new prompt. Pull runtimes
      receive it with the next message. Completions return to the browser.
- [x] **Both ways:** taking a nudge BACK (queue ×) is a message, not a deletion.
      A nudge is at its agent in milliseconds, so the × cancels running work: the
      owning agent is told to stop, and the toast names who was told (2026-07-29).

## Goals

- [x] Works on ANY localhost app — framework-agnostic by design (extension,
      not dev-server middleware). Any localhost app — that is the point.
- [x] Prompt + context arrive as one unit the agent can act on without asking back.
- [x] The current mark is ambient agent context ("this one" just works).
- [x] Connection truth at every step: icon, send-toast, per-message status line.
- [x] Evidence loop: resolve captures the after-state, invisibly.
- [x] One runtime-neutral CLI and store serve every local Agent. Claude Code and
      Codex have native Skill discovery; other Agents follow the same protocol.
- [x] Parallel localhosts (multiple worktrees, each its own dev server + agent)
      route to their own agents — per-host ownership, no cross-wake (2026-07-07).
- [x] Every instruction travels BOTH ways: send, amend — and withdraw. A nudge
      pulled back stops the agent that has it, on the same routing (2026-07-29).
- [ ] Team-ready: one extension install + one setup script per person.

## Non-goals

- **No annotation/collaboration tool.** No persistent markers, no threads, no
  assignees — that belongs in a collaboration tool, not Nudge.
- **No history.** Only "what is marked NOW" and the open queue matter; resolved
  prompts persist solely as evidence for the agent.
- **No browser automation or audits.** Agent→browser (navigate, click, Lighthouse)
  is Playwright/browser-tools territory.
- **No own agent, no cloud, no accounts** (anti-Stagewise-app): localhost is the
  trust boundary, the active coding Agent is the brain.
- **No framework adapters** (anti-Frontman): nothing that only works in Vite/Next/Astro.

## Accepted trade-offs — the price of the USP

- **Manual developer installation.** Chrome uses Load unpacked plus setup;
  Safari uses the temporary source-install preview described in
  [SAFARI.md](SAFARI.md), with runtime acceptance tracked separately. The
  browser extension preserves framework independence and native screenshots.
- **One externally started bridge.** Chrome's native messaging host can start
  it detached; Safari's temporary preview relies on the CLI/session hook. Both
  use the same bridge and store. No always-running system daemon is installed.
- **Wake capability is declared, never inferred from the editor.** A runtime that
  can start a turn from watcher output declares `push`; every other runtime is
  `pull`. A mid-task prompt waits until the Agent's current step yields.
- **Parallel sessions coexist, routed per localhost** (origin-aware, 2026-07-07;
  supersedes the old "one live-watch session at a time"). The bridge keeps a
  roster of armed sessions; each localhost is owned by one agent — assigned in
  the browser's Switch-session dropdown, else newest-armed as fallback. A nudge
  on localhost:5175 wakes only that host's owner; a parallel worktree on
  localhost:5176 wakes its own, no cross-wake (proven by Suite K's two real
  watchers). Ownership is stamped per nudge at arrival and is immutable, so a
  mid-stream owner change never re-attributes an existing nudge. Trade-off: a
  nudge on an UNassigned host falls back to the newest armed session — with
  parallel servers you pick the owner once per localhost.
- **A page reload keeps the work, not necessarily the anchor** (0.23.0). The
  agent edits code while the user types; the dev server reloads the tab and no
  content script can survive a navigation. The working state (draft text,
  markings, toolbar position and mode, History popover, half-typed follow-ups)
  is therefore snapshotted into `sessionStorage` — per tab, per origin, dies with
  the tab — and rebuilt on the next load; every mark carries its context frozen
  at pick time. What cannot be guaranteed is the live DOM node: the restore looks
  for it for 6s (selector, then an identity-checked xpath, so a re-render never
  hands the mark a stranger), and if the app does not render it again the nudge
  keeps the frozen context and says "element gone". The owner's own framing of
  the acceptable worst case: "in the worst case you only lose the nudges that
  happened to hang on some DOM element".
- **Source hints are generic, not resolved.** data-* attributes where frameworks
  provide them, selector/xpath/text otherwise; mapping to code stays the agent's
  job (it has the repo). No server-side sourcemap machinery.
- **localhost trust boundary:** any local process can post/resolve prompts.
  Accepted for a dev tool; never expose the port. Since bridge 0.5.0 CORS is
  restricted to localhost origins — foreign websites can no longer read
  /selection, /comments or /shots via the browser.

## Scoreboard (what "good" means)

- Mark → agent context: **< 2 s** · Prompt → wake: **< 2 s** (measured ~1 s)
- Rapid-fire: 10 prompts in 2 min → 10 processed oldest-first, 0 lost
- Picker feel: glide + fades, no jumps, no zombie overlays
- Chain truth: icon state matches reality in 100% of failure drills (T13)
