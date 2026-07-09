# nudge-extension — a strong bidirectional bridge between Zed and Chrome

## Goal

**Make the Zed IDE and Google Chrome talk to each other — reliably, fast, and
visibly, in BOTH directions.** The agent that owns the codebase lives in Zed;
the rendered UI lives in Chrome. This project is the bridge between the two:

- **Chrome → Zed:** pick an element (or circle a region) on any running
  localhost app and say what you want — the agent receives the prompt WITH full
  browser context (selector, xpath, text, styles, console + network errors,
  screenshots) and acts on it. Prompting on the pixel, not about it.
- **Zed → Chrome:** the agent's state and results flow back into the page —
  honest live status (green = an agent is listening NOW, heartbeat-backed),
  per-prompt feedback chips, „nudge_X done" completion toasts, and
  resolve-with-proof after-screenshots.

The connection IS the product: self-healing (Chrome owns the bridge lifecycle
via a native messaging host), honest (the status circle never lies), and fast
(mark → agent context < 2 s, prompt → agent wake ~1 s measured). Timeless
vision: `VISION.md` · full product definition and trade-offs: `PRODUCT.md` ·
end-user install: `INSTALL.md` · test contract: `test/protocols.md`.

**Nudge = pixel nudging with the agent — you pin a PROMPT onto the running UI**
(Gerald, 2026-07-04): pick an element in Chrome → write what you want → send →
the agent gets text + selector + source hint + screenshots and ACTS.
Fire-and-forget — nothing stays on the page; feedback is the toast, the
in-flight badge, and the status circle. Historic name: Pin; grown inside the
roots-apps monorepo, extracted to this standalone repo 2026-07-08 (zero code
dependencies on it — works on ANY localhost app, framework-agnostic by design).

## Verified

Automated suites A–N (isolated e2e, bridge-brutal, provenance/kidnap
battletests, origin routing, toolbar UX, page inertness, amend) — runners,
guards and last results in `test/protocols.md`. Screenshots demonstrably reach
the model (agent reads `~/.claude/nudge/shots/*` directly — proven daily in
live use).

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
            - pill toolbar, draggable: status dot, Pick + Freeform (hotkeys
              P/F), open-prompt counter → Nudge History popover (open + done,
              append-only follow-ups „+ ergänzen"), owner line
              „Agent: <session> <id8> ⟨localhost:port⟩" + Switch-session
              dropdown (per-localhost ownership — parallel worktrees route to
              their own agents)
            - element picker (hover highlight + source chip) with LAYER CHIPS
              (pick the ancestor you meant), Shift+click multi-select;
              selectors via vendored @medv/finder (extension/vendor/finder.js, MIT)
            - freehand lasso (circle a region; stroke burned into the
              screenshot, polyline stored as annotation)
            - FIRE-AND-FORGET: a sent prompt leaves NOTHING on the page except
              a readable NUMBER pill per open prompt (the number is the chat
              referent: „Nudge 123 macht das"). Feedback = feed chips under
              the toolbar + badge + status dot (grey/red/amber/green)
            - RESOLVE WITH EVIDENCE (invisible): resolve triggers an
              after-screenshot of the same region in the open browser
            - offline queue: bridge down → the prompt parks in chrome.storage
              and is re-sent on reconnect
            - page inertness: reaching for the toolbar never dismisses the
              page's own popovers/dropdowns (moat + window-capture swallow)
            - options page: author name, attached to every prompt
agent/      the Zed/Claude side: NUDGE-SKILL.md (the /nudge skill),
            nudge-context.mjs (UserPromptSubmit hook: current mark as ambient
            context, opt-in per armed session), nudge-session-start.sh
            (SessionStart hook: bridge self-heal fallback), setup-agent.sh
            (installs skill + hooks into ~/.claude, idempotent)
test/       suites A–N + latency bench + hardening; contract in protocols.md
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
after code changes. An orphaned tab (reload raced it) shows a „⌘R" hint pill
instead of losing the toolbar silently.
Caveat: works for real "Load unpacked" installs; under Playwright's
`--load-extension` the runtime.reload() kills the extension instead, so
autoreload-check.mjs cannot fully pass in CI - verify manually.

## Install (once per machine) — end-user guide: INSTALL.md

1. `cd bridge && npm install`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
   `extension/`
3. `./install-native-host.sh [extension-id]` — registers the native messaging
   host: from then on **Chrome starts the bridge itself** (detached, survives
   service-worker suspends). No MCP entry, no per-project config. NOTE: the
   unpacked extension id derives from the absolute directory path — moving the
   repo means re-running this with the new id from chrome://extensions.
4. `agent/setup-agent.sh` — installs the /nudge skill + hooks into `~/.claude`.

Agent side is GLOBAL (works in every project): store `~/.claude/nudge/`, skill
`~/.claude/skills/nudge/`, hooks in `~/.claude/settings.json` (SessionStart =
self-healing, UserPromptSubmit = current mark as context, opt-in per session).

## Use

1. Open any `http://localhost:*` page (demo: start bridge manually
   `node bridge/bridge.mjs` → http://localhost:4700/demo).
2. Pill toolbar, draggable (toggle: toolbar icon or Alt+C) → "Pick" (P) → click
   an element → prompt + ↩ (Shift+↩ = newline; empty ↩ = numbered mark —
   reference it in Zed as „Nudge 123 macht das").
3. Agent side: type `/nudge` in the Zed session that should own the channel —
   it arms the watcher, reports which localhost it owns, and processes prompts
   oldest-first; resolve via `POST /comments/<id>/resolve` after the verified
   fix. With parallel dev servers, pick the owner per localhost in the
   toolbar's Switch-session dropdown.

## Known limitations (deliberate)

- `<all_urls>` host permission: `captureVisibleTab` rejects narrow host
  patterns; localhost is the trust boundary (CORS restricted to localhost).
- Source hints via `data-*` attributes only (Astro/JSX-style); runtime-built
  DOM (TipTap) keeps selector + class names as the hint.
- Bridge lifecycle is Chrome's: if Chrome AND all sessions are gone, nothing
  runs — by design (no daemon).
- chrome://extensions → Fehler shows PAGE warnings/errors as phantom extension
  errors (the console hook wraps console.warn/error). Cosmetic, dev-mode only.
