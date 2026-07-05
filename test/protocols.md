# Nudge — Test Protocols

Structured testing in three suites. Every entry: what it guards, how it runs,
last result. Legend: ✅ passed · ⚠️ passed with finding · ⬜ not yet run.

**Runners**
- `node test/e2e.mjs` — **Suite A**, isolated: own bridge on a fresh `/tmp` store,
  demo page. Run after ANY extension/bridge change. All-or-nothing (first FAIL exits).
- `node test/latency-bench.mjs` — **Wake-Latenz** (Seitenport 4799): POST →
  Watcher-Zeile, WS-Push vs fs-Fallback. Referenz 2026-07-05: 2,1 ms vs 23,7 ms.
- `node test/bridge-hardening.mjs` — **Bridge-Härtung** (Seitenport 4799): corrupt-store
  recovery (Backup + seq-Floor aus Inbox), Owner-Wechsel-Broadcast, 413,
  atomic persist. Nach JEDER Bridge-Änderung mitlaufen lassen.
- `node test/live-drill.mjs` — **Suite B**, live chain: REAL bridge, REAL global
  store, estimate app on :5185 + a throwaway generic app. Run before "releases"
  and after infra changes (bridge lifecycle, store, hooks). Writes `[TEST-…]`
  pins and cleans them up itself (never resets seq).
- **Suite C** — manual drills, each tied to a trigger ("run after X changed").

**Standing rules**
- Suite A wins port 4700 ITSELF (kill → spawn → verify /.identity.workspace = /tmp,
  retry — Chrome's native host revives the live bridge within moments) and restores
  nothing — restart the
  live bridge after (or let the extension/native host revive it: that IS B5).
- Never reset the store seq; test pins carry a `[TEST-…]` prefix and are removed
  by id, evidence files included.
- WHILE Suite A runs, the REAL extension in Gerald's Chrome attaches to the TEST
  bridge (shared port 4700): real marks/prompts placed in that window land in the
  /tmp store and vanish with it. Known, accepted — don't pin during a suite run.
- The store is GLOBAL (`~/.claude/nudge/`); agent wiring is user-level
  (`~/.claude/settings.json` hooks, `~/.claude/skills/nudge/`). No project config.

## Suite A — isolated, automated (e2e.mjs)

| # | Guards | Last |
|---|--------|------|
| A1 | **Report completeness (element)**: DOM-only — text, url, title, ua, viewport, unique selector, xpath, innerText, source hint, outerHTML, categorized styles, console incl. `[net]` ≥400. NO screenshot (element pins are DOM-only) | ✅ 2026-07-05 |
| A2 | **Capture accuracy** (dpr derived from bitmap÷viewport, not trusted) | ✅ 2026-07-05 |
| A3 | **Pick = mark**: element selection published on pick DOM-ONLY (no screenshot, no flicker), chip retarget updates it, Abbrechen keeps selection, creates NO pin | ✅ 2026-07-05 |
| A4 | **Prompt tracking**: badge counts this route's open prompts, clears on resolve; ONE amber dot per marked element while its prompt is open (0.9.0 product revision — no popovers/threads, dot click opens the queue), dots gone after resolve/discard, hidden in evidence shots. Badge CLICK → queue popover (id · text · age, midnight style), closes on Escape/outside/empty | ✅ 2026-07-05 |
| A5 | **Resolve (element)**: HTTP resolve → „pin_X erledigt"-chip, badge drops, NO after-shot (element = DOM-only). Freeform pins keep the before/after evidence loop (asserted in A6) | ✅ 2026-07-05 |
| A6 | **Freeform (region)**: stroke stored, centroid selector, AND a screenshot (only the Freeform tool captures) + resolve → after-shot evidence loop | ✅ 2026-07-05 |
| A7 | **SPA refilter**: hashchange/popstate refilter the badge (route = pathname+hash; query deliberately ignored) | ✅ 2026-07-05 |
| A8 | **Connection visibility / feedback feed** (CORE, see PRODUCT.md): every prompt answers in the top-right feed — „Agent arbeitet" (send icon) / „gespeichert — kein Agent" (clock) / „Bridge offline — Warteschlange" (alert) / „erledigt" (check); connection loss + recovery land there too; chips are Lucide-iconed, max 4, self-fading. Texts asserted in A/B runs, look via design-shots | ✅ 2026-07-05 |
| A9 | **Multi-selection (Shift+Klick)**: two shift-clicks → selection carries `targets[]` (2 Elemente, DOM-only), composer counts mit, one transient outline per element; send → pin carries both targets (selector+xpath each), NO screenshot, outlines gone after send (fire-and-forget). Late re-check: element pins never gain an after-shot | ✅ 2026-07-05 |
| A10 | **Queue management (0.9.0)**: text-less prompt shows a speaking label („Markierung: ‚innerText'" / N Elemente / selector); row × discards via DELETE (store + inbox + shots weg, feed chip „verworfen"); dots lifecycle asserted (3 → 2 after discard) | ✅ 2026-07-05 |
| A12 | **Zustands-Feedback 0.12.0**: Punkt GRÜN bei agentLive (Suite-Heartbeat), amber sonst; Badge zählt nur OFFENE, verschwindet bei 0; Erledigt-History im Queue-Popover (q-div „Erledigt", Zeile mit grünem Check, resolvedAt-Alter) | ✅ 2026-07-05 |
| A11 | **Härtung 0.10.0**: CORS-Grenze (fremder Origin → keine CORS-Header, localhost reflektiert); leeres Senden = reine Markierung, KEIN Pin; Klick-Konvention (normaler Klick setzt Multi auf Einzel zurück, nur ⇧ sammelt); Agent-Wiring-Drift-Check (Repo = installiert) als Schlussbein | ✅ 2026-07-05 |

## Suite B — live chain, automated (live-drill.mjs)

| # | Guards | Last |
|---|--------|------|
| B1 | **Bidirectional, click-only**: pick on :5185 → `/selection` fresh in <10 s AND the user-level hook surfaces AKTUELLE MARKIERUNG (what a Zed agent sees on the next message) | ✅ 2026-07-05 |
| B2 | **Rapid-fire queue**: 3 prompts in quick succession → ids strictly monotonic, arrival order = send order, badge +3; watcher wakes arrive in order (observed live in the agent session, 3× on 2026-07-05) | ✅ 2026-07-05 |
| B3 | **Resolve loop on the live page**: feed chip + evidence against the real store | ✅ 2026-07-05 |
| B4 | **Generic web app**: framework-free static page (python http.server) — pick, selection, prompt land identically. Nudge is app-agnostic | ✅ 2026-07-05 |
| B5 | **Self-healing**: kill the bridge → content script reports → SW `connectNative` → native host revives it detached (~8 s). Playwright needs the host manifest in `<user-data-dir>/NativeMessagingHosts` (script handles it) | ✅ 2026-07-05 |

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
