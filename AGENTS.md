# AGENTS.md

This checkout is **Groundworks Nudge**: a shared Chrome/Safari extension core,
a local Node bridge, and the Skill `/groundworks-nudge`. Safari is a temporary
developer preview; its acceptance limits live in [docs/SAFARI.md](docs/SAFARI.md).
Two jobs. Do not mix them.

## Using Nudge

Do not work in this checkout. Follow [INSTALL.md](INSTALL.md) once, then in
the **project you want to change** invoke `/groundworks-nudge`. Without that
Skill the toolbar stores prompts and waits. The Skill is the trigger, every
runtime. Tested: terminal, Zed, T3 Code.

## Changing this repository

### Intent — read one file, not three

| If you are… | Open |
|---|---|
| proposing scope or a new capability | [docs/VISION.md](docs/VISION.md) — non-goals are hard rejects |
| changing current behaviour | [docs/PRODUCT.md](docs/PRODUCT.md) |
| reversing a past choice | [docs/DECISIONS.md](docs/DECISIONS.md) — newer date wins |
| unsure which | [docs/README.md](docs/README.md) |

Do not load all three by default. One home per rule: link, do not copy.

### Commands

```sh
cd test && npm run test:ci
```

Touch `extension/` or `bridge/` → also run the Playwright suites named in
[test/protocols.md](test/protocols.md) (start with Suite A). Human process
and full test map: [CONTRIBUTING.md](CONTRIBUTING.md).

### Do

- English only. No personal names, machine paths, or ids.
- Opt-in fence: a session is armed only after the user invoked the Skill in it.
- Store schema and bridge HTTP/WS routes change additively, with tests in the
  same change.
- Bump `extension/manifest.json` (and the bridge version if the bridge
  changed) and add a [CHANGELOG.md](CHANGELOG.md) entry in the same change.

### Never

- Bundler, TypeScript, or a framework in `extension/`. Load unpacked.
- Commit `bridge/native-host-wrapper.sh` (generated per machine).
- A second agent constitution (`CLAUDE.md` is a pointer here; do not add
  Cursor rules or a parallel instruction file).
- Annotation tool, cloud, accounts, or framework adapters (see VISION).

### Done

`npm run test:ci` green. Overlay/bridge: the Playwright suites in
`test/protocols.md`. Changelog and version bumped. PR template filled.
A claim that the tests passed is not proof — run the command.
