# nudge — UI prompting from the browser → Zed agent

Grew out of the spike in `docs/plans/pin-visual-comments-plan.md` (historic name: Pin).
**Nudge = pixel nudging with the agent — you pin a
PROMPT onto the running UI** (Gerald, 2026-07-04): pick an element in Chrome →
write what you want → send → the agent gets text + selector + source hint +
screenshots and ACTS. Fire-and-forget — nothing stays on the page; feedback is
the toast, the in-flight badge, and the status circle (green = an agent is
listening live and will act NOW).

## Verified

Two automated suites, run + status in `test/protocols.md`:
- **Suite A** `node test/e2e.mjs` — isolated (own bridge, fresh store, demo page).
- **Suite B** `node test/live-drill.mjs` — live chain (real bridge/store, estimate
  app, generic app, rapid-fire, self-healing).
Screenshots demonstrably reach the model (agent reads `~/.claude/nudge/shots/*`
directly — proven daily in live use).

## Parts

```
bridge/     @roots/nudge-bridge — one node process (dep: ws), two surfaces:
            bridge.mjs      HTTP :4700 (prompts, selection, resolve, /.identity,
                            /demo) + WebSocket (prompt list + agentLive pushes)
                            + dev auto-reload watch
            store.mjs       store owner (GLOBAL ~/.claude/nudge): mtime-cached
                            read, change events, projections, inbox md mirror
            watch-nudges.mjs  agent watcher: fs.watch on the store (event-driven
                            wake, ms not seconds) + bridge heartbeat every 2 s
            native-host.mjs Chrome-spawned launcher — ensures the bridge runs
                            (detached); install-native-host.sh registers it
extension/  Chrome MV3, load unpacked (styles.js = shadow-DOM CSS, content.js =
            logic; hover chip uses a cheap path, the unique finder selector is
            computed only on click). Shadow-DOM overlay:
            - pill toolbar top right: connection dot (green = bridge reachable),
              two mode buttons, open-prompt counter
            - element picker (hover highlight + source chip) with LAYER CHIPS:
              after the click, the composer shows the ancestor chain (td -> tr
              -> table) so you pick the level you meant (Bolt's "pick from
              layers" pattern); selectors via vendored @medv/finder
              (extension/vendor/finder.js, MIT)
            - freehand lasso (circle a region with held mouse button,
              Cursor-Design-Mode-style; stroke burned into the screenshot,
              polyline stored as annotation)
            - FIRE-AND-FORGET: a sent prompt leaves NOTHING on the page.
              Feedback = toast on send + pill badge (open prompts on this
              route, SPA-aware) + status dot/icon: grey = overlay off, red =
              no bridge, amber = bridge but no agent listening, green = agent
              live (watcher heartbeats the bridge -> prompt acted on NOW)
            - RESOLVE WITH EVIDENCE (invisible): resolve triggers an
              after-screenshot of the same region in the open browser;
              the store keeps it, inbox md links both
            - offline queue: bridge down -> the prompt parks in chrome.storage and is
              re-sent on reconnect
            - context per pin: computed-styles subset, console errors/warnings
              AND network failures (fetch/XHR >= 400) via MAIN-world hook,
              annotated crop (PNG) + downscaled full-viewport overview (JPEG)
            - options page: author name, attached to every pin
test/       e2e.mjs (Suite A), live-drill.mjs (Suite B), autoreload-check.mjs
            (caveat below), design-shots.mjs + feed-shot.mjs (UI review),
            gen-icons.mjs, protocols.md (the structured test suite).
```

## Updating

- Versions: extension = manifest.json (= the PRODUCT version), bridge = VERSION
  in bridge.mjs + package.json. Bump on behaviour change — and **every bump
  gets a `CHANGELOG.md` entry in the same change** (Keep-a-Changelog format,
  newest first). No silent releases.
- Vendored `extension/vendor/finder.js` (@medv/finder, MIT): replace the file
  with the new upstream dist build, keep the `window.__nudgeFinder` export line.
- Bridge code changes: kill the process on :4700 — the extension revives it via
  the native host with the new code (or the next session hook does).
- Extension changes reload themselves while a bridge runs (see below).

## Dev auto-reload

The bridge watches `extension/` (fs.watch). On change it broadcasts `reload`
over the WS; the SW refreshes the localhost tabs first, then calls
`chrome.runtime.reload()` (crx-hotreload pattern) - by the time the tabs
inject content scripts, the fresh extension is active. Zero manual clicks
after code changes.
Caveat: works for real "Load unpacked" installs; under Playwright's
`--load-extension` the runtime.reload() kills the extension instead, so
autoreload-check.mjs cannot fully pass in CI - verify manually.

## Install (once per machine) — end-user guide: INSTALL.md

1. `cd nudge/bridge && npm install`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
   `nudge/extension/`
3. `./install-native-host.sh [extension-id]` — registers the native messaging
   host: from then on **Chrome starts the bridge itself** (detached, survives
   service-worker suspends). No MCP entry, no per-project config.

Agent side is GLOBAL (works in every project): store `~/.claude/nudge/`, skill
`~/.claude/skills/nudge/`, hooks in `~/.claude/settings.json` (SessionStart =
self-healing + watcher arming, UserPromptSubmit = current mark as context).

## Use

1. Open any `http://localhost:*` page (demo: start bridge manually
   `node nudge/bridge/bridge.mjs` from repo root → http://localhost:4700/demo).
2. Pill top right, draggable (toggle: toolbar icon or Alt+C) → "Pick" → click an
   element → prompt + ⌘↩ (or send empty = just mark, then prompt in Zed).
3. Agent side: the `/pins` skill (global) — reads `~/.claude/nudge/` files,
   watch mode wakes the agent per prompt, resolve via
   `POST /comments/<id>/resolve` after the verified fix.

## PoC cuts (deliberate — see plan for the real versions)

- `<all_urls>` host permission: `captureVisibleTab` rejects narrow host patterns;
  production uses the activeTab gesture instead.
- No threads/replies on pins, no multi-select, no voice.
- Source hints via `data-*` attributes only (Astro/JSX-style). The Vite doc apps
  build their DOM at runtime (TipTap) — build-time attribute injection
  (code-inspector-plugin) cannot tag that; selector + est-* class names stay
  the source hint there.
- Bridge only runs while a Claude Code session is up (or started manually);
  the offline queue covers the gap.
- chrome://extensions -> Fehler shows PAGE warnings/errors as phantom extension
  errors: the console hook wraps console.warn/error, so Chrome attributes
  anything passing through to the extension. Cosmetic, dev-mode only; the
  CSP-safe alternative (inline page injection) is blocked on many setups.
