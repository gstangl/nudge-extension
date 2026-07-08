# Nudge — Test Protocols

Structured testing in three suites. Every entry: what it guards, how it runs,
last result. Legend: ✅ passed · ⚠️ passed with finding · ⬜ not yet run.

**Runners**
- `node test/e2e.mjs` — **Suite A**, isolated: own bridge on side port 4720 +
  fresh `/tmp` store, demo page; the test browser's extension is re-pointed via
  `chrome.storage.local.nudgePort`. Run after ANY extension/bridge change.
  All-or-nothing (first FAIL exits).
- `node test/real-apps.mjs` — **Suite E (Real Apps)**, side port 4721: picks and
  prompts against md-pdf, estimate (ProseMirror) and media, started from this
  worktree on ports 5313/5315/5318. The edge cases the demo page cannot show.
- `node test/fixture-gauntlet.mjs` — **Suite F (Fixture Gauntlet)**, side port
  4722, static server 5320: third-party UI idioms from the internet, VENDORED
  under `test/fixtures/` (Flowbite/Tailwind components + TodoMVC React; sources +
  licenses in `fixtures/README.md`). Proves the picker against the wild, not just
  our own apps. Refetch fixtures deliberately, then re-run.
- `node test/origin-routing.mjs` — **Suite K (Origin routing)**, side port 4783:
  parallel localhosts route to their own agents — per-host ownership + stamping,
  per-client snapshot, reassign immutability, and REAL watchers waking only for
  their own host. Run after any ownership/watcher/hook change.
- `node test/toolbar-ux.mjs` — **Suite L (Toolbar & popover UX)**, side port 4785:
  the localhost is always a clean pill (never inline `:port`), only one popover
  open at a time, P/F tool hotkeys are tightly gated, reduced-motion is honoured.
  Run after any toolbar/popover/label/hotkey change.
- `node test/page-inertness.mjs` — **Suite M (Page inertness)**, page server 5192:
  reaching for the toolbar must not dismiss the page's own UI — a near-miss click
  around the toolbar is absorbed (the "moat"), a genuine outside click still
  dismisses, and clicking a Nudge widget never leaks. Run after any host/overlay/
  pointer-events/moat change.
- `node test/amend.mjs` — **Suite N (Amend)**, side port 4788: append-only
  follow-ups to an open nudge — original immutable + inbox mirror, order,
  resolved refuses (409), a REAL watcher re-wakes on the amendment, and the
  History "+ ergänzen" UI round-trips. Run after any store/amend/watcher/queue change.
- `node test/cross-app.mjs` — **Suite J (Cross-App + Multi-Session)**, side port
  4792: nudges across the REAL apps at once (md-pdf, estimate, media, website) in
  four simultaneous tabs with four armed sessions and churning ownership — per-app
  binding, per-route isolation (no cross-app leak), concurrent interleaved creation
  under a heartbeat/resolve storm. Reuses running dev servers; skips unreachable.
- `node test/battletest.mjs` — **Suite I (Kidnap Battletest)**, side port 4793,
  static 5321: END-TO-END through the real extension — a nudge is set in a new app
  under one owner, then 4 attacker agents storm the bridge (heartbeats, /agent/owner
  grabs, stranger resolves, forged posts) trying to kidnap channel + nudge. Owner
  binding + captured context must not budge. The rock-solid proof.
- `node test/provenance.mjs` — **Suite H (Provenance)**, side port 4794: the
  bulletproof proof that a nudge's owning agent session is stamped at arrival and
  stays bound FOREVER — un-spoofable, un-kidnappable. Run after ANY change to
  owner stamping, the roster, or resolve.
- `node test/hook-optin.mjs` — **Suite G (Hook Opt-in Gate)**, side port 4797:
  proves the UserPromptSubmit hook stays SILENT in every session that did not arm
  via /nudge (its session id is not in the roster) — even with a full store and a
  live owner. Run after ANY hook change.
- `node test/latency-bench.mjs` — **Wake-Latenz** (Seitenport 4799): POST →
  Watcher-Zeile, WS-Push vs fs-Fallback. Referenz 2026-07-05: 2,1 ms vs 23,7 ms.
- `node test/bridge-hardening.mjs` — **Bridge-Härtung** (Seitenport 4799): corrupt-store
  recovery (Backup + seq-Floor aus Inbox), Owner-Wechsel-Broadcast, 413,
  atomic persist. Nach JEDER Bridge-Änderung mitlaufen lassen.
- `node test/bridge-brutal.mjs` — **Suite D (Bridge Brutal)**, Seitenport 4798:
  adversarial battery — the bridge must survive everything a hostile/buggy local
  client or a mangled disk can throw at it, and the identity surface must never
  lie. Run after ANY bridge/store/watcher change, together with the hardening
  suite. ~90 s (identity-truth legs wait on real freshness clocks).
- `node test/live-drill.mjs` — **Suite B**, live chain: REAL bridge, REAL global
  store, estimate app on :5185 + a throwaway generic app. Run before "releases"
  and after infra changes (bridge lifecycle, store, hooks). Writes `[TEST-…]`
  pins and cleans them up itself (never resets seq).
- **Suite C** — manual drills, each tied to a trigger ("run after X changed").

**Edge-case catalog:** `scenarios.md` — every bug/lesson with coverage status;
the backlog for new legs lives there (section „Building new legs").

**Standing rules**
- **Tests NEVER touch port 4700.** Every suite runs its own bridge on its own
  side port (A:4720 · E:4721 · D:4798 · hardening/bench:4799) and re-points the
  TEST browser's extension via `chrome.storage.local.nudgePort` (0.16.3). The
  live bridge keeps serving Gerald through every run. History: suites used to
  steal 4700 — his toolbar showed „Agent: suite-e" (2026-07-05, G-7).
- Suites verify their bridge by EXACT store path (`/.identity.store`), not by
  workspace dirname — two `/tmp` test stores look identical by dirname.
- Never reset the store seq; test pins carry a `[TEST-…]` prefix and are removed
  by id, evidence files included.
- The store is GLOBAL (`~/.claude/nudge/`); agent wiring is user-level
  (`~/.claude/settings.json` hooks, `~/.claude/skills/nudge/`). No project config.
- **Process hygiene.** Suites (and ad-hoc Playwright repros) that spawn a bridge
  or REAL watchers can leak them if a run is interrupted — a leaked watcher on a
  side port silently pollutes later runs (a ghost agent appears in the switcher).
  Clean up by SIDE PORT / test store, never blanket. **NEVER blanket-kill
  `watch-nudges` processes**: they are usually Gerald's REAL armed sessions
  heartbeating 4700 (2026-07-07 — a cleanup grep flagged his live watchers as
  „strays"). Before killing anything, check the live roster
  (`curl -s localhost:4700/.identity`) — if a name matches, it is real; leave it.
- **Test every affordance of an input, not one happy path.** A green submit test
  can hide a dead-end field: Suite N5 passed on ⌘↩ while the amend field was
  UNUSABLE for Gerald — no visible send button, and Shift+Enter (what he pressed)
  was a newline, not send (2026-07-07). For any text input assert the FULL
  contract: the visible control (button) works, EACH key path a human tries
  (Enter, ⌘↩), the NEGATIVE (what must NOT submit — Shift+Enter → newline), and
  the POST-submit state (field clears/closes, no double-send). "It posts on ⌘↩"
  is not "a human can send it."
- **Reproduce page-interaction bugs against the REAL page, not from theory.** The
  toolbar-dismiss bugs only became clear by starting the actual site
  (`website`: `npm run start`, then trigger `.nav__cta`) and instrumenting what
  fired — the dismiss mechanism was NOT what the first guess assumed. Read the
  page's own dismiss code (e.g. `packages/ui/src/popover.ts`) to know the exact
  event + phase, THEN build a hermetic leg (Suite M) that replays that mechanism.

## Suite A — isolated, automated (e2e.mjs)

| # | Guards | Last |
|---|--------|------|
| A1 | **Report completeness (element)**: DOM-only — text, url, title, ua, viewport, unique selector, xpath, innerText, source hint, outerHTML, categorized styles, console incl. `[net]` ≥400. NO screenshot (element pins are DOM-only) | ✅ 2026-07-05 |
| A2 | **Capture accuracy** (dpr derived from bitmap÷viewport, not trusted) | ✅ 2026-07-05 |
| A3 | **Pick = mark**: element selection published on pick DOM-ONLY (no screenshot, no flicker), chip retarget updates it, Abbrechen keeps selection, creates NO pin | ✅ 2026-07-05 |
| A4 | **Prompt tracking**: badge counts this route's open prompts, clears on resolve; ONE amber dot per marked element while its prompt is open (0.9.0 product revision — no popovers/threads, dot click opens the queue), dots gone after resolve/discard, hidden in evidence shots. Badge CLICK → queue popover (id · text · age, midnight style), closes on Escape/outside/empty. **Caret aligned to the badge (C-7); a row does NOT jitter on accordion toggle (C-6, dot/id hold their offset)** | ✅ 2026-07-06 |
| A5 | **Resolve (element)**: HTTP resolve → „pin_X erledigt"-chip, badge drops, NO after-shot (element = DOM-only). Freeform pins keep the before/after evidence loop (asserted in A6) | ✅ 2026-07-05 |
| A6 | **Freeform (region)**: stroke stored, centroid selector, AND a screenshot (only the Freeform tool captures) + resolve → after-shot evidence loop | ✅ 2026-07-05 |
| A7 | **SPA refilter**: hashchange/popstate refilter the badge (route = pathname+hash; query deliberately ignored) | ✅ 2026-07-05 |
| A8 | **Connection visibility / feedback feed** (CORE, see PRODUCT.md): every prompt answers in the top-right feed — „Agent arbeitet" (send icon) / „gespeichert — kein Agent" (clock) / „Bridge offline — Warteschlange" (alert) / „erledigt" (check); connection loss + recovery land there too; chips are Lucide-iconed, max 4, self-fading. Texts asserted in A/B runs, look via design-shots | ✅ 2026-07-05 |
| A9 | **Multi-selection (Shift+Klick)**: two shift-clicks → selection carries `targets[]` (2 Elemente, DOM-only), composer counts mit, one transient outline per element; send → pin carries both targets (selector+xpath each), NO screenshot, outlines gone after send (fire-and-forget). Late re-check: element pins never gain an after-shot | ✅ 2026-07-05 |
| A10 | **Queue management (0.9.0)**: text-less prompt shows a speaking label („Markierung: ‚innerText'" / N Elemente / selector); row × discards via DELETE (store + inbox + shots weg, feed chip „verworfen"); dots lifecycle asserted (3 → 2 after discard) | ✅ 2026-07-05 |
| A12 | **Zustands-Feedback 0.12.0**: Punkt GRÜN bei agentLive (Suite-Heartbeat), amber sonst; Badge zählt nur OFFENE, verschwindet bei 0; Erledigt-History im Queue-Popover (q-div „Erledigt", Zeile mit grünem Check, resolvedAt-Alter) | ✅ 2026-07-05 |
| A11 | **Härtung 0.10.0**: CORS-Grenze (fremder Origin → keine CORS-Header, localhost reflektiert); leeres Senden = reine Markierung, KEIN Pin; Klick-Konvention (normaler Klick setzt Multi auf Einzel zurück, nur ⇧ sammelt); Agent-Wiring-Drift-Check (Repo = installiert) als Schlussbein | ✅ 2026-07-05 |

**Toolbar chrome geometry (2026-07-06):** Suite A also locks in the popover
carets (queue → badge, Switch-session → its label, C-7), the accordion no-jitter
(C-6) and the feed sitting under the toolbar (C-8, Δleft<3/Δtop 2–20). Full
catalog in `scenarios.md` groups C/D/F.

## Suite B — live chain, automated (live-drill.mjs)

| # | Guards | Last |
|---|--------|------|
| B1 | **Bidirectional, click-only**: pick on :5185 → `/selection` fresh in <10 s AND the user-level hook surfaces AKTUELLE MARKIERUNG (what a Zed agent sees on the next message) | ✅ 2026-07-05 |
| B2 | **Rapid-fire queue**: 3 prompts in quick succession → ids strictly monotonic, arrival order = send order, badge +3; watcher wakes arrive in order (observed live in the agent session, 3× on 2026-07-05) | ✅ 2026-07-05 |
| B3 | **Resolve loop on the live page**: feed chip + evidence against the real store | ✅ 2026-07-05 |
| B4 | **Generic web app**: framework-free static page (python http.server) — pick, selection, prompt land identically. Nudge is app-agnostic | ✅ 2026-07-05 |
| B5 | **Self-healing**: kill the bridge → content script reports → SW `connectNative` → native host revives it detached (~8 s). Playwright needs the host manifest in `<user-data-dir>/NativeMessagingHosts` (script handles it) | ✅ 2026-07-05 |

## Suite D — Bridge Brutal (bridge-brutal.mjs)

The bridge's own protocol. Two contracts, tested adversarially:

**1. Survival.** The bridge NEVER dies and NEVER blocks, whatever arrives on
the port or sits on disk. A bridge that "survives" by crashing fails the leg —
every leg re-asserts process liveness.

**2. Identity truth.** The extension UI always shows WHICH agent is connected,
via text and indicators, and that display can never lie:
- `/.identity` + every WS snapshot carry `agentLabel`, `agentLive` and the full
  roster (`agents[]`, exactly ONE `owner:true`).
- Every ownership/label/liveness change is PUSHED to all tabs (no polling).
- A dead owner falls over to the next fresh session in ≤ 17 s (12 s freshness
  + 5 s sweep); its roster entry vanishes on the same clock.
- Total silence (no watcher) goes dark honestly: `agentLive:false`,
  `agentLabel:null` pushed in ≤ 15 s. Green never lies.
- UI side (toolbar label, status tooltip, dropdown owner row) is asserted in
  Suite A; D5 proves the bridge feed those surfaces draw from.

Threat model (accepted, documented): the port binds 127.0.0.1 only (D13) and
CORS is localhost-only (Suite A), but any LOCAL process of the same user can
POST heartbeats/pins — the machine boundary is the trust boundary. Single-user
machine by design; no auth inside it.

| # | Attack | Last |
|---|--------|------|
| D1 | **Store shape fuzz**: 6 valid-JSON-wrong-shape stores (`null`, `[]`, string, number, pins-not-array, seq-not-finite) → bridge serves, backup written, seq floor holds. Pre-0.11.0 these CRASHED the bridge at startup (native host would crash-loop it) | ✅ 2026-07-05 |
| D2 | **Path traversal + method abuse**: 11 traversal attempts on /shots, /comments, /demo (`..`, `%2F`, `%00`, `//etc/passwd`) leak nothing; PUT/PATCH/HEAD/TRACE create nothing; legit shot still served | ✅ 2026-07-05 |
| D3 | **Payload fuzz** on /comments: `__proto__`/constructor pollution, 60k-deep nesting, wrong-typed fields, 5000 targets, 2 MB outerHTML, 1 MB url, console flood, annotation bomb, garbage screenshot → all capped (store ≤ 10 kB after 12 hostile bodies), never a crash | ✅ 2026-07-05 |
| D4 | **Heartbeat fuzz**: 7 malformed identities → 400 (typed: pid/since must be finite numbers); huge identity fields → capped in roster (label 60, session 32, project/branch 60, host 20, firstMsg 90); 6 MB heartbeat → 413 | ✅ 2026-07-05 |
| D5 | **IDENTITY TRUTH** (the core contract, see above): takeover pushed, manual choice sticky + pushed, dead owner → fallback pushed in 12 s, dead entry gone from roster, silence → dark in 12.5 s, ≤ 1 owner in every frame ever pushed | ✅ 2026-07-05 |
| D6 | **WS abuse**: 30 clients, garbage/binary frames, 200 kB hello, fake agent hello → hello url capped, agent not counted as tab, broadcast still reaches everyone | ✅ 2026-07-05 |
| D7 | **Concurrency storm**: 100 parallel POSTs → 100 unique monotonic ids, store parses; resolve×delete races answer 200/404 (never 5xx/crash); 50 parallel selection posts | ✅ 2026-07-05 |
| D8 | **Restart-storm durability**: 5× SIGKILL mid-traffic → every 201-acked pin survives (atomic rename), no tmp residue | ✅ 2026-07-05 |
| D9 | **Hostile sockets**: half-open POST (claimed 500 kB, sent 10 B, held open) blocks nobody; raw garbage bytes on the port shrugged off | ✅ 2026-07-05 |
| D10 | **Oversize artillery**: 6 MB body → 413; lying Content-Length survived | ✅ 2026-07-05 |
| D11 | **Owner endpoint abuse**: string pid → 404 (strict typing), unknown pid → 404, garbage → 400, valid → 200 | ✅ 2026-07-05 |
| D12 | **Snapshot diet under history**: 60 pins / 50 resolved → WS snapshot ships ≤ 40 done, HTTP keeps full history | ✅ 2026-07-05 |
| D13 | **Bind surface**: LAN IP refused, 127.0.0.1 only | ✅ 2026-07-05 |
| D14 | **Watcher resilience**: armed before the bridge exists → registers as soon as it comes up (retry loops) | ✅ 2026-07-05 |

## Suite E — Real Apps (real-apps.mjs)

The demo page proves mechanics; the real apps prove the product. Apps start
from this worktree on side ports (5313 md-pdf · 5315 estimate · 5318 media).

| # | Guards | Last |
|---|--------|------|
| E1 | **md-pdf**: pick on the dropzone (DOM-only, innermost element inside the card); load a REAL document (dynamic file input → filechooser, staging step, »Generate document«) and pick inside the PagedJS print preview | ✅ 2026-07-05 |
| E4 | **Input hygiene on a real form**: typed values NEVER reach element-owned channels (innerText/outerHTML/styles/targets/selector/xpath) — DOM properties are not serialized. Page-owned surfaces (title/url) carry what the page puts there: md-pdf reflects the Dokumenttitel field into document.title — the app's exposure, reported faithfully | ✅ 2026-07-05 |
| E2 | **estimate/ProseMirror — the A-2 case**: open a real document, pick a paragraph, DETACH the node before send (clone+replace = PM re-render) → pick-time rect + selector survive via the fallback chain. Library data comes through vite's proxy from the worker (:8787) — if that backend is down the leg SKIPS honestly instead of reddening the suite | ✅ 2026-07-05 |
| E3 | **media grid**: picked thumb in a grid of near-identical cards yields a UNIQUE selector pointing at the right card; shift-multi across two cards (first click already with ⇧ — A-7 convention) | ✅ 2026-07-05 |
| E5 | **Cross-app queue truth**: open pins on md-pdf AND media → each tab's count shows only its own route | ✅ 2026-07-05 |

## Suite F — Fixture Gauntlet (fixture-gauntlet.mjs)

Third-party pages from the internet, vendored so runs are hermetic. Suite E
proves OUR apps; Suite F proves the wild — the Tailwind/Flowbite idioms and
re-render frameworks production UIs are actually built from. Two real extension
bugs surfaced here (see run log 2026-07-05).

| # | Guards | Last |
|---|--------|------|
| F1 | **Flowbite modal (A-8 in the wild)**: modal with a backdrop outside-close survives the toolbar click AND an in-modal pick — the exact „Finale Version freigeben?" trap, now against real Flowbite JS | ✅ 2026-07-05 |
| F2 | **Dropdown / anchor**: pick a menu item (an `<a href>`) → selector captured, the href is NOT followed, the page does not navigate (trailing-click suppression) | ✅ 2026-07-05 |
| F3 | **Scroll + near-identical table**: deep pick after scrolling has a viewport-relative rect; row 35 of 40 near-identical rows is uniquely addressed (right INV number) | ✅ 2026-07-05 |
| F4 | **CSS-transformed parent**: element under `scale()+rotate()` → selection rect equals the VISUAL box (getBoundingClientRect) within 2 px | ✅ 2026-07-05 |
| F5 | **Shadow DOM**: click into a closed-ish web component retargets to the HOST element (documented boundary — the picker addresses the host, not the shadow internals) | ✅ 2026-07-05 |
| F6 | **z-index 9999 toast**: an aggressive page z-index cannot cover the picker; the toast is pickable with its innerText | ✅ 2026-07-05 |
| F7 | **TodoMVC React re-render**: pick a todo, toggle another (React rebuilds the keyed list) between pick and send → selector, rect and innerText all survive | ✅ 2026-07-05 |

## Suite G — Hook Opt-in Gate (hook-optin.mjs)

The immanent guarantee Gerald asked for: a session becomes Nudge-aware ONLY by
his hand (typing /nudge, which arms a watcher → its session id enters the
roster). The UserPromptSubmit hook runs in EVERY session but reveals Nudge
context only to roster members; everyone else is silent. The SessionStart hook
injects nothing at all any more (it only ensures the bridge is up).

| # | Guards | Last |
|---|--------|------|
| G1 | **Foreign session → total silence**: a session id NOT in the roster gets NO output, even with an open pin, a fresh selection, and a live owner in the store | ✅ 2026-07-05 |
| G2 | **No session id → silence**: a session without CLAUDE_CODE_SESSION_ID cannot prove participation → nothing | ✅ 2026-07-05 |
| G3 | **Armed session → full context**: the roster-member session sees status (owner label), current mark, and queue line | ✅ 2026-07-05 |
| G4 | **Disarm returns to silence**: when a session's watcher stops and it ages out of the roster, even the same id goes silent again | ✅ 2026-07-05 |

## Suite H — Provenance (provenance.mjs)

The **Nudge History** (the badge-click popover: open nudges + a DONE history,
each row naming its agent) rests on one contract Gerald leans the bridge's
robustness on: **once a nudge is created it stays bound to the agent session
that owned the channel at that instant — forever, and no other process or agent
can kidnap it.** Bulletproofed here from every angle.

| # | Attack on the binding | Last |
|---|-----------------------|------|
| H1 | **Client spoof**: a forged `owner` in the POST body (object/string/array) is IGNORED — owner is a separate server-decided arg, never read from the payload | ✅ 2026-07-05 |
| H2 | **Heartbeat owner switch**: newer session takes the channel → existing nudge keeps its owner | ✅ 2026-07-05 |
| H3 | **Dropdown pick** (`/agent/owner`): Gerald re-chooses the channel owner → existing nudges unchanged, only NEW ones take the chosen owner | ✅ 2026-07-05 |
| H4 | **Resolve by a stranger**: B resolves an A-owned nudge → stays A | ✅ 2026-07-05 |
| H5 | **Double/triple resolve**: idempotent, owner never drifts | ✅ 2026-07-05 |
| H6 | **SIGKILL + restart**: owner is persisted (store.json), survives a crash | ✅ 2026-07-05 |
| H7 | **Offline nudge**: created with no channel owner → attributed to the RESOLVER; then immutable against a later owner | ✅ 2026-07-05 |
| H8 | **Bounded stamp**: a 5000-char roster label is capped to 60 — a hostile session can't bloat pins | ✅ 2026-07-05 |
| H9 | **Discard + no id reuse**: DELETE removes the nudge entirely; ids never reused → a new nudge can't inherit a dead binding | ✅ 2026-07-05 |
| H10 | **Concurrency**: 30 parallel creates under one owner all stamp it, ids unique | ✅ 2026-07-05 |
| H11 | **Projection parity**: owner present + consistent in the HTTP summary (label) and the WS snapshot (object) | ✅ 2026-07-05 |

Display side (that the History SHOWS the owner per row) is asserted in Suite A
("badge queue popover … owner shown").

## Suite I — Kidnap Battletest (battletest.mjs)

The Nudge History binding proven through the FULL stack, adversarially. A nudge
is created in a new app (Tailwind Gauntlet fixture) through the real extension
while Owner-Alpha holds the channel; then 4 attacker agents storm the bridge for
5 s trying to steal both the channel and that nudge.

| # | Guards | Last |
|---|--------|------|
| I1 | Nudge set via the real browser UI is owned by Owner-Alpha; the captured context (selector→#g-brand, xpath, innerText, url) is correct | ✅ 2026-07-05 |
| I2 | **Kidnap storm**: ~84 rounds × 4 agents × 5 attack types (newest-wins heartbeats, /agent/owner grabs, stranger resolve, forged-owner post, bogus mutate) → owner + captured context never budge (asserted every round) | ✅ 2026-07-05 |
| I3 | Channel ownership IS reassignable (a kidnapper can become channel owner), but each nudge keeps ITS owner: old stays Alpha, a new nudge belongs to the new owner | ✅ 2026-07-05 |
| I4 | The Nudge History UI shows each nudge's true per-row owner even when the header/channel owner is now a kidnapper | ✅ 2026-07-05 |
| I5 | The inbox file an agent reads carries the owning agent + captured selector + url — no kidnapper can claim the forwarded context | ✅ 2026-07-05 |

## Suite J — Cross-App + Multi-Session (cross-app.mjs)

The whole system under realistic load: four real apps open at once, four agent
sessions armed in parallel, ownership churning — Gerald's "mehrere Sessions
gleichzeitig". Uses whatever dev servers are running (md-pdf :5313, estimate
:5315, media :5318, website :4321); skips an app that isn't up.

| # | Guards | Last |
|---|--------|------|
| J1 | One nudge on EACH app, each created while a DIFFERENT session owned the channel → each bound to its own session; context captured on the real DOM | ✅ 2026-07-05 (4/4 apps) |
| J2 | **Per-route isolation**: each tab's badge + History show ONLY that app's nudge with its own owner — no cross-app leakage | ✅ 2026-07-05 |
| J3 | **Concurrent storm**: interleaved creation across all tabs under rotating ownership + a heartbeat/stranger-resolve storm → every nudge correctly attributed, ids strictly monotonic, none lost | ✅ 2026-07-05 |
| J4 | After the churn, each tab's Nudge History is still route-correct with the right per-row owners | ✅ 2026-07-05 |

## Suite K — Origin routing (origin-routing.mjs)

The multi-localhost model (Gerald opens many worktrees, each its own dev server;
a nudge on a localhost must reach THAT worktree's agent, not a single global
owner). Ownership is per-host; nothing assigned = old single-owner behaviour.

| # | Guards | Last |
|---|--------|------|
| K1 | Per-host routing: nudges on :5185/:5186 stamp their host's agent; an unassigned host falls back to the newest agent | ✅ 2026-07-07 |
| K2 | Per-client snapshot: each tab sees the owner of ITS host (5185→A, 5186→B) | ✅ 2026-07-07 |
| K3 | Reassign a host to another agent → existing nudges keep their owner, new ones take the new agent | ✅ 2026-07-07 |
| K4 | **Two REAL watcher processes each wake ONLY for their own host** (A←5185, B←5186, no cross-wake) — the payoff | ✅ 2026-07-07 |
| K5 | `/.identity.routes` maps every open localhost tab → its owner {label, session} and flags `viaFallback`; `127.0.0.1:X` folds into `localhost:X` (one host, one owner) | ✅ 2026-07-08 |
| K6 | **`viaFallback` tells the truth when the picked agent dies**: the flag flips the moment the pick leaves the fresh window (derived from actual resolution) — a `has(host)` check lied for up to ~17 s until the sweep | ✅ 2026-07-08 |

## Suite L — Toolbar & popover UX (toolbar-ux.mjs)

Locks in the toolbar/popover polish (2026-07-07) so a later refactor can't break
it silently. Own bridge on 4785, own page server on 5196; two sessions armed
with Gerald-style port-suffixed labels ("Estimate Templates :5175").

| # | Guards | Last |
|---|--------|------|
| L1 | Localhost is a pill on the switcher rows + the toolbar name is clean; no row shows an inline `:port` | ✅ 2026-07-07 |
| L2 | Connection feed chip ("Agent: …") shows a clean name + a localhost pill, never an inline `:port` | ✅ 2026-07-07 |
| L3 | Only one popover open at a time — Nudge History ↔ Switch-session are mutually exclusive | ✅ 2026-07-07 |
| L4 | P/F hotkeys switch tools when the overlay is active, and are suppressed while typing in a page field | ✅ 2026-07-07 |
| L5 | `prefers-reduced-motion: reduce` collapses the overlay's transitions (no gliding highlight / spinning clock) | ✅ 2026-07-07 |
| L6 | An orphaned tab (extension reload) shows the „⌘R" hint pill instead of the toolbar vanishing silently; click dismisses (plain DOM — chrome.* is dead there) | ✅ 2026-07-08 |

## Suite M — Page inertness (page-inertness.mjs)

The Nudge overlay is a full-screen `pointer-events:none` host over the page, so a
click that MISSES the toolbar falls through. On a page whose modal uses a
backdrop that hides on outside-click (roots' RequestPopover), that means
reaching for the toolbar dismissed the page's popover (Gerald 2026-07-07). Fixed
with a thin "moat": near-miss clicks around visible Nudge chrome are absorbed at
window-capture (idle/composing only — picking/drawing need page clicks). A second
leak: dropdowns that detect outside-clicks with a document CAPTURE-phase
pointerdown (roots' own `@roots/ui` `actionMenu`) fire before the host
bubble-stop, so a widget click retargeted to the host closed them. Fixed by
swallowing a genuine widget hit's pointerdown at window-capture — our controls
act on `click`; grip/draw/composer keep their own pointerdown.

| # | Guards | Last |
|---|--------|------|
| M1 | A near-miss click (≤12px) around the toolbar is absorbed — the page's modal survives | ✅ 2026-07-07 |
| M2 | A genuine outside click (far from the toolbar) still dismisses the modal — the moat stays tight | ✅ 2026-07-07 |
| M3 | Clicking a Nudge widget (Pick) never leaks to the page | ✅ 2026-07-07 |
| M4 | A document capture-phase pointerdown dropdown (à la @roots/ui `actionMenu`) stays open when reaching for the toolbar, and Pick still activates | ✅ 2026-07-07 |
| M5 | The widget-pointerdown swallow left our own controls intact (composer typing + grip drag) | ✅ 2026-07-07 |

**Dismiss-mechanism checklist** — page UI closes on "outside interaction" in
several ways; each is its own leak against a full-screen `pointer-events:none`
overlay. Cover the space, don't chase bugs one at a time. When a NEW page pattern
dismisses a control on toolbar contact, first identify which row it is:

| Mechanism | How it dismisses | Covered |
|---|---|---|
| Backdrop element, `click`/bubble → hide | near-miss falls THROUGH to the backdrop | M1–M3 (moat) |
| `document` **capture-phase** pointerdown/mousedown, `contains(target)` check | widget click retargets to host = "outside" | M4 (window-capture swallow) |
| `document` **bubble-phase** click/pointerdown | widget click bubbles to document | host bubble-stop (Suite A #4) |
| Native Popover API light-dismiss (`popover` attr) | browser-internal on pointerdown | ⬜ untested frontier |
| `<dialog>` / `::backdrop` | backdrop click / Esc | ⬜ untested frontier |
| `focusout` / `blur` (focus leaves the widget) | focus moves into the overlay | ⬜ untested frontier |

Note the two orthogonal axes: **event** (pointerdown vs mousedown vs click) ×
**phase** (capture vs bubble). Our defence has to hold on all of them; the
window-capture swallow is the only hop that beats a page's capture-phase listener
(registration order can't be won on `document`). Any change to the swallow MUST
keep grip/draw/composer exempt (M5) — they need their own pointerdown.

## Suite N — Amend (amend.mjs)

Append-only follow-ups (0.19.0). Gerald sends a nudge, then wants to add one more
thought to the SAME nudge. Original text is immutable (provenance); nachträge
accrue in `amendments`. `POST /comments/:id/amend {text}`.

| # | Guards | Last |
|---|--------|------|
| N1 | An open nudge takes a follow-up: original immutable, stored with timestamp, inbox mirror carries original + Nachtrag | ✅ 2026-07-07 |
| N2 | Multiple follow-ups accrue in order; an empty/whitespace follow-up is rejected (400) | ✅ 2026-07-07 |
| N3 | A resolved nudge refuses a follow-up (409, no re-open); unknown id is 404 | ✅ 2026-07-07 |
| N4 | **A REAL watcher wakes on the fresh nudge AND re-wakes on the amendment** (the owning agent sees the follow-up) | ✅ 2026-07-07 |
| N5 | History "+ ergänzen" round-trips (via the send button): follow-up reaches the store, the "+N" badge shows, AND its text is readable under the expanded row | ✅ 2026-07-07 |
| N6 | Submit contract: **Enter sends, Shift+Enter is a newline (not send), the field clears after a send** — N5 alone was green while the field was unsendable (no button, ⌘↩-only) | ✅ 2026-07-07 |

## Suite C — manual drills (trigger-bound)

| # | Drill | Trigger | Last |
|---|-------|---------|------|
| C1 | Capture at Chrome zoom 80/150 % on Retina — crop still centred | after sw.js capture changes | ⬜ |
| C2 | **Offline queue**: bridge down → send → „Bridge offline – Warteschlange"-toast, parked in chrome.storage; bridge back → auto-flush „✓ n nachgesendet". Backoff caps at 8 s; tab return reconnects immediately | after connection-logic changes | ⬜ |
| C3 | **Dev auto-reload** (known caveat: fails under Playwright's --load-extension; real "Load unpacked" only) | after extension file-watch changes | ⚠️ standing |
| C4 | **Security boundary**: 127.0.0.1-only bind (LAN curl refused); no secrets in store; overlay never captures itself | quarterly / before team rollout | ⬜ |
| C5 | **Status truth (agentLive)**: no watcher → amber; armed → green ≤5 s; watcher killed → amber ≤15 s; bridge killed → red. Green must never lie | after heartbeat/status changes | teilweise ✅ (Flips live beobachtet 2026-07-04/05) |
| C6 | **Overlay perf** on a heavy TipTap doc: no hover lag (fastPath), glide stays smooth | after picker changes | ⬜ |
| C7 | **Foreign-project agent**: open an agent in a non-roots workspace → SessionStart arms, `/nudge` reports, prompt round-trip works | after wiring changes | ⬜ (hook from foreign cwd ✅ 2026-07-05) |
| C8 | **Real-Chrome self-heal**: kill bridge with only Gerald's Chrome running → circle red → green again without any agent/terminal | after native-host changes | ⬜ (Chromium-automated ✅ = B5) |

## Removed (2026-07-05 architecture pass)

- **MCP surface** (`bridge/mcp.mjs`, `test/mcp-smoke.mjs`, deps `zod` +
  `@modelcontextprotocol/sdk`, env flag `PIN_HTTP_ONLY`): unused since the
  global wiring — HTTP + files carry the full cycle. Bridge dep = `ws` only.
- **Python watcher** (`watch-nudges.py`) → `watch-nudges.mjs`: one runtime (node),
  and EVENT-DRIVEN via fs.watch — wake latency ms instead of the old 1 s poll
  (fallback poll 5 s stays for dropped watch events).
- Historic T8 (multi-process store freshness): the mtime-guarded cache + id
  collision guard remain in the code; the two-bridge scenario is rare since the
  native host owns the lifecycle. Re-add a drill only if multi-bridge returns.

## Run log

- **2026-07-05 — Multi-selection (0.8.0): Suite A 9/9 + Suite B 5/5.** Two
  findings fixed on the way: (1) the WS-snapshot "evidence backlog" path still
  captured after-shots for ELEMENT pins (predates the 0.7.0 DOM-only rule; the
  old A5 check only won by timing — now guarded by `p.screenshot` and re-checked
  late in A9). (2) B4's feed-chip assertion assumed a live agent; the chip text
  legitimately differs with/without watcher — assertion is now state-agnostic.

- **2026-07-05 — GRADUATION `sandbox/pin` -> `pin/` (top level): Suite A 5/5 +
  Suite B 5/5 from the new home.** Two findings fixed on the way: (1) unpacked
  extension ids derive from the DIRECTORY PATH — the move changed the id, the
  native-host manifests had to be regenerated (id is computable:
  sha256(path) -> a-p alphabet; install script default updated). Real Chrome
  needs a fresh "Load unpacked" from `nudge/extension` after the move. (2) a
  bridge losing the port race now EXITS instead of lingering as a zombie.

- **2026-07-05 — Suite B first full run: 5/5 PASS** (after global wiring + native
  host). Two test-artifact fixes on the way: generic-toast wait swallowed a
  rapid-fire pin (wait on store length instead), badge assertion ignored the
  pre-existing route backlog (pin_1 counts — correctly). Suite A re-run same day:
  all PASS. Watcher wakes observed in arrival order across 3 runs.
- **2026-07-05 — global wiring**: store → `~/.claude/nudge`, hooks/skill user-level,
  MCP entry removed; hook verified from foreign cwd. Native host standalone:
  started/running idempotent, bridge survives launcher death.
- **2026-07-04** — fire-and-forget pivot, agentLive chain, id-collision hardening
  (NEVER reset seq — a recycled id silently swallowed a real prompt), EADDRINUSE
  survivor fix, e2e collision rule (kill port 4700 holders before Suite A).
