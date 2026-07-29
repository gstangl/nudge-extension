# Nudge — Product Definition

2026-07-05 · Owner: Gerald · Register: PM. One page; the timeless core lives in
`VISION.md` (read that first), the technical frame in `README.md`, the test
contract in `test/protocols.md`. Standalone repo since 2026-07-08 (extracted
from the roots-apps monorepo — zero code dependencies).

**Mission — see `VISION.md`.** This page is the current embodiment of it: a
strong, bidirectional, always-honest connection between the Zed IDE (the first
agent surface, not the last) and Google Chrome (where the rendered UI lives).
Everything below serves that line.

## What Nudge is

**UI prompting for the Zed agent — built for pixel nudging.** You pick an
element (or circle a region) in the running UI, say what you want, and the
agent in Zed acts on it with full context: selector, xpath, text, styles,
console (and a screenshot for region marks). Open prompts stay subtly visible
as number pills — the number is what you reference in Zed („Nudge 123 macht
das"); everything else is fire-and-forget. The pill number is deliberately
BOUNDED (wraps at 999, so it never grows into an unreadable id) and only has to
be unique among the handful of open prompts; the id behind it counts up forever
and is what files, commits and the CHANGELOG cite.

## Why "Nudge" (renamed from "Pin", 2026-07-05)

The pin was never the point — it is just the gesture. The CORE of the app is
**nudging: polishing the last details of a rendered UI** — spacing, alignment,
type, the final pixels. For UI designers this is one of the hardest parts of
agentic development: it has to happen ON the presentation layer, deterministic
and visual, where prose prompts ("etwas mehr Abstand") are weakest and pointing
is everything. Nudge names that job; "Pin" named the mechanism.

## USP — what everything else is subordinated to

1. **Agent integration is the core — today that is Zed** (first surface, not
   the boundary; see `VISION.md`). Prompts land in the agent that owns the
   codebase — not in a chat next to it. The agent fixes, verifies, resolves
   with before/after evidence. No other tool in this class targets Zed.
2. **Speed.** Mark → agent knows it in ~1 s (event-time push, tiny payload
   first, live wake). The connection state is always visible and never lies
   (grey/red/amber/green = off / no bridge / no agent / agent live).
3. **Rapid-fire work sessions.** Fire 10 changes faster than the agent works —
   the store IS the queue: strictly ordered, oldest-first, nothing lost,
   in-page toast when each one is done. A sent nudge is not sealed: while it is
   still open you can append a follow-up to it ("+ ergänzen") — the same nudge,
   a later thought (append-only, re-wakes its agent; 0.19.0).
4. **Best-in-class UI picking.** Gliding highlight, layer chips (pick the
   ancestor you meant), Shift+Klick multi-select ("tausche diese beiden"),
   freehand lasso, pick-without-send ("das hier").

## Core: the connection must be reliable — and visibly so

The bridge between the Chrome extension and the Zed agent is the product's
backbone. It is self-healing (native host + session hooks) AND its state is
always visible, in both directions:

- [x] **Chrome, standing:** status circle (toolbar icon + pill dot) — grey off /
      red no bridge / amber no agent / **green = agent live**. Green never lies
      (heartbeat-backed). A green PULL owner (Claude CLI) additionally shows a
      „Pull"-Tag + tooltip: the agent is live but a nudge comes on the next
      terminal prompt, not by itself — green must not imply „kommt automatisch".
- [x] **Chrome, per nudge pill:** shows the nudge NUMBER (the chat referent);
      amber clock = accepted/stored, sweeping hand = agent live, gone = done
      (history with check marks lives in the queue popover only).
- [x] **Chrome, per prompt:** feedback the moment you send — „nudge_X — agent
      arbeitet" (send), „gespeichert — kein Agent" (clock), „Bridge offline —
      Warteschlange" (alert), „nudge_X erledigt" (check).
- [x] **Chrome, feedback feed:** all events listed unobtrusively top right —
      small chips with Lucide icons, max 4, self-fading. Connection losses and
      recoveries land there too.
- [x] **Zed, standing:** every message carries `[Nudge] Bridge ✓ · Agent-Watch ✓`
      + the current mark + queue count (UserPromptSubmit hook).
- [x] **Zed, live:** new prompts wake the agent (~1 s) and completions are
      reported in the conversation.

## Goals

- [x] Works on ANY localhost app — framework-agnostic by design (extension,
      not dev-server middleware). Roots apps are the first user, not the limit.
- [x] Prompt + context arrive as one unit the agent can act on without asking back.
- [x] The current mark is ambient agent context ("das hier" just works).
- [x] Connection truth at every step: icon, send-toast, per-message status line.
- [x] Evidence loop: resolve captures the after-state, invisibly.
- [x] Works for every Claude agent in every project: global store (~/.claude/nudge),
      user-level skill + hooks, zero per-project config (2026-07-05).
- [x] Parallel localhosts (multiple worktrees, each its own dev server + agent)
      route to their own agents — per-host ownership, no cross-wake (2026-07-07).
- [ ] Team-ready: one extension install + one setup script per person.

## Non-goals

- **No annotation/collaboration tool.** No persistent markers, no threads, no
  assignees — that is the Estimate comments feature, not Nudge.
- **No history.** Only "what is marked NOW" and the open queue matter; resolved
  prompts persist solely as evidence for the agent.
- **No browser automation or audits.** Agent→browser (navigate, click, Lighthouse)
  is Playwright/browser-tools territory.
- **No own agent, no cloud, no accounts** (anti-Stagewise-app): localhost is the
  trust boundary, Zed is the brain.
- **No framework adapters** (anti-Frontman): nothing that only works in Vite/Next/Astro.

## Accepted trade-offs — the price of the USP

- **Chrome-only, manual install** (Load unpacked + one setup script, per person).
  Price of `captureVisibleTab`-quality screenshots and full generality; a
  dev-server plugin would be zero-install but framework-bound and screenshot-less.
- **Bridge lifecycle is owned by Chrome** (native messaging host starts it
  detached; SessionStart hook remains as fallback). Residual: if Chrome AND all
  sessions are gone, nothing runs — by design (no daemon).
- **Pull-based agent delivery under the hood** (Zed has no push channel —
  maintainer-confirmed). The Monitor wake + hook context make it FEEL push;
  a mid-task prompt waits until the agent's current step yields.
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
