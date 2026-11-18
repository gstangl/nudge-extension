# Decisions

Why nudge-extension is shaped the way it is — the meta/workflow choices a future
developer (or agent) would otherwise re-litigate. The timeless core lives in
`VISION.md`; product goals, trade-offs and non-goals in `PRODUCT.md`; this file
does NOT duplicate them. Newest first. **If two entries conflict, the newer
date wins.**

## A page's own choice travels as a declared send (2026-11-18)
The Groundworks sandbox wanted to give the agent a verdict on its variants
(develop these further, final, reject). Teaching Nudge the picker's markup
would be exactly the framework adapter VISION rejects. A first version
(2026-11-16) let any page declare units and intents and put them into Nudge's
pick mode and composer; in the first hands-on test the owner found Nudge's
tools in the way: choosing drafts is not pointing at elements, the DOM chips
meant nothing there, and the highlight was not the bar's own. Now the page
renders the choice itself and marks a send control (`data-nudge-send`, the
selected units, a text field); Nudge only carries it, on a trusted click, and
reports back. Kinds and intent ids stay opaque tokens whose meaning lives in
the project that declares them (for the sandbox: its playbook). Transport
stays Nudge's: the right session, wake, queue, delivery status and withdrawal
are the same problem as for any nudge.
The page also owns the follow-up (2026-11-18): Nudge reports each of its
nudges' state to the page and withdraws one on a trusted click, and a page
may declare itself quiet, so Nudge's toolbar and toasts stay out of sight
while the bridge keeps working; the icon then shows or hides the toolbar
instead of switching Nudge off.
Rejected — a separate bridge or a page posting to the bridge itself: a second
send path without Nudge's queue, ownership and connection truth, and any local
page could hand the agent work the user never asked for. Rejected — writing
the choice to the sandbox's own files for an agent to watch: it would rebuild
wake, routing and feedback for every runtime.

## The bridge stays JavaScript — Rust experiment ended (2026-10-27)
An experimental Rust bridge was built and compared against the JavaScript
bridge under a frozen policy (issue #12, branch `agent/bridge-comparison`,
results in `docs/bridge-comparison-handoff/MACBOOK-AIR-RESULTS.md` there). On
an Apple M2 laptop with real Google Chrome, Send-to-watcher latency was the
same for both (p50 ≈ 21 ms; JavaScript p95 22 ms), so the required p95 gain of
20 ms cannot exist: both share the same dispatch-to-watcher floor. Rust's only
win was bridge-process memory (13 vs 90 MB), which is neither a dominant cost
nor the whole footprint: the watcher, CLI and hook still need Node, so Rust adds
a toolchain without removing one. Matching existing behaviour was the real cost:
one review session found eleven compatibility defects in the Rust port (receipt
signatures, store parsing, owner ties, inbox files, host discovery). The
experiment is closed; no Rust code ships. Two JavaScript fixes made along the
way (retired-socket guard in the extension, crash-safe withdrawal journal in
the bridge) exist only on that branch and would be taken over separately.
Rejected — finishing the Rust port (native launcher, soaks, full parity): no
measurable user benefit at this scale. Reopen only with a dominant, measured
whole-process cost or an installation failure class Rust would actually remove.

## Open source: pull requests from forks, main stays green (2026-09-12)
The repository is public. Contributors work on a fork or a branch and open a
pull request; CI (`npm run test:ci`) must be green before merge, and the
self-contained Playwright suites named in `CONTRIBUTING.md` are run for any
change to the extension or bridge. The maintainer may still commit small
changes directly to `main` (the single-stream rule below was written for a
one-person repo and remains valid for that case), but contributor work always
arrives as a reviewed PR. The product language is English throughout: code,
comments, UI strings, agent-facing strings, docs and changelog.
Rejected — a `develop` branch or release branches: no release train exists;
the extension version in `manifest.json` plus the changelog IS the release.

## VISION.md extracted — the timeless core gets its own file (2026-07-09)
The mission was buried in `PRODUCT.md` between `[x]`-goals and scoreboard —
timeless mixed with snapshot. Agents (the main readers) need a stable
north-star anchor they always consult. `VISION.md` now holds ONLY what almost
never changes: mission (companion extension for ALL coding agents — a new
surface is an adapter, never a rewrite), audience (UI designers who vibe-code or
visually polish), priority order, timeless non-goals. `PRODUCT.md` keeps the
changeable rest and points to it.
Rejected — a fourth doc that paraphrases PRODUCT.md: pure drift-fodder; the
content was MOVED, not copied.

## Standalone repo — not a monorepo folder, not a git worktree (2026-07-08)
Nudge has zero code dependency on roots-apps (no `@roots` imports, only dep is
`ws`), does not deploy with the Worker, and shares nothing with the pipeline /
D1 / CI. Living as `roots-apps/nudge` meant other sessions switched the shared
checkout's branch under the running extension — the toolbar kept vanishing.
Rejected — a git worktree: its purpose is parallel branches of the SAME project;
nudge is not that. It would only paper over the shared-checkout contention.

## Single-stream on main — no feature branches, no worktrees (2026-07-08)
Nudge is worked one thing at a time. Develop on main, commit on main.
Rejected — feature branches: there is no review gate here, so they are pure
overhead and reintroduce the checkout contention they were meant to avoid.

## Model = the session that owns the localhost, not a per-nudge field (2026-07-08)
A nudge WAKES an already-running Zed session; it cannot switch that session's
model mid-conversation. To run a project's nudges on Sonnet, open a Sonnet
session and make it the owner in the Switch-session dropdown.
Rejected — a per-nudge `model` field + delegate-to-subagent: unnecessary
complexity, and the subagent lacks the session's context. Re-propose only if
mixing models WITHIN one project becomes a real need.

## Amendments are append-only — the original nudge text is immutable (2026-07-07)
The agent may already have acted on the original; a silent edit would be ignored
or contradict work done. Follow-ups accrue as `amendments`; the
original plus its amendments are ONE work order, newest is the latest thought.
Rejected — editing the original text: dishonest and untraceable.
