# Vision

The timeless core of Groundworks Nudge. This file changes almost never —
consult it before any decision about scope or direction. Current-state lives
in `PRODUCT.md`; why a shape exists lives in `DECISIONS.md`.

## Mission

**Groundworks Nudge is the companion extension for coding agents: you point
at the rendered UI, type what you want, and the agent that owns the codebase
does the work.** Prompts are strictly ordered, nothing is lost, and a nudge
is done only with proof. The short name is Nudge.

## Who it serves

UI designers who vibe-code their own apps or visually polish an existing
codebase. Their hardest problem in agentic development is the last visual
mile — spacing, alignment, type, the final pixels — where prose prompts
("a bit more spacing") are weakest and pointing is everything.

## Agent-agnostic by intent

Nudge serves EVERY agent that owns a codebase — IDE agents, CLI agents,
MCP-connected agents. Claude Code and Codex ship with native Skill adapters;
every other local agent uses the same CLI. The store and the protocol stay
agent-neutral, so a new agent surface is an adapter, never a rewrite.

## The order of things (what everything is subordinated to)

1. **Agent-native.** Prompts land in the agent that owns the codebase — never
   in a chat beside it. The agent fixes, verifies, resolves with evidence.
2. **Honest speed.** Mark → agent in seconds, and the connection state is
   always visible and never lies.
3. **Rapid-fire.** Fire feedback faster than the agent works; the queue
   guarantees order and completeness.
4. **Best-in-class picking.** Pointing at the pixel must feel better than
   describing it.

## Timeless non-goals

- **No annotation/collaboration tool** — no persistent markers, threads,
  assignees. Nudge is a work queue, not a whiteboard.
- **No own agent, no cloud, no accounts** — localhost is the trust boundary;
  the agent is the brain.
- **No framework adapters** — works on ANY localhost app, or it isn't Nudge.
