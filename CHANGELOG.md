# Changelog — Nudge (formerly Pin)

All notable changes to Nudge (extension + bridge + agent wiring). Format follows
[Keep a Changelog](https://keepachangelog.com); the **extension version is the
product version**, bridge versions noted where they moved. Rule: every version
bump lands here in the same change — no silent releases.

## [0.16.2] — 2026-07-05

### Fixed
- **Toolbar-Klick schloss Seiten-Popovers** (z. B. „Finale Version freigeben?"):
  Events aus unserer Chrome bubbeln composed bis zum document und zählten als
  Outside-Click — transiente UI ließ sich nicht nudgen. Alle Pointer-/Maus-/
  Klick-/Fokus-Events stoppen jetzt an der Host-Grenze (Katalog A-8).

### Added
- `test/scenarios.md`: Edge-Case-Katalog aller Bugs/Lektionen der Build-Sessions
  mit Abdeckungsstatus (✅ automatisiert · 🔧 lohnt · 🥁 Drill · 📖 dokumentiert)
  und priorisiertem Backlog für neue Suite-Beine.

## Bridge 0.10.1 — 2026-07-05 (Lifecycle: inaktive Sessions verschwinden)

### Fixed
- **Watcher überleben ihre Session nicht mehr** (Gerald: „inaktive Sessions
  einfach killen"): (1) Waisen-Check — Session-Prozess tot (Re-Parent an
  launchd) → exit; (2) Standby + Session-Transcript > 60 min idle → exit
  (der gewählte Owner idle-exitet nie); (3) Roster ist SESSION-keyed — armt
  dieselbe Session neu, ersetzt der neue Watcher den alten, der alte bekommt
  `replaced` und beendet sich. Tote Einträge altern weiterhin in Sekunden aus
  der Liste (12 s Frische-Fenster).

## [0.16.1] — 2026-07-05

### Fixed
- Session-Label in der Leiste: gleiche Schriftgröße wie die Werkzeug-Buttons
  (12px), Differenzierung über normalen Schnitt (wght 400) statt Größe (Gerald).

## [0.16.0] — 2026-07-05

### Added
- **Session-Dropdown in der Toolbar** (bridge 0.10.0): Klick aufs Session-Label
  listet ALLE verbundenen Sessions mit Erkennungspaket — Label (Skill setzt
  jetzt standardmäßig ein 2–4-Wort-THEMA), Projekt @ Git-Branch, Host (Zed/CLI),
  „seit X min", erste Nachricht des Threads (aus dem Transcript via geerbter
  CLAUDE_CODE_SESSION_ID). Klick auf eine Zeile übergibt den Wake-Kanal.
- **Standby statt Exit**: Verlierer-Watcher bleiben still am Leben (Roster);
  Owner-Wahl ist sticky, bis die gewählte Session stirbt, dann Fallback
  „neueste". Gewählt-werden weckt die Session mit einer Zeile.

## [0.15.4] — 2026-07-05

### Fixed
- **Pick opened no composer on live re-rendering UIs** (v2-Editor-Kommentar-
  Rail): zwischen mousedown und mouseup zerstörte ein Re-Render das Ziel, das
  click-Event kam nie an — zusätzlich überlagert die ProseMirror-Fläche des
  v2-Editors den Rail-Bereich (eigener Befund für den Estimate-Cleanup-Track).
  Der Picker feuert jetzt auf POINTERDOWN (DevTools-Inspector-Muster) und
  übernimmt die Interaktion vollständig; Verhalten sonst unverändert.

## Bridge 0.9.0 — 2026-07-05 (Speed-Pass: Handover 11×)

### Performance
- **WS-Push statt Dateisystem-Umweg für den Agent-Wake**: der Watcher hängt als
  Client am Bridge-WebSocket (role: agent, taucht nicht als Tab auf) und
  bekommt neue Nudges in-memory gepusht; fs.watch + 5s-Poll bleiben als
  Fallback (dedupe über das seen-Set). **Gemessen: 23,7 ms → 2,1 ms median
  (11,4×), 12/12** — `test/latency-bench.mjs`.
- Wake vor Spiegel: emit() feuert VOR dem Inbox-Mirror-Write (addPin/resolve).
- Selektions-Picks broadcasten keinen Pin-Snapshot mehr (Hover-Frequenz!).
- Debounce des fs-Fallbacks 30 → 10 ms (Writes sind seit 0.8.0 atomar).

### Fixed
- **Clients respektieren NUDGE_PORT** (Watcher hatte 4700 hartkodiert);
  Bench + Härtungstests laufen auf Seitenport 4799 und kollidieren nie mehr
  mit der Selbstheilung des echten Chrome.

## Bridge 0.8.0 — 2026-07-05 (Hardening-Run: Robustheit + Speed)

### Fixed
- **Atomic persist** (tmp + rename) für store.json und selection.json — ein
  Crash mitten im Write kann den Store nicht mehr zerstören.
- **Korrupter Store wird nie mehr still geleert**: Backup nach
  `store.json.corrupt-<ts>`, lauter Log, und der seq-Floor kommt aus den
  Inbox-Mirrors — vergebene IDs werden auch nach Totalverlust nie recycelt.
- **Owner-/Label-Wechsel broadcastet sofort** — vorher zeigte die Toolbar bis
  zum nächsten Pin-Event die alte Session.
- **Oversize-Bodies antworten 413** statt den Socket hängen zu lassen
  (Limit via NUDGE_MAX_BODY, Default 40 MB).
- **Dispatch-Guard**: ein werfender Handler (z. B. fehlende demo.html) tötet
  nicht mehr den Prozess.
- **WS-Ping/Pong (30 s)**: Geister-Verbindungen nach Laptop-Sleep werden
  terminiert — /.identity-Tabs und Broadcast-Ziele lügen nicht mehr.
- Legacy-Heartbeats ohne Identität zählen nicht mehr als „Agent live"
  (hielten sonst das Label einer toten Session am Leben); native-host-Probe
  ohne Timer-Leak; totes MCP-Relikt (waitForEvidence) entfernt.

### Performance
- **Broadcast-Diät**: Snapshots tragen alle OFFENEN Nudges, aber nur noch die
  40 jüngsten erledigten (die History zeigt 8 pro Route) — statt der gesamten
  7-Tage-Historie bei jedem Change an jeden Tab.

Beweise: `test/bridge-hardening.mjs` (corrupt-recovery + seq-Floor,
Owner-Broadcast ohne Pin-Event, 413, atomic) + Suite A 13/13.

## [0.15.3] — 2026-07-05

### Fixed
- **Orphan window before the 5s check**: a visibilitychange could still hit
  chrome.storage on a freshly invalidated context („Uncaught: Extension context
  invalidated at flushQueue"). flushQueue/enqueue now verify the context is
  alive at the call site; the periodic check remains the cleanup path.

## [0.15.2] — 2026-07-05

### Added
- **Self-chosen session names**: the watcher takes `NUDGE_AGENT_LABEL` (env)
  as its identity; directory + pid stay the fallback. Zed does not export its
  thread titles anywhere (verified — UI-only), so named agent-server profiles
  in Zed settings (env per profile) or naming the session in chat are the two
  channels; the skill documents both.

## [0.15.1] — 2026-07-05

### Added
- **Session label in the toolbar**: the owning session (project #pid) sits
  quietly right of the tools while an agent is live — always visible which
  Zed agent reacts, without opening anything. Hidden when no agent listens
  (the dot already tells that story).

## [0.15.0] — 2026-07-05

### Added
- **Agent identity end-to-end** (bridge 0.7.0): the watcher heartbeat carries
  `{label: projekt #pid, since}`; the extension shows the owner in the status
  tooltip („Agent live — roots-apps #4711"), the queue header and a feed chip
  on change; the Zed hook line shows it too („Agent-Watch ✓ (roots-apps #4711)");
  `/.identity` additionally lists the connected tabs (extension hello).
- **Bridge as ownership arbiter**: newest `since` wins; a losing watcher learns
  it from the heartbeat reply and exits itself — its Monitor ending IS the
  handover signal. Replaces the fragile SessionStart pkill (found live: two Zed
  sessions watched in parallel and a nudge landed in the „wrong" agent).

## [0.14.1] — 2026-07-05

### Fixed
- **Page clock sat 2px off-centre**: positionDots() re-showed badges with
  inline `display: block`, overriding the badge's flex centring (found by
  sub-pixel measurement in the QA pass, not by eye). Queue badges were
  unaffected. Contrast + sweep verified in the same pass (clock 8.3:1,
  check 5.8:1, disc-on-page 17.6:1; hand matrix provably rotating).

## [0.14.0] — 2026-07-05

### Changed
- **On-page indicators speak the badge language**: the plain dot became the
  ring badge with the amber Lucide clock — hands sweep while an agent is live
  (a green dot on an element read like a stuck status LED; a running clock
  reads as work). One vocabulary everywhere now: clock = open, sweeping =
  agent working, green = done (check, history only). Refines the 0.12.0
  colour model after Gerald's live test.

## [0.13.3] — 2026-07-05

### Fixed
- **Badge glyph drifted off-centre** — the accordion rule `.q-row.open svg`
  also hit the svg INSIDE the badge and pushed it 2px down when expanded;
  now the badge itself aligns to the first line and the glyph renders
  `display: block` (no inline-baseline drift), dead-centre in both states.

## [0.13.2] — 2026-07-05

### Changed
- **Queue rows carry the page-dot language**: a small round badge (paper ring,
  soft shadow, midnight fill) holds the Lucide glyph — amber clock for open,
  green check for done. While an agent is live, the clock HANDS sweep in a
  slow 4s rotation (CSS on the hand sub-group; Lucide geometry untouched) —
  quiet "working" feedback, matching the green dot on the page.

## [0.13.1] — 2026-07-05

### Added
- **Accordion rows in the queue popover**: click a row (open or done) to expand
  the full nudge text, click again to collapse; expansion survives the live
  re-renders. The dismiss × keeps working independently (stopPropagation).

## [0.13.0] — 2026-07-05

### Changed
- **UI language: English, short and compact** (Gerald) — all labels, feed chips,
  titles, queue texts, options page and the manifest description. Notable:
  „Bridge-Verbindung verloren — heile…" → **„Bridge disconnected"**,
  „erledigt" → „done", „verworfen" → „dismissed", „Markierung:" → „Mark:"
  (label parity extension ↔ agent projections kept). The deictic trigger
  „das hier" stays German — it is what Gerald actually says.

## [0.12.1] — 2026-07-05

### Changed
- Toolbar-Labels: „Element" → **„Pick"**, „Kreis" → **„Freeform"** (Gerald).

## [0.12.0] — 2026-07-05

Der Schubs bekommt Zustände (Gerald: „die Nudges sind das Epizentrum der App").

### Changed
- **Nudge-Punkte zeigen den Zustellstatus**: Amber = angekommen und gespeichert,
  aber kein Agent verbunden; GRÜN = durchgekommen, ein Agent arbeitet live
  (Farbe folgt dem agentLive-Heartbeat, weicher Übergang). Fertig = der Punkt
  verschwindet von der Seite — Erledigung wohnt in der History.
- UI-Wording konsequent „Nudge" (Queue-Header, Feed-Chips, Composer-Placeholder).

### Added
- **History im Queue-Popover**: unter „Erledigt" die letzten 8 abgeschlossenen
  Nudges dieser Route, mit grünem Lucide-Häkchen und Erledigt-Alter
  (bridge 0.6.1 liefert resolvedAt). Bewusst NUR dort — der ✓-Badge-Dauerzustand
  in der Pill wurde nach Geralds Test wieder entfernt (Häkchen in der Liste
  reichen; Badge zeigt weiter nur offene Nudges).

## [0.11.1] — 2026-07-05

### Fixed
- **Orphan cleanup left the reconnect loop alive**: closing the socket fired
  `onclose` → `scheduleRetry` → an invalidated content script (tab from before
  an extension swap) spammed „WebSocket connection failed" forever, and the
  visibility flush threw on the dead context. A `dead` flag now gates
  connect/retry/flush, handlers are detached before the close.

## [0.11.0] — 2026-07-05

### Changed
- **Renamed Pin → Nudge** (Gerald, product decision). The pin was only the
  gesture; the core is NUDGING — polishing the last details of a rendered UI
  (spacing, alignment, type, pixels). For UI designers this is one of the
  hardest parts of agentic development: it must happen on the presentation
  layer, deterministic and visual. The name now says the job, not the mechanism.
- Everything renamed: folder `pin/` → `nudge/`, extension "Roots Nudge",
  bridge identity `roots-nudge` (0.6.0), skill `/nudge` (triggers keep "Pins"
  as legacy alias), hooks `nudge-*`, watcher `watch-nudges.mjs`, global store
  `~/.claude/nudge/`, native host `energy.roots.nudge`, ids `nudge_N`
  (legacy `pin_N` ids remain addressable in all routes), toolbar button
  „Pin" → „Element" (pairs with „Kreis": both name the target of the gesture).
- Folder move = new unpacked-extension id: native-host manifest regenerated,
  one manual "Load unpacked" from `nudge/extension` required; extension-local
  prefs (author, pill position) reset with the new identity.

### Fixed
- **Suite A depended silently on a LIVE watcher**: the green-dot and
  „Agent arbeitet" assertions only passed while some real session happened to
  heartbeat the bridge (surfaced when the rename killed all watchers). The
  suite now runs its own heartbeat — it simulates the live agent it asserts.

## [0.10.0] — 2026-07-05

Härtungs-Release nach dem Drei-Perspektiven-Review (PM · UX · Dev).

### Security
- **CORS auf localhost-Origins begrenzt** (bridge 0.5.0): vorher `*` — jede
  besuchte Website konnte `/selection` (DOM-Auszüge + Screenshots der offenen
  App), `/comments` und `/shots/*` lesen. Jetzt wird der Origin nur für
  `http://localhost:*` / `http://127.0.0.1:*` reflektiert; Suite A prüft die
  Grenze (Negativ- + Positivtest).

### Changed
- **Leeres Senden erzeugt keinen Pin mehr** (P1-Wurzelfix): die Markierung ist
  über den Selection-Kanal bereits publiziert (Element sofort, Kreis mit
  Region-Screenshot beim Loslassen) — ein textloser Pin alterte ewig als
  „offener Prompt". Feed-Chip „markiert — kein Prompt erzeugt" bestätigt.
- **Klick-Konvention** (Finder/Figma, wie dokumentiert): normaler Klick setzt
  eine aktive Multi-Auswahl auf EIN frisches Element zurück; nur ⇧ sammelt.
  Vorher erweiterte auch der normale Klick (Verhalten ≠ Doku).
- **Manifest-Identität**: „Roots Nudge" statt „(PoC)", Beschreibung beschreibt
  UI-Prompting statt „Visual comments".
- Resolved Pins > 7 Tage werden beim Bridge-Start gepruned (inkl. shots/inbox),
  Anzahl im Log — store.json und WS-Broadcasts wachsen nicht mehr unbegrenzt.

### Added
- **Label-Parität Agent-Seite**: `pinLine` + Inbox-Mirror beschreiben textlose
  Prompts wie die Browser-Queue („Markierung: ‚Demo'" statt „[Nur Markierung]").
- Feed-Chip „Warteschlange voll — ältester Prompt verworfen" statt stiller
  Kappung bei 25; Offline-Queue flusht nur noch im SICHTBAREN Tab
  (Doppelsendung bei zwei offenen Tabs) und beim Sichtbarwerden.
- Einmaliger Hinweis nach dem ersten anonymen Send: Name in den Optionen setzen.
- Composer-Placeholder nennt ⇧Klick (Multi-Select war unentdeckbar).
- Suite A: CORS-Grenze, Leer-Senden, Klick-Konvention, Agent-Wiring-Drift-Check
  (Repo ↔ `~/.claude/`) als neue Beine; Standing-Rules-Hinweis, dass reale Tabs
  während eines Suite-Laufs kurz an der Test-Bridge hängen.

### Removed
- `extension/version.txt` (Test-Artefakt des Auto-Reload-Checks) aus Git,
  jetzt in `.gitignore`.

## [0.9.1] — 2026-07-05

### Fixed
- **Grip handle rendered blurry** (hand-rolled 10×16 viewBox, subpixel radii) —
  replaced with the official Lucide `grip-vertical` in the same stroke rendering
  path as the neighbour icons; crisp on retina, verified at dpr 2.

## [0.9.0] — 2026-07-05

### Added
- **Queue management in the popover** (bridge 0.4.0): every row has a discard
  **×** (`DELETE /comments/:id` — removes pin, inbox mirror and evidence files;
  a discard is NOT a work outcome, unlike resolve). Feed chip confirms.
- **Speaking labels for text-less prompts**: instead of „[Nur Markierung]" the
  queue says WHAT is marked — „Markierung: ‚Demo'" (innerText), „Markierung:
  N Elemente" (multi), selector as fallback. `pinForClient` now carries
  `target.innerText` + `targets[].selector`.
- **Open-prompt dots**: one small amber status dot per marked element while its
  prompt is open — disappears on resolve/discard, click opens the queue
  popover. Hidden in evidence shots and while the overlay is off.

### Changed
- **Product rule revised** (Gerald): 0.2.0 said „nothing stays on the page" —
  open prompts are now subtly visible via the dots. Still no popovers/threads
  on the page; the queue popover stays the management surface.

## [0.8.0] — 2026-07-05

### Added
- **Multi-selection via Shift+Klick** (stagewise pattern): collect several
  elements into ONE mark/prompt („tausche diese beiden"). Shift+Klick again
  toggles an element off; a plain click resets to single mode; Esc discards.
  Transient outlines only while composing (fire-and-forget intact). Selection
  and pin carry a `targets[]` array (DOM-only, capped at 12); hook, `pin_list`
  and the inbox mirror show the element count + selectors.

### Fixed
- Element pins could still gain an after-shot via the WS-snapshot "evidence
  backlog" path (predates the 0.7.0 DOM-only rule) — now Kreis-only there too.

## [0.7.0] — 2026-07-05

### Changed
- **Element marks are DOM-only** — selector, xpath, innerText, outerHTML,
  categorized styles fully identify a DOM node (browser-tools-mcp style):
  no screenshot, no capture flicker, instant. Screenshots (and the
  before/after evidence loop) are now **exclusive to the Kreis/region tool**,
  where the pixels are the content.

## Graduation — 2026-07-05

- **Moved `sandbox/pin/` → top-level `pin/`** — Pin is a standalone applet in
  the monorepo (pattern: `website/`, `decks/`), no longer sandbox material.
- Learned & fixed: unpacked-extension ids derive from the directory path
  (native-host manifests regenerated; id computable via sha256(path)→a-p);
  port-race loser bridges now exit instead of lingering (bridge 0.3.0+).

## [0.6.1] — 2026-07-05

### Added
- **Queue popover**: click the badge → read-only midnight popover listing this
  route's open prompts (id · text · age); live-updating, Escape/outside closes.

## [0.6.0] — 2026-07-05

### Changed
- **Monochrome design language**: paper-on-midnight everywhere; colour ONLY for
  status (green live / amber degraded / red dead) and the on-page marking
  accent. Active states and the send button are paper-white.
- **DIN Var ships with the extension** (self-contained `@font-face`, document-
  level injection); mono reserved for selectors/source paths.
- Composer got the **anchor tip** (bordered diamond pointing at the mark,
  side-aware placement) and a properly separated button row.
- Design tokens mirrored from `@roots/design` as a named block — visually part
  of the Roots family, zero runtime dependency.

## [0.5.x] — 2026-07-05

### Added
- **0.5.1 — Feedback feed**: unobtrusive Lucide-iconed chips top right for every
  event (sent/queued/done/connection lost/recovered); replaced single toasts.
- **0.5.0 — Native messaging host**: Chrome owns the bridge lifecycle (thin
  launcher spawns it detached, survives SW suspends); self-healing without any
  agent session. `install-native-host.sh` registers Chrome + Chromium.
- **Global wiring** (same day): store moved to `~/.claude/nudge/`, skill + hooks
  to user level — Pin works for every agent in every project; project
  `.mcp.json` entry removed.

### Removed
- **0.5.2 — MCP surface deleted** (unused since global wiring): bridge dep is
  `ws` only; python watcher replaced by **event-driven node watcher**
  (`fs.watch`, wake in ms instead of 1 s poll) that also heartbeats the bridge.

### Changed
- **0.5.3 — Composer redesigned** as a midnight popover (first pass).

## [0.4.x] — 2026-07-04/05

### Added
- **0.4.1 — Richer element context** (stagewise lessons): `xpath` as second
  locator, `innerText`, categorized computed styles (typography/box/surface).
- **0.4.0 — Motion polish** (frontman lessons): gliding highlight box
  (100 ms ease-out on one persistent node), opacity fades, edge-aware chip
  flip; resolve feedback in the page; queue discipline (oldest-first) on the
  agent side.

## [0.3.x] — 2026-07-04

### Added
- **0.3.0 — Pick = mark**: clicking an element publishes the selection
  instantly (bridge 0.2.0: `/selection` endpoints, latest-wins store) — no
  send needed; Esc/Abbrechen keeps the mark. "Das hier" works in Zed.
- **0.3.1 — Two-phase publish**: element data instantly, screenshot attached
  moments later; reconnect backoff capped at 8 s + instant retry on tab focus.

## [0.2.x] — 2026-07-04

### Changed
- **0.2.0 — Fire-and-forget pivot** (product decision): Pin is UI prompting,
  not annotation. Persistent markers, clustering and the popover were REMOVED;
  feedback = toast + in-flight badge; the resolve evidence loop turned
  invisible.
- **0.2.1 — Empty send = pure mark**; the send toast tells the truth per
  prompt („Agent arbeitet" vs „gespeichert — kein Agent").

### Fixed
- **0.2.2 — Orphan self-cleanup**: content scripts with an invalidated
  extension context remove their overlay instead of half-working.

## [0.1.x] — 2026-07-04

### Added
- **0.1.2 — Honest status chain**: watcher heartbeats the bridge; the icon
  shows grey/red/**amber**/green — green means "an agent acts NOW"
  (bridge 0.1.1: `/agent/heartbeat`, `agentLive` in identity + snapshots).
- **0.1.0/0.1.1 — Status circle icon** (Lucide circle, grey/green/red),
  monochrome badge; **SPA navigation refilter** (hashchange/popstate) fixed
  floating markers; black Lucide-pin identity icon.

### Fixed
- Pin ids are collision-guarded (a manual seq reset once recycled an id and a
  watcher dedup swallowed a real prompt — never again).

## [0.0.x] — 2026-07-03/04 (PoC)

- Initial spike: element picker with layer chips + freehand lasso, dual
  screenshots (dpr-correct crop + overview), console/network excerpt via
  MAIN-world hook, offline queue, WS live sync, MCP tools (pin_list/get/
  resolve), resolve-with-evidence, dev auto-reload, movable pill, Figma-style
  markers with clustering (later removed), E2E suite.
