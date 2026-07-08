# Decisions

Why nudge-extension is shaped the way it is — the meta/workflow choices a future
developer (or agent) would otherwise re-litigate. Product goals, trade-offs and
non-goals live in `PRODUCT.md`; this file does NOT duplicate them. Newest first.

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
or contradict work done. Follow-ups accrue as `amendments` (Nachträge); the
original plus its nachträge are ONE work order, newest is the latest thought.
Rejected — editing the original text: dishonest and untraceable.
