# Agent notes for this repository

This checkout is **Nudge itself** (Chrome extension + local bridge + Skill).
Two different jobs land here. Do not mix them up.

## Using Nudge (the common case)

You are not meant to work in this checkout. Nudge is a user-level install.

1. Follow [INSTALL.md](INSTALL.md) once (Chrome extension, native host, `./agent/setup-agent.sh`).
2. Open a session **on the project you want to change**.
3. Invoke the Skill:

```
/groundworks-nudge
```

In T3 Code: open a thread on that project, pick Claude Code, Codex or Grok,
then type `/groundworks-nudge` or choose it from `$`. There is no T3 plugin.

Without that Skill the toolbar stores prompts and waits. The Skill is the
trigger, every runtime, every time. Details: [agent/NUDGE-SKILL.md](agent/NUDGE-SKILL.md).

## Changing this repository

Read [docs/VISION.md](docs/VISION.md) before proposing scope. A change that
crosses a non-goal (annotation tool, cloud, framework adapter) will not merge.

Then [CONTRIBUTING.md](CONTRIBUTING.md). Short version:

- English only: code, comments, UI, agent-facing strings, docs, changelog.
  No personal names, machine paths or ids.
- Opt-in fence: a session appears in the browser only after the user invoked
  the Skill in it. Do not arm a watcher or inject context any other way.
- No bundler, no TypeScript, no framework in `extension/`. Load unpacked.
- Store schema and bridge HTTP/WS routes change additively, with tests in the
  same change.
- Fast gate: `cd test && npm run test:ci`. Touch the overlay or the bridge →
  also run the Playwright suites named in [test/protocols.md](test/protocols.md).
- Bump `extension/manifest.json` (and the bridge version if the bridge
  changed) and add a [CHANGELOG.md](CHANGELOG.md) entry in the same change.

`bridge/native-host-wrapper.sh` is generated per machine. Do not commit it.
