# Decisions

Why nudge-extension is shaped the way it is — the meta/workflow choices a future
developer (or agent) would otherwise re-litigate. The timeless core lives in
`VISION.md`; product goals, trade-offs and non-goals in `PRODUCT.md`; this file
does NOT duplicate them. Newest first.

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
