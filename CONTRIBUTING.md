# Contributing to Nudge

Thanks for helping. This page tells you how the repository works so that a
pull request lands without surprises.

If you are a coding agent working **in this checkout**, start at
[AGENTS.md](AGENTS.md). If you only want to *use* Nudge on another project,
stop here and follow [INSTALL.md](INSTALL.md) — invoke `/groundworks-nudge`
there, not here.

Read [docs/VISION.md](docs/VISION.md) first: it lists the non-goals (no
annotation tool, no cloud, no framework adapters), and a PR that crosses one
of them will not be merged however good the code is.

## Dev setup

```sh
git clone https://github.com/gstangl/nudge-extension.git
cd nudge-extension
(cd bridge && npm ci)             # locked runtime dependency: ws
(cd test && npm ci)               # locked vitest + playwright
(cd test && npx playwright install chromium)   # browser for the e2e suites
```

For actual project use, follow [INSTALL.md](INSTALL.md) for Chrome or the
[temporary Safari guide](docs/SAFARI.md). Browser tests below stage isolated
resources and do not require installing into your everyday browser. The shared
extension is plain JavaScript without a bundler; Safari resources are staged
deterministically. The bridge and CLI are plain ES modules run by Node 22+.

**Dev auto-reload.** While a bridge runs, it watches `extension/`. On any
change it tells the extension to reload itself and refreshes the localhost
tabs. You edit, you switch to Chrome, the new code is there. (Under
Playwright's `--load-extension` the reload kills the extension instead, so
`test/autoreload-check.mjs` is a manual check.)

**Bridge changes.** Follow the identity-checked
[restart instructions](INSTALL.md#updating). Never stop an unknown listener or
the live shared bridge to run tests; test bridges use separate ports and stores.

## Tests

Three layers. Run the first before every push; run the relevant Playwright
suites when you touch the extension or the bridge.

1. **Fast gate, required in CI**
   ```sh
   cd test && npm run test:ci
   ```
   Vitest units for `store.mjs` and `runtime.mjs`, the runtime-neutral
   integration (real bridge, real watcher, CLI, hook), and the idempotent
   installer check. Takes a few seconds, needs no browser.

2. **Playwright suites**, each a standalone script with its own bridge on a
   side port and a throwaway store. The contract, the legs and the last
   results are in [test/protocols.md](test/protocols.md). The ones every
   contributor can run are listed below. Prefer the serial isolated runners:

   ```sh
   node test/run-portable-regression.mjs
   node test/run-browser-regression.mjs --headless
   node test/browser-parity.mjs --chromium --headless
   node test/browser-coexistence.mjs --chromium-only --headless
   ```

   Do not run them concurrently. For an individual browser suite, stage a
   native-disabled test package **before** loading its worker. Setting only
   `nudgePort` after startup is too late to prevent native autostart:

   ```sh
   node scripts/package-safari.mjs --mode test --use-storage-port --out artifacts/safari/manual-test-extension
   export NUDGE_EXT="$PWD/artifacts/safari/manual-test-extension"
   export NUDGE_NO_RELOAD=1
   ```

   This package is only for tests, never the Safari project installation.
   Individual suites (from the repository root, with that test environment):

   ```sh
   node test/e2e.mjs               # Suite A: the core end-to-end run
   node test/bridge-brutal.mjs     # Suite D: adversarial bridge (about 90 s)
   node test/bridge-hardening.mjs
   node test/fixture-gauntlet.mjs  # Suite F: third-party UIs (needs python3)
   node test/origin-routing.mjs    # Suite K
   node test/toolbar-ux.mjs        # Suite L
   node test/page-inertness.mjs    # Suite M
   node test/amend.mjs             # Suite N
   node test/escape-clear.mjs      # Suite O
   node test/multi-select.mjs      # Suite P
   node test/reload-resilience.mjs # Suite Q
   node test/wake-mode.mjs         # Suite W
   node test/cancel.mjs            # Suite X
   node test/capture-stall.mjs     # Suite Y
   node test/off-means-off.mjs     # Suite Z
   node test/hook-optin.mjs        # Suite G
   node test/provenance.mjs        # Suite H
   node test/battletest.mjs        # Suite I (needs python3)
   ```
   Suites E, B and J (`real-apps.mjs`, `live-drill.mjs`, `cross-app.mjs`)
   drive the maintainers' private apps and are not runnable from this
   repository alone.

3. **Manual drills** listed in `test/protocols.md` under Suite C, each tied to
   a trigger ("run after X changed").

Standing rules: tests never touch port 4700 or the live store; every suite
uses its own side port. If an interrupted run leaves a bridge or watcher
behind, kill it by its side port, never by process name (a `watch-nudges`
process is usually somebody's real armed session). Verify the listener belongs
to the exact test before stopping it; an occupied side port may be unrelated.

External tools the test layer needs: Node 22+, Playwright's Chromium
(`npx playwright install chromium`), and `python3` for the two suites that
serve static fixtures with `http.server`. The product itself needs none of
these.

## Versioning and changelog

- The extension version in `extension/manifest.json` is the product version.
  The bridge has its own version in `bridge/bridge.mjs` (`VERSION`) and
  `bridge/package.json`.
- Bump on every behaviour change, and add a `CHANGELOG.md` entry in the same
  change (Keep a Changelog format, newest first, `Added / Changed / Fixed /
  Removed / Security`). No silent releases.
- Write the entry for the reader who hits the behaviour, not for the author:
  what changed, why, and how it is proven (which suite leg).

## Code conventions

- **Plain ES modules, no bundler, no TypeScript, no framework** in the
  extension. This keeps "load unpacked" a one-click install and lets the bridge
  reload the extension without a build.
- **English everywhere**: code, comments, UI strings, agent-facing strings,
  docs, changelog. No personal names, machine paths or ids in the repository.
- Comments explain *why*, and bug lessons keep their date ("2026-07-29: a
  stalled capture used to hide the toolbar"). That history is how the next
  person avoids re-breaking things.
- The store schema (`~/.nudge/store.json`, the `inbox/*.md` mirrors) and the
  bridge HTTP/WS routes are contracts between three parts that update
  independently. Change them additively, and update `test/unit/store.test.mjs`
  and the affected suites in the same PR.
- Keep the opt-in fence: a session appears in the browser only after the user
  invoked the Skill in it. No code path may arm a watcher or inject Nudge
  context into a session that did not opt in.
- Vendored code (`extension/vendor/finder.js`) is replaced wholesale from the
  upstream dist build; keep the `window.__nudgeFinder` export line.

## Pull requests

1. Fork or branch, one topic per PR. Small is good.
2. Run `npm run test:ci` and the Playwright suites that cover what you touched.
   Name them in the PR description.
3. Bump the version and add the changelog entry.
4. If you changed a workflow decision (how the repo is organised, not what
   the product does), add a dated entry to `docs/DECISIONS.md`, newest first,
   with what was rejected and why.
5. Fill in the PR template. CI must be green.

Where to start: `test/scenarios.md` has a backlog of edge cases worth
automating, and Windows support for the native host installer is open. The
terminal, Zed and T3 Code are tested; reports from other agent surfaces still
help. Good first issues are labelled `good first issue` when they exist.

## Reporting bugs and security issues

Bugs: open an issue with the template. Security: see
[SECURITY.md](SECURITY.md). Please do not file vulnerabilities as public
issues.
