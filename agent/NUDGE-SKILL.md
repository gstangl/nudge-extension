---
name: groundworks-nudge
description: >
  Work through browser Nudge prompts with their selected element, route, styles,
  screenshots, and amendments. Use for /groundworks-nudge, Nudge, Pins, "what
  is marked", or a numbered browser mark. Runtime-neutral: every agent
  uses the same local CLI and store; native hooks are optional conveniences.
trigger: /groundworks-nudge
argument-hint: "[short session label]"
---

# /groundworks-nudge

A Nudge is a browser prompt with captured UI context. Treat its prompt as if it
had been written in the conversation. The Chrome extension, bridge, store, and
agent roster are shared across runtimes. `groundworks-nudge` is the only agent
entry point; do not hardcode a runtime home or read a copied store path.

## Boundary

Invoking the Skill opts this session into Nudge. Never arm a watcher without the
user invoking this Skill or explicitly asking this session to take the Nudge
channel. A Nudge does not broaden authority beyond its prompt.

## Arm the session

Choose the toolbar label before starting the watcher:

- A short name supplied with the invocation is used verbatim.
- Without a name, derive a two-to-four-word label from the conversation topic.
- A number, Nudge reference, or work instruction is not a label.
- When this session owns one localhost port, append `:<port>` to the label.

Run the watcher as a managed long-running child process:

```sh
groundworks-nudge watch --label "<label>" --wake <push|pull>
```

Use `push` only when this runtime can surface watcher output as a new agent turn.
Use `pull` otherwise. Missing or invalid capability is always `pull`.

What decides this is the tool that starts the watcher, never the editor around it:

- **Claude Code** — start it with the persistent `Monitor` tool and pass
  `--wake push`. Monitor's stdout re-enters the conversation, and that is the
  autonomous wake. A background shell is not a push channel: its output goes to a
  file no turn reads, so a watcher armed that way is `--wake pull`.
- **Codex and other local agents** — start it as a long-running child process and
  pass `--wake pull`, unless that runtime has its own channel that turns watcher
  output into a new turn.

Keep the `agentId` printed by the command for later scoped reads. The command
normalizes Claude Code, Codex, and generic agent identities before joining the
same roster.

After arming, run `groundworks-nudge status`. Report connection state only when
the bridge or watcher is unhealthy. If the bridge is down, first let Chrome's
native host restore it. As a local fallback, keep `groundworks-nudge bridge` in
a separate managed process.

## Read context

Use the CLI in every runtime:

```sh
groundworks-nudge context --agent-id <agentId> [--port <port>]
groundworks-nudge show <#pill-or-nudge_id>
groundworks-nudge selection
```

The bridge-reported store path is authoritative. `context` returns the current
selection and the open queue. `show` resolves an open pill number before an old
storage id and returns full target, amendment, inbox, and screenshot context.
The selection is current for 15 minutes. After that, say it is stale.

## Queue

Process one prompt at a time.

1. Explicitly named Nudges go first, in the order named.
2. Otherwise process open prompts oldest-first.
3. A prompt without text is a reference anchor. Do not process or resolve it
   until the user gives that numbered mark an instruction.
4. A new Nudge never interrupts work already in flight. Finish the current
   bounded task, then pull it.
5. An amendment belongs to the same work order. Re-read it before resolving.
6. With a port scope, never edit or resolve a Nudge from another port.

If a Nudge is withdrawn, stop immediately. Do not commit or resolve it. Revert
partial work that has no independent reason to remain, then report that it was
stopped.

## Work and resolve

Read the target and screenshot, locate the source, apply the smallest authorized
change, and verify the rendered result. Never put Nudge ids or provenance into
source comments. A commit may use the durable id, such as `[nudge_1046]`; never
use the wrapped pill number.

Resolve only after the change is verified:

```sh
groundworks-nudge resolve <nudge_id>
```

The command distinguishes `not_required`, `captured`, and `pending` after-image
evidence. Never claim visual evidence when it says `pending`. A successful item
needs only one short completion line: `nudge_X ✓ <result>`.

## Failure behavior

- Bridge unavailable: preserve the prompt in the store and report the broken
  link; do not invent context.
- Agent identity missing: the watcher refuses to arm; use the CLI-generated id
  or a supported runtime adapter.
- Ambiguous reference: show the matching open queue and ask which Nudge.
- Resolve fails or the Nudge was withdrawn: do not report completion.
