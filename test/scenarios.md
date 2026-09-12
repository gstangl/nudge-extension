# Nudge — Edge-Case Catalog (Testing Scenarios)

Every edge case, bug and lesson from the build sessions (2026-07-03 → 07-05),
mined from session memory. Each entry: symptom → root cause → coverage status.
**Status legend:** ✅ automated (suite leg named) · 🔧 worth automating (spec
below) · 🥁 manual drill (Suite C) · 📖 documented only (not worth automating).
Runners live in `protocols.md`; this file is the WHY behind every leg and the
backlog for new ones.

## A. Picking & Marking

**Fixture findings (Suite F, 2026-07-05):**
- **A-9** Pick on an `<a href>` (dropdown item, nav link) FOLLOWED the link — preventDefault on pointerdown does not cancel the trailing click; a hash link re-routed the SPA, a real link would unload the page mid-composer. Fix: swallow EXACTLY the one trailing click of the pick gesture at document capture (not a time window — that killed the next deliberate click and broke md-pdf's file dialog). ✅ Suite F F2.
- **A-10** finder rejected legit ids with short segments (`#g-modal-title`, `#dz-card` — any ≤2-char part fails its wordLike heuristic) and produced brittle class paths that broke on re-render. Fix: prefer a real, unique, non-machine-looking id before finder (DevTools convention). ✅ Suite F F1/F3.

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| A-1 | Pick on live re-rendering UI opened no composer (v2 comment rail) | mousedown→re-render destroys target→click never fires; ProseMirror layer overlays rail | ✅ pointerdown pick (suite passes) · 🔧 add explicit leg: demo button that re-renders itself on mousedown → pick still opens composer |
| A-2 | Picked element detached before send (ProseMirror re-render) → rect 0/0/0/0, 1 kB corner screenshot | editors replace DOM nodes between pick and send | ✅ Suite E E2 (real ProseMirror in estimate: clone+replace before send → pick-time rect survives) |
| A-3 | Foreign pointer events polluted the Freeform stroke (points from a second stream) | pointermove without pointerId/buttons guard | ✅ implicit (lasso leg); guard: only stroke-initiating pointer + primary button |
| A-4 | `setPointerCapture` throws on synthetic events (tests) | spec allows InvalidPointerId | ✅ implicit (try/catch; suite is synthetic) |
| A-5 | Freeform SVG was 300×150 despite `inset:0` | replaced elements don't stretch from inset; need explicit 100vw/100vh | ✅ implicit (lasso leg would fail) |
| A-6 | Empty send created eternal "[Mark only]" queue zombies (pin_55) | marks must not age as prompts; selection channel already carries them | ✅ Suite A "empty send = pure mark" |
| A-7 | Plain click EXTENDED an active multi-selection (≠ Finder/Figma convention + own docs) | convenience branch `e.shiftKey \|\| multi.length` | ✅ Suite A "click convention" |
| A-8 | Toolbar click dismisses page popovers (e.g. "Release final version?" — "Release final version?") — can't nudge transient UI | | events from our shadow chrome bubble composed to document = outside-click for the page → stopped at the HOST boundary (0.16.2). Limit: capture-phase document listeners still see it | ✅ Suite A "chrome inert" |

## B. Capture & Screenshots

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| B-1 | Crop landed in the wrong corner on Retina | page `devicePixelRatio` lies under emulation/zoom — derive scale from bitmap÷viewport | ✅ Suite A A2 (capture accuracy) |
| B-2 | `captureVisibleTab` rejects narrow host patterns | needs `<all_urls>` or activeTab GESTURE | 📖 (INSTALL/PoC-cuts; not CI-testable) |
| B-3 | Element pins carried screenshots (flicker, weight) | product rule: pixels only where pixels are the content | ✅ Suite A (element = DOM-only, Freeform = shot) + evidence lasso-only legs |
| B-4 | Overlay chrome leaked into evidence shots | hide pill/dots/composer before capture, restore after | ✅ implicit (after-shot leg) |

## C. Overlay UI (chrome quality)

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| C-1 | Badge glyph 2 px off-centre — INVISIBLE to eyeballing, caught only by measurement | (1) `.q-row.open svg` hit badge innards, (2) inline svg baseline, (3) `positionDots` re-showed with `display:block` killing flex | 🔧 leg "sub-pixel centring": for every `.dot`/`.q-dot`: svg-centre − badge-centre ≤ 0.5 px (evaluate snippet exists in session; cheap, catches a whole bug class) |
| C-2 | Clock sweep declared but possibly not running | CSS animation on `.d-hand`/`.q-hand` sub-group | 🔧 leg: computed `transform` of a hand sampled twice ≥300 ms apart must differ while suite-heartbeat live |
| C-3 | Grip icon blurry | hand-rolled 10×16 viewBox, subpixel radii — use stock Lucide geometry in the shared stroke pipeline | 📖 (visual; design-shots runner exists for eyes) |
| C-4 | Queue silently dropped oldest beyond 25 | cap without feedback | 📖 chip exists; unit-ish, low value |
| C-5 | Accordion expansion lost on live re-render | queue re-renders on every WS snapshot — persist expanded ids | ✅ implicit (accordion leg toggles across renders) |
| C-6 | Queue row TYPOGRAPHY + icon jittered on every open/close — the `.open` state swapped align-items + margin-top + line-height at once, so a one-line nudge changed height/baseline | collapsed and open must share ONE first-line geometry (18px line box, flex-start); only wrapping toggles | ✅ Suite A (accordion no-jitter: dot/id/text hold position across toggles; fixed 0.16.7) |
| C-7 | Toolbar popovers floated unattached — no caret pointing at what was clicked | a caret at `--caret-x` = anchor centre (badge / session label), clamped to the popover; overflow:hidden removed (it clipped the caret) | ✅ Suite A (queue + Switch-session caret aligned to their anchors; fixed 0.16.6 / 0.16.11) |
| C-8 | Feedback chips floated in the screen corner, overlapping the toolbar | anchor the feed directly UNDER the pill (left-aligned, even gaps) and track the movable pill via placeFeed | ✅ Suite A (feed under toolbar Δleft<3, Δtop 2–20; follows the pill on drag; fixed 0.16.12) |
| C-9 | An OPEN popover (Switch session / Nudge History) stayed put when the toolbar was dragged — position was computed only on open | reposition open popovers on every drag (shared anchorPopover), caret stays on its anchor | ✅ Suite A (popover follows the dragged toolbar, caret aligned; fixed 0.16.14) |

## D. Extension lifecycle (orphans, reload, queue)

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| D-1 | Orphaned content script after ext reload: swallowed clicks, dead composer | document-capture listeners survived host removal | 🥁 C-drill (reload ext with tab open) — automation needs runtime.reload which dies under `--load-extension` |
| D-2 | Orphan reconnect loop spammed "WebSocket failed" forever | closing socket fires onclose→scheduleRetry; `dead` flag + detach handlers BEFORE close | 🥁 same drill |
| D-3 | Event fired in the ≤5 s window before orphan detection → "Extension context invalidated" | guard chrome.* call sites with `alive()` | 🥁 same drill |
| D-4 | Two tabs flushed the same offline queue → double-send | only the visible tab flushes | 🔧 leg: two pages in one context, bridge down→up, queue flushes exactly once (store count) |
| D-5 | Failed WS attempts log red console lines | browser-mandated; one line per reconnect while bridge down | 📖 unavoidable; self-healing keeps it rare |
| D-6 | After a bridge RESTART, an already-open tab keeps the OLD extension — the new bridge never saw the pre-restart file change, so no reload broadcast; and runtime.reload can't re-inject into a live tab | dev-loop truth: touch an extension file AFTER the bridge is stable to broadcast reload; a stubborn tab needs chrome://extensions reload + Cmd+R | 📖 documented dev-loop drill (bit the user 2026-07-06) — worktree/canonical split amplifies it |

## E. Bridge & Store

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| E-1 | Corrupt store.json silently wiped everything AND re-issued old ids | backup + seq floor from inbox mirrors | ✅ hardening H1 |
| E-2 | Crash mid-write corrupts store permanently | atomic tmp+rename (also selection.json) | ✅ hardening H4 |
| E-3 | CORS `*` let ANY website read /selection (DOM+screenshots!) | reflect localhost origins only | ✅ Suite A CORS leg |
| E-4 | Oversize body left socket hanging (end never fired) | answer 413, then drop | ✅ hardening H3 |
| E-5 | A throwing handler killed the whole process (missing demo.html sufficed) | dispatch-wide guard → 500 | 🔧 leg: request /demo with file temporarily renamed → 404/500, bridge still answers next request |
| E-6 | Resolved pins accumulated forever; every change broadcast full history | prune >7 d at start; snapshot diet (open + last 40 done) | 🔧 leg: seed resolved pin with old resolvedAt → start bridge → pruned incl. files |
| E-7 | Selection posts (hover frequency!) rebroadcast the full pin list | skip broadcast for kind='selection' | 🔧 mini-leg: WS client sees NO pins frame on POST /selection |
| E-8 | Wake latency 23.7 ms via fs.watch (FSEvents coalescing) | WS push path: 2.1 ms median (11.4×) | ✅ latency-bench (reference values in protocols.md) |
| E-9 | WS push beat the POST response (line before fetch resolved) | broadcast fires before HTTP reply — consumers must buffer | ✅ bench `early` buffer (lesson encoded there) |
| E-11 | Valid-JSON-wrong-shape store (`null`, `[]`, `{pins:"x"}`) CRASHED the bridge at startup — before it listened; native host would crash-loop it | JSON.parse succeeding ≠ usable: shape must be validated (pins array + finite seq) → same recovery path as unparsable JSON | ✅ brutal D1 (fixed 0.11.0) |
| E-12 | Un-capped client fields (url, title, single target outerHTML/styles, console lines) could bloat store.json to MBs — every load/persist/broadcast pays forever | EVERY client field is untrusted input; extension sends bounded data but the bridge must not trust | ✅ brutal D3 (fixed 0.11.0) |
| E-13 | /agent/heartbeat read its body with NO size cap (memory blow) and accepted string/NaN pid/since (roster keys + owner election degrade into NaN comparisons) | readBody (MAX_BODY → 413) + typed identity: pid/since finite numbers or 400; roster fields capped | ✅ brutal D4 (fixed 0.11.0) |
| E-10 | Ghost WS clients after laptop sleep (stale tabs list, dead broadcast targets) | ping/pong 30 s, terminate silent peers | 🥁 C-drill (lid close) — timing not CI-worthy |

## F. Ownership & Sessions

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| F-1 | Two sessions watched in parallel; nudge landed in the "wrong" agent | pkill-based arbitration was fragile → bridge arbiter | ✅ hardening H2 (loser told owner:false) |
| F-2 | Owner/label change invisible until next pin event | broadcast on ownership/label delta | ✅ hardening H2 |
| F-3 | Takeover ping-pong (sessions re-arm on Monitor end) | standby instead of exit + manual choice | ✅ H5 (sticky choice beats newer) |
| F-4 | Same session armed twice → duplicate roster entries / flapping | roster keyed by normalized `NUDGE_AGENT_ID`; old watcher told `replaced` | ✅ hardening H6 |
| F-5 | Watcher survived its dead session (33-min zombie with stale label) | ppid→1 orphan exit; standby idle >60 min (transcript mtime) exits; owner never idle-exits | 🥁 C-drill (kill parent, observe roster) — ppid automation possible via intermediate shell, medium effort |
| F-6 | Anonymous/legacy heartbeats kept a dead label alive | identity required + typed (400 without finite pid/since) | ✅ brutal D4 |
| F-7 | Bench/manual test watchers hijacked the real channel & polluted the global store (nudge_72/79) | tests NEVER on port 4700 → side port 4799; test pins carry [TEST-…] or get deleted by id | ✅ standing rule + all runners on 4799 |
| F-8 | Suite A silently depended on some real session's heartbeat | suite simulates its own live agent | ✅ (own heartbeat, labeled suite-a) |
| F-9 | A newly-armed session took MINUTES to appear in the Switch-session dropdown — the bridge only broadcast on liveness/owner change; a new NON-owner session (sticky owner set) never triggered a push | broadcast whenever the visible session list changes (join/label/leave), compared to the LAST sent signature (also catches the 12s-fresh-window expiry) | ✅ brutal D16 (join <1s, leave <15s; fixed bridge 0.11.5) |
| F-10 | Switch-session showed "Owner: X" even on failure, and a re-armed session (new watcher pid) 404'd — the dropdown addressed sessions by process pid | client checks res.ok (honest "no longer active"); ownership is SESSION-keyed, survives re-arms; only a truly dead session 404s | ✅ brutal D17 (fixed bridge 0.11.6 / ext 0.16.13) |

## H. Provenance (owner binding — the "Nudge History")

The badge-click popover = the **Nudge History**: open nudges + a DONE history,
each row bound to its owning agent session. The binding is the robustness the user
leans on — bulletproofed in Suite H (`provenance.mjs`), display in Suite A.

| # | Edge case | Root cause / lesson | Status |
|---|-----------|---------------------|--------|
| H-1 | A foreign agent could relabel a nudge by taking the channel (header showed the CURRENT owner for every row) | stamp the owner AT ARRIVAL onto the pin, immutable; display per-row, not from the live header | ✅ Suite H H2/H3, Suite A (owner shown) |
| H-2 | A client could POST a forged `owner` | owner is a server-decided arg to addPin, payload.owner never read — spoofing structurally impossible | ✅ Suite H H1 |
| H-3 | Resolve by a different session could reassign the nudge | resolve only fills owner when it was null (offline arrival); an owned nudge is never touched | ✅ Suite H H4/H5/H7 |
| H-4 | Owner could be lost on crash / a huge label could bloat the store | persisted in store.json (survives SIGKILL); label/session capped 60/128 | ✅ Suite H H6/H8 |
| H-5 | A discarded nudge's id could be reused → a new nudge inherits a dead binding | ids strictly monotonic, never reused (seq floor) | ✅ Suite H H9 |
| H-6 | Retention: resolved nudges (with their owner) are pruned after 7 days | binding is immutable WHILE it exists; permanent history is a separate retention decision (open) | 📖 documented — decide if the History should keep resolved nudges longer |

## G. Agent wiring & process

| # | Edge case | Root cause / lesson | Status |
|---|---|---|---|
| G-1 | Installed skill/hooks drifted from repo | copies, not symlinks — Suite A diff leg | ✅ "agent wiring in sync" |
| G-2 | SessionStart pkill'd ALL watchers (pre-roster leftover) — killed standbys | hooks must match the ownership model | 📖 fixed; watch for on model changes |
| G-3 | Nudge provenance leaked into product code comments ("<user> via Nudge …") | comments state constraints; provenance → commit message (skill §4b) | 🔧 grep-leg in Suite A: `via Nudge` must not match in product code (`extension/`, `bridge/`, `agent/`) |
| G-4 | Real tabs attach to the TEST bridge during a 4700 suite run | ELIMINATED: tests never touch 4700 any more (see G-7) | ✅ obsolete since 0.16.3 |
| G-8 | A FOREIGN agent (CI, unrelated task) saw Nudge context and related to the owner's session ("The new nudges belong to the suite-e session") — the opt-in FENCE (0.10.2) stopped ARMING but not INFORMING; the UserPromptSubmit + SessionStart hooks injected into EVERY session as long as a global store existed | immanent gate: context reaches only normalized Agent ids present in the bridge roster (armed through groundworks-nudge); SessionStart injects nothing. No roster membership → total silence | ✅ Suite G (4 legs); runtime-neutral hook path verified 2026-08-28 |
| G-7 | Suite stole port 4700 → the user's LIVE toolbar showed the test agent ("Agent: suite-e", screenshot 2026-07-05) while the user was nudging | extension hardcoded the port; suites had to win 4700 → `chrome.storage.local.nudgePort` override (test browsers only, set via service worker BEFORE pages load), suites on side ports 4720/4721, exact-store identity check, bridge `NUDGE_NO_RELOAD` guard (worktree bridge must not reload an extension whose load path is missing) | ✅ fixed 0.16.3 / bridge 0.11.1 (Suite A+E run against side ports while the live bridge serves) |
| G-6 | Suite A flaked at the FIRST UI assert (status dot green) under load — cold start (extension boot + WS + first snapshot) needs > 5 s | startup barriers get generous timeouts (15 s); behavior asserts keep tight ones (flip timing = A12/D5) | ✅ e2e barrier widened (3× stable) |
| G-5 | Fresh agents (never opened before) spawned watcher processes they never asked for | the SessionStart hook ORDERED every new session to arm immediately; UserPromptSubmit nagged too → arming is now OPT-IN (only on the user's explicit "take over the nudges") | ✅ technical fence: watcher exits(1) without label and normalized Agent id; groundworks-nudge is the registration path |

## Building new legs — order of value

1. ~~A-8~~ done (0.16.2, Suite A leg "chrome inert") · ~~F-6~~ done (brutal D4)
   · Suite D (bridge-brutal.mjs, 14 legs) covers E-11/E-12/E-13 and the
   identity-truth contract end-to-end
2. **C-1 sub-pixel centring** (catches a whole visual-regression class for free)
3. **A-2 detached-element fallback** (the very first real-usage bug — regression-worthy)
4. **E-6 prune + E-7 selection-broadcast + F-6 identity-400** (three cheap H-legs, one PR)
5. **D-4 double-flush** (two-page context, medium)
6. **A-1 re-render pick, C-2 sweep, E-5 handler-guard** (nice-to-have)
