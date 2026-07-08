# Changelog — Nudge (formerly Pin)

All notable changes to Nudge (extension + bridge + agent wiring). Format follows
[Keep a Changelog](https://keepachangelog.com); the **extension version is the
product version**, bridge versions noted where they moved. Rule: every version
bump lands here in the same change — no silent releases.

## Bridge 0.11.5 - 2026-07-06 (Neue Sessions erscheinen sofort im Dropdown)

### Fixed
- **Neu armierte Sessions brauchten Minuten, bis sie im Switch-session-Dropdown
  auftauchten** (Gerald): die Bridge broadcastete nur bei Liveness-/Owner-Wechsel.
  Trat eine neue Session dem Roster bei, ohne Owner zu werden (weil ein Sticky-
  Owner gesetzt war), erfuhr die Extension nichts davon - bis zufaellig ein
  anderer Broadcast (Owner-Wechsel, Nudge) kam. Jetzt broadcastet die Bridge,
  sobald sich die sichtbare Session-Liste aendert (Beitritt/Label/Abgang) -
  Vergleich gegen die zuletzt gesendete Signatur, damit auch das Ablaufen des
  12-s-Frische-Fensters erkannt wird. Beitritt < 1 s, Abgang < 15 s.
  Beweis: Suite D Leg D16.

## Bridge 0.11.4 — 2026-07-05 (Kidnap-Battletest: rock solid)

## Bridge 0.11.4 — 2026-07-05 (Kidnap-Battletest: rock solid)

### Added
- **Suite I „Kidnap Battletest"** (`test/battletest.mjs`): End-to-End durch die
  echte Extension — Nudge in einer neuen App (Gauntlet-Fixture) unter Owner-Alpha
  gesetzt, dann stürmen 4 Angreifer-Agenten die Bridge (Newest-wins-Heartbeats,
  /agent/owner-Grabs, Fremd-Resolve, geforderte Posts) ~84 Runden lang. Owner-
  Binding UND abgegriffener Kontext (Selector/xpath/innerText/url) bleiben
  unveraendert (jede Runde geprueft). Kanal ist neu zuweisbar, der Nudge nicht.
- Inbox-Spiegel (die Datei, die ein Agent liest) traegt jetzt `agent: <Owner>` —
  die Zugehoerigkeit ist dort sichtbar, kein Kaper kann den Kontext beanspruchen.

## Bridge 0.11.3 — 2026-07-05 (Provenance bulletproof + benannt: „Nudge History")

### Changed
- **Owner-Binding ist jetzt bulletproof** (Gerald: "nicht gekidnappt"): `owner`
  wird als SEPARATES Server-Argument an `addPin` uebergeben, nie aus dem Client-
  Payload gelesen — ein geforderter `owner` im Body ist strukturell wirkungslos.
- **Suite H „Provenance"** (`test/provenance.mjs`, 11 Legs) beweist das Binding
  gegen jeden Kaper-Vektor: Client-Spoof, Owner-Wechsel (Heartbeat + Dropdown),
  Fremd-Resolve, Doppel-Resolve, SIGKILL-Persistenz, Offline→Resolver, gekappter
  Stempel, Discard-ohne-ID-Reuse, 30er-Nebenlaeufigkeit, Projektions-Paritaet.
  Suite A prueft zusaetzlich die ANZEIGE (Owner pro Zeile).
- Die Badge-Klick-Flaeche heisst jetzt **Nudge History** (offene Nudges + DONE-
  Historie, jede Zeile an ihre Agent-Session gebunden) — in Protokoll + Scenarios.

## [0.19.8] - 2026-07-08 (Verwaister Tab sagt „⌘R" statt still zu verschwinden)

### Fixed
- **Nach einem Extension-Reload (Update/Dev-Auto-Reload) verschwand die Toolbar
  wortlos aus offenen Tabs** — für Gerald sah das aus wie „Nudge kaputt"
  (2026-07-08, drei verwaiste Estimate-Tabs). Der Orphan-Cleanup zeigt jetzt
  einen kleinen Hinweis-Pill oben rechts: „Nudge aktualisiert — ⌘R lädt die
  Toolbar neu" (reines DOM, keine chrome-APIs — die sind im verwaisten Kontext
  tot; Klick blendet aus, der Reload erledigt den Rest). Suite L6 verwaist einen
  echten Tab per `chrome.runtime.reload()` und asserted den Hinweis.

## [0.19.7] - 2026-07-08 (Session-id sichtbar in der Toolbar — ohne Klick)

### Added
- **Die session-id8 des Owners steht jetzt direkt in der Toolbar** (dezent, mono,
  rahmenlos, zwischen Name und Localhost-Pille): „Agent: Worktree-Isolation
  bf9d5543 ⟨localhost:5175⟩". Damit matcht Gerald den /nudge-Chat-Report mit der
  Toolbar auf einen Blick — ohne das Dropdown zu öffnen (Gerald). Suite L1
  asserted die klicklose Sichtbarkeit.

## [0.19.6] + Bridge 0.14.1 - 2026-07-08 (Match-Robustheit: vier Detail-Fehler gehärtet)

Robustheits-Review des Agent↔Toolbar-Matchings (Gerald: „prüfe, ob das wirklich
die robusteste Methode ist"). Vier echte Detail-Fehler gefunden und gefixt:

### Fixed
- **`viaFallback` log in einem ~12–17s-Fenster**: stirbt der gepickte Agent, fällt
  `ownerForHost` sofort auf newest-wins zurück, aber der Pick lag bis zum 5s-Sweep
  noch in der Map → Flag sagte „fest". Jetzt aus der TATSÄCHLICHEN Auflösung
  abgeleitet (lebt der gepickte Agent?). Suite K6 beweist den Moment-Umschlag.
- **Race beim Arm-Report**: sofortiges curl nach dem Armen kam dem ersten
  Watcher-Heartbeat (~2s) zuvor → „?" für eine sauber armierte Session. Der
  Report pollt jetzt bis zu 8s auf die eigene Session (Late-Heartbeat-Test grün).
- **Label-Kollision**: der Chat↔Toolbar-Match lief nur übers Label — zwei
  Sessions gleichen Namens wären ununterscheidbar. Die **session-id8 steht jetzt
  auch in jeder Switch-session-Zeile** (Meta-Zeile) — Chat-Report und Dropdown
  tragen denselben un-kollidierbaren Schlüssel. Suite L1 asserted das.
- **`127.0.0.1` ≠ `localhost`**: Ownership war exakt-Host-gekeyt — dieselbe App
  über die andere Schreibweise geöffnet wäre ein FREMDER Host mit eigenem Owner
  gewesen. Bridge normalisiert jetzt beide Pfade (hello-URL + Owner-Pick);
  K5 beweist: eine Route, kein Fork.

## Bridge 0.14.0 - 2026-07-08 (Identity-Report beim Armen — Agent ↔ Toolbar matchen)

### Added
- **`/nudge` meldet beim Armen im Chat, welche Localhosts diese Session besitzt**
  (Geralds Wunsch: schnell abklären, ob der Zed-Agent = der Toolbar-Eintrag ist).
  Format: `Nudge aktiv · „<Label>" · session <id8>` + pro offenem localhost-Tab
  `→ <Owner-Label>` mit „← DIESE Session" und „⚠ nur Fallback".
  - Bridge (0.14.0): `/.identity` liefert jetzt `routes` — pro offenem localhost-
    Tab der aktuelle Owner `{label, session}` + `viaFallback` (nur per newest-wins,
    also evtl. der FALSCHE Agent, bis im Switch-session-Dropdown fixiert). Das
    fängt genau die Falle, dass eine frisch armierte Session einen fremden
    Localhost per Fallback „besitzt" (z.B. nudge-dev besitzt versehentlich das
    Estimate-5175).
  - Skill: Report-Einzeiler (matcht per Session-id, die un-kollidierbare Schlüssel-
    größe) direkt nach dem Armen; Hinweis auf Dropdown-Fixierung bei Fallback.
  - Suite K5 prüft `routes` (expliziter Owner vs. Fallback-Flag).

## [0.19.5] - 2026-07-07 (Nachtrag-Feld leert nach dem Senden — Race gefixt)

### Fixed
- **Der gesendete Nachtrag blieb im Eingabefeld stehen** (Gerald). Race: der WS-
  `amended`-Push rendert die Zeile neu, WÄHREND das `fetch` noch läuft — der
  frische Input wurde aus dem noch vorhandenen Draft mit dem eben gesendeten Text
  restauriert, und das nachträgliche `closeAmend` lief auf der bereits ersetzten
  Zeile ins Leere. Fix: Draft + Feld werden VOR dem Netzwerk-Roundtrip geleert
  (bei Fehler kommt der Text zurück). N6 prüft jetzt zusätzlich, dass nach dem
  Senden kein Feld den Text mehr hält.

## [0.19.4] - 2026-07-07 (Nachträge sind lesbar unter der Zeile)

### Fixed
- **Ein hinzugefügter Nachtrag war nicht lesbar** — es stand nur „+N", aber der
  Text erschien erst, wenn man das Eingabe-Panel öffnete (Gerald: „ich will ja
  lesen, was ich gepromptet habe"). Die Nachtrag-Liste ist jetzt aus dem
  Eingabe-Panel herausgelöst: sie erscheint unter der Zeile, sobald diese
  aufgeklappt ist (Klick auf die Zeile), Original oben, Nachträge darunter mit
  Terracotta-Rand. Suite N5 prüft jetzt zusätzlich die Lesbarkeit des Textes;
  N5/N6 pollen statt fester Sleeps (Flake entfernt).

## [0.19.3] - 2026-07-07 (Senden-Icon aufs aktuelle Lucide-Set)

### Changed
- **Der Nachtrag-Senden-Button nutzt jetzt das aktuelle offizielle Lucide-`send`**
  (Paper-Plane), passend zu den Toolbar-Glyphen (mouse-pointer/circle-dashed) statt
  der alten Lucide-Geometrie. Derselbe Glyph auch im „agent working"-Feed-Chip —
  ein Send-Icon in der ganzen App (Gerald).

### Tests
- **Suite N6** (submit contract): Enter sendet, Shift+Enter ist Zeilenumbruch (kein
  Senden), Feld leert nach dem Senden — die Lücke, an der N5 grün war, während das
  Feld unbenutzbar war. Neue Standing Rule im Protokoll: jede Affordance eines
  Inputs testen (Button + jeder Tastenpfad + das Negative + den Post-Submit-State).

## [0.19.2] - 2026-07-07 (Nachtrag: Senden-Button + Enter sendet)

### Fixed
- **Ein Nachtrag ließ sich nicht abschicken** (Gerald): es gab keinen Senden-
  Button, und Shift+Enter war (bewusst) „neue Zeile", nicht Senden — ohne
  sichtbare Affordance nicht auffindbar. Jetzt:
  - **Subtiler Senden-Button** (Paper-Plane) rechts neben dem Feld, hellt auf
    Terracotta auf.
  - **Enter sendet**, Shift+Enter macht eine neue Zeile (Chat-Konvention); ⌘↩/
    Ctrl+↩ senden weiterhin. Placeholder-Hinweis angepasst („↩ senden, ⇧↩ Zeile").
  - Doppel-Senden-Guard. Bei Erfolg leert + schließt das Feld (der „+N"-Badge
    zählt hoch). Suite N5 klickt jetzt den Button.

## [0.19.1] - 2026-07-07 („Agent:"-Label in der Toolbar)

### Changed
- **Der Session-Name in der Toolbar bekommt ein „Agent:"-Präfix** im selben
  Schriftschnitt wie „Pick"/„Freeform" (wght 500, heller) — so ist auf einen
  Blick klar, dass die Zeile dahinter der Agent ist (Gerald). Name bleibt
  dimmer, Localhost-Pille unverändert. Nur bei einem konkreten Owner; bei
  „N sessions" kein Präfix. Suite L1 zieht das mit.

## [0.19.0] + Bridge 0.13.0 - 2026-07-07 (Nudge ergänzen — Nachträge an einen offenen Nudge)

### Added
- **„+ ergänzen": einen Nachtrag an einen bereits gesendeten, noch offenen Nudge
  anhängen** (Gerald: „manchmal fällt mir erst nach dem Absenden ein, dass ich
  noch was zum selben Nudge schreiben will"). Append-only — der Original-Text
  bleibt unverändert (Provenance), Nachträge sammeln sich in `amendments`.
  - Bridge `POST /comments/:id/amend {text}` (0.13.0): hängt an, weckt den
    besitzenden Agenten **erneut** (Watcher-Key ändert sich → Zeile
    „Nudge X ergänzt: …"), spiegelt den Inbox-`.md` neu (Original +
    „> **Nachtrag (HH:MM):** …"). Aufgelöste Nudges verweigern (409, kein
    Zombie-Re-Open); unbekannte id 404; leer 400.
  - UI: in der Nudge-History bekommt jede OFFENE Zeile ein „+", das ein
    Nachtrag-Feld aufklappt (bestehende Nachträge darüber, ⌘↩/Enter sendet);
    ein „+N"-Badge zeigt die Zahl der Nachträge. Ein halb getippter Nachtrag
    übersteht WS-Re-Renders (Draft-Erhalt).
  - Agent-Contract (Skill): ein Re-Wake „Nudge X ergänzt" = Inbox neu lesen,
    Original + Nachträge sind EIN Arbeitsauftrag; erst nach allem auflösen.
- **Suite N (Amend)** (`test/amend.mjs`, 5 Legs): Original immutable + Inbox,
  Reihenfolge, resolved 409, **echter Watcher-Re-Wake**, History-„+ ergänzen"-
  Round-Trip. Suite A/L/M weiter grün.

### Changed
- `swallowChromePointer` exemptiert jetzt jedes Textfeld (Textarea/Input/
  contenteditable) statt nur den Composer — das neue Nachtrag-Feld fokussiert
  sauber, und Buttons in Composer/History bleiben trotzdem inert zur Seite.

## [0.18.3] - 2026-07-07 (Localhost-Pille zurück in der Toolbar)

### Changed
- **Der Localhost erscheint wieder als Pille im Toolbar-Titel** (`localhost:5175`,
  rechts neben dem sauberen Session-Namen). Klarstellung zu 0.17.4: Gerald wollte
  den Localhost nur nicht INLINE im Namentext — die Pille selbst soll da sein.
  Jetzt konsistent als Pille an allen drei Stellen: Toolbar, Switch-session-Zeilen
  und Feed-Chips. Gespeist aus dem `:PORT`-Suffix des Labels (nicht `location.host`).
  Suite L1 entsprechend angezogen.

## [0.18.2] - 2026-07-07 (Toolbar-Griff schließt auch keine Dropdowns mehr)

### Fixed
- **Ein Klick auf ein Nudge-Widget (z.B. „Pick") schloss offene Seiten-Dropdowns**
  (Gerald, am Estimate-Sortiermenü „Zuletzt geändert"). Ursache: `@roots/ui`s
  `actionMenu` erkennt Außen-Klicks mit einem `document`-Listener in der
  **CAPTURE-Phase** (`addEventListener('pointerdown', onOutside, true)`). Ein
  Klick auf Nudge-Chrome retargetet auf den Host — „außerhalb" des Menüs — und
  Capture feuert VOR dem Host-Bubble-Stop. Fix: den pointerdown/mousedown eines
  echten Widget-Hits am `window`-capture (erstem Hop) schlucken, sodass kein
  Outside-Detector der Seite ihn sieht. Unsere Controls reagieren auf `click`
  (bleibt); Grip (Drag), Draw (Lasso) und Composer (Textcursor) behalten ihren
  eigenen pointerdown.
- Verifiziert gegen das echte `actionMenu`-Muster (aus der Quelle gelesen); als
  Suite-M-Legs M4/M5 verankert. Suite A 14/14, Suite L/F grün.

## [0.18.1] - 2026-07-07 (Toolbar-Griff schließt keine Website-Popovers mehr)

### Fixed
- **Der Griff zur Nudge-Toolbar schloss offene Website-Popovers** (Gerald, am
  Beispiel der roots-Website „Analyse anfragen"): der Nudge-Host ist
  bildschirmfüllend, aber `pointer-events:none`, damit man die Seite zum Picken
  anklicken kann. Ein Klick, der die kleine Pille knapp VERFEHLT, fiel dadurch
  durch auf das Modal-Backdrop der Seite, das bei jedem Außen-Klick schließt.
  Fix: eine schmale „Moat" — Klicks bis 12px um sichtbare Nudge-Chrome werden am
  window-capture absorbiert (nur idle/composing; Pick/Freeform brauchen echte
  Seiten-Klicks). Ein echter Außen-Klick weiter weg schließt das Modal weiterhin
  wie gewohnt — die Moat bleibt eng, sie kapert die Seite nicht.
- Am ECHTEN Popover reproduziert (Nebenbefund: die Default-Pill-Position oben
  rechts überlappt die Nav-CTA) und verifiziert; als hermetische Dauer-Regression
  **Suite M (Page inertness)** eingebaut. Suite A/L weiter grün.

## [0.18.0] - 2026-07-07 (Experten-Politur: Hotkeys, reduced-motion, autogrow)

Vier-Perspektiven-Review (UI-Designer, Power-User, PM, Testing-Engineer), die
Findings gleich eingebaut.

### Added
- **P/F-Tastenkürzel** für den Werkzeugwechsel (Figma/Cursor-Design-Mode-
  Konvention): `P` = Pick, `F` = Freeform. Streng gated — nur wenn das Overlay
  aktiv, aber nicht im Composer ist, kein Modifier gedrückt, der Fokus in keinem
  Seiten-Eingabefeld liegt und kein Popover offen ist. Die Buttons tragen den
  Hinweis im `title` („Pick element (P)").
- **`prefers-reduced-motion`-Respekt**: bei aktivierter Systemeinstellung kollabieren
  alle Overlay-Transitions (gleitendes Highlight, rotierende Clock, Chip-Fades) —
  shadow-scoped, die Host-Seite bleibt unberührt.
- **Suite L (Toolbar & popover UX)** (`test/toolbar-ux.mjs`, 5 Legs): macht die
  Politur dieser Session zu permanenter Regression — Localhost-immer-Pille,
  nur-ein-Popover, Hotkey-Gating, reduced-motion. Ersetzt die Wegwerf-
  Verifikationen. Suite A weiter 14/14 grün.

### Changed
- **Composer-Textarea wächst mit dem Text** bis zur Max-Höhe (dann scrollt sie) —
  längere Nudges sind beim Tippen voll sichtbar statt im festen Guckloch.
- **PRODUCT.md korrigiert**: der stale Trade-off „one live-watch session at a
  time" ist ersetzt durch die Origin-aware-Realität (parallele Sessions
  koexistieren, per Localhost geroutet) — die Doku hinkte dem Shipped-Code nach.

## [0.17.4] - 2026-07-07 (Localhost überall als Pille, nie inline)

### Changed
- **Der Localhost erscheint jetzt überall als saubere Pille statt inline im
  Text** — konsistent durchgezogen (Gerald). Der `:PORT`-Suffix, mit dem jede
  Worktree-Session benannt ist, wird an allen Render-Stellen abgespalten:
  - **Feed-Chips** (neue Verbindung „Agent: …", Session-Wechsel „→ …"): Name
    clean + Localhost-Pille rechts.
  - **Nudge-History-Header**: Name clean + Localhost-Pille (die History ist pro
    Host, also die Pille einmal im Header statt pro Zeile).
  - **History-Zeilen** (`q-who`): nur noch der saubere Session-Name — der Host
    ist über die Route ohnehin impliziert.
  - **Dot-Tooltip**: sauberer Name ohne Port.
  Toolbar-Titel und Switch-session-Zeilen waren bereits sauber (0.17.1/0.17.2).

## [0.17.3] - 2026-07-07 (Nur ein Popover gleichzeitig offen)

### Fixed
- **Nudge-History und Switch-session konnten gleichzeitig offen sein** und haben
  sich überlagert (Gerald). Jetzt schließt das Öffnen des einen das andere —
  ein Popover zur Zeit.

## [0.17.2] - 2026-07-07 (Switch-session: breiter, l2 einzeilig, Pille mit Luft)

### Changed
- **Popover-Breite 340 → 460px**, damit die Meta-Zeile (Projekt · Branch · Editor
  · Alter) elegant auf EINE Zeile passt statt umzubrechen; als Sicherheitsnetz
  `nowrap` + Ellipsis, falls ein Branch-Name doch mal länger wird.
- **Mehr Abstand zwischen Localhost-Pille und Meta-Zeile** (margin-top 2 → 6px),
  die Pille klebte vorher zu sehr am Text darunter (Gerald).

## [0.17.1] - 2026-07-07 (Localhost als eigener Tag, Namen bleiben sauber)

### Changed
- **Der Localhost sitzt jetzt als kleiner, rechts-ausgerichteter Tag auf jeder
  Session-Zeile im Switch-session-Dropdown** (`localhost:5175`), nicht mehr im
  Session-Namen. Gerald benennt jede Worktree-Session mit ihrem Port („Estimate
  Templates :5175"); die `:PORT`-Endung wird jetzt abgespalten und als Tag
  gerendert — der Name bleibt clean („Estimate Templates").
- **Der Toolbar-Titel zeigt nur noch den sauberen Namen**, ohne Port und ohne
  Localhost-Tag (der lebt jetzt in der Liste). Rein Extension-seitig — Bridge
  unverändert auf 0.12.0.



### Added
- **Nudge routet jetzt pro Localhost.** Bisher gab es EINEN globalen Owner fuer
  alle Nudges; bei parallelen Dev-Servern (mehrere Worktrees) landete ein Nudge
  auf localhost:5186 beim falschen Agenten. Jetzt gehoert ein Nudge dem Agenten,
  der SEINEN Host besitzt:
  - Bridge: Ownership ist per-Host (`chosenByHost`); die Bridge stempelt jeden
    Nudge mit dem Owner SEINES Hosts (`ownerForHost(host)`). Ohne Zuweisung
    faellt es auf das alte Einzel-Owner-Verhalten zurueck (neuester Agent) —
    voll rueckwaertskompatibel.
  - Switch-session ist per-Localhost: der Klick sendet `location.host`, weist
    also DIESEN Localhost dem gewaehlten Agenten zu.
  - Per-Client-Snapshot: jeder Tab sieht den Owner SEINES Hosts (keine Falsch-
    Owner-Anzeige).
  - Watcher weckt nur fuer Nudges, deren `owner.session` seine ist; der Context-
    Hook zeigt einer Session nur IHRE Nudges + eine Selektion auf einem Host,
    den sie besitzt.
- **Suite K "Origin routing"** (`test/origin-routing.mjs`, 4 Legs): per-Host-
  Routing, per-Client-Snapshot, Reassign-Immutabilitaet, und — der Beweis —
  ZWEI echte Watcher wecken nur fuer ihren eigenen Host (kein Cross-Wake).
  Rueckwaerts-Regression gruen: A 14 - D 17 - H 11 - G 4 - I 5 - Haertung 7.

## [0.16.15] - 2026-07-06 (Popover wandert STARR mit, nicht nur das Caret)

### Fixed
- Im rechten Bildschirmbereich klemmte das offene Popover am Viewport-Rand fest -
  beim Ziehen rutschte nur das Caret, das Fenster blieb stehen (Gerald). Jetzt
  wandert das Popover beim Ziehen um denselben Betrag wie die Toolbar (Offset beim
  Oeffnen gemerkt, Caret bleibt fix relativ zum Fenster) - Fenster + Caret als
  eine Einheit. Suite A: Popover-follows-drag prueft beide Richtungen.

## [0.16.14] - 2026-07-06 (Popovers folgen der beweglichen Toolbar)

### Fixed
- **Ein offenes Popover (Switch session / Nudge History) blieb zurueck,
  wenn man die Toolbar verschob** (Gerald): die Position wurde nur beim
  Oeffnen berechnet. Jetzt wandern offene Popovers beim Ziehen mit (das
  Caret bleibt aufs Anker-Element ausgerichtet) - gemeinsamer
  anchorPopover-Helper fuer Oeffnen UND Drag. Suite A: Popover-follows-drag.

## [0.16.13] + Bridge 0.11.6 - 2026-07-06 (Switch-session: kein falscher Erfolg, robust gegen Re-Arm)

### Fixed
- **Switch-session meldete "Owner: X" auch bei Fehlschlag** (Gerald sah
  `POST /agent/owner 404` in der Konsole, waehrend der Chip Erfolg zeigte):
  Der Klick klickte eine Session an, die nicht mehr lebte. Der Handler
  prueft jetzt res.ok und meldet ehrlich "<Session> nicht mehr aktiv"
  statt faelschlich Erfolg.
- **Ownership ist jetzt SESSION-basiert statt pid-basiert** (Bridge 0.11.6):
  das Dropdown adressiert die Session ueber ihre id; eine re-armierte
  Session (neuer Watcher-pid) bleibt waehlbar und behaelt die Sticky-Wahl.
  Nur eine wirklich tote/unbekannte Session gibt noch 404. Suite D Leg D17.

## [0.16.12] - 2026-07-06 (Feedback-Chips unter der Toolbar)

### Changed
- Die Feedback-Chips (Agent/Owner/nudge-done ...) erscheinen jetzt sauber
  gestapelt DIREKT UNTER der Toolbar, linksbuendig zu ihr und mit
  gleichmaessigen Abstaenden - statt lose oben rechts am Bildschirm. Sie
  folgen dem beweglichen Pill (placeFeed trackt seine Position).

## [0.16.11] - 2026-07-05 (Switch-session-Popover mit Caret)

### Changed
- Das Switch-session-Fenster ist jetzt ein echtes Popover mit Caret, das
  aufs Session-Label zeigt - identisch zur Nudge History. Caret-CSS wird
  DRY zwischen beiden geteilt; overflow:hidden raus, Ecken ueber Header +
  letzte Zeile gerundet. Der Composer hatte sein Caret (.tip) bereits.

## [0.16.10] — 2026-07-05 (Session-Dropdown: "Switch session")

### Changed
- Titel "Change session" -> "Switch session" (Gerald).

## [0.16.9] — 2026-07-05 (Session-Dropdown: klarere Beschriftung)

### Changed
- Session-Dropdown-Titel „Connected sessions — click to hand over" → **„Change
  session"** (Gerald: „hand over" war missverstaendlich, gerade bei nur einer
  Session; „session" ist das etablierte Vokabular). Tooltip: „Change session —
  pick which agent gets your nudges".

## [0.16.8] + Bridge 0.11.2 — 2026-07-05 (Nudge merkt sich seine Agent-Session)

### Added
- **Jeder Nudge traegt jetzt seine Owner-Session** (Gerald): die Bridge stempelt
  beim Eintreffen server-seitig, WELCHE Agent-Session den Watch-Kanal hielt
  (`owner: {label, session}`). UNVERAENDERLICH — ein spaeterer Owner-Wechsel
  relabelt bestehende Nudges nie, der Kontext bleibt erhalten. Nudges, die ohne
  Agent ankamen, werden beim Aufloesen der aufloesenden Session zugeschrieben.
  Das Queue-Popover zeigt das Label pro Zeile (gedaempft, zwischen Text und
  Alter). Beweis: Suite D Leg D15 (Stempel immutabel ueber Owner-Wechsel +
  Resolve; Offline-Nudge -> Resolver).

## [0.16.7] — 2026-07-05 (Queue-Zeilen: kein Jitter mehr beim Auf-/Zuklappen)

### Fixed
- **Typografie + Icon sprangen beim Auf-/Zuklappen** einer Queue-Zeile (Gerald):
  der open-Zustand schaltete align-items (center→flex-start), margin-top (+1px)
  UND line-height (normal→1.5) gleichzeitig um — bei einzeiligen Nudges aenderte
  das die Zeilenhoehe und verschob Dot/Id/Text. Jetzt teilen collapsed und open
  dieselbe Erste-Zeilen-Geometrie (18px Zeilenbox, flex-start), nur das Umbrechen
  toggelt. Relative Drift ueber 4 Toggles: 0,00 px gemessen.

## [0.16.6] — 2026-07-05 (Queue-Popover: Caret + breiter fuer lesbarere Prompts)

### Changed
- **Queue-Popover ist jetzt ein echtes Popover mit Caret** (Gerald): ein
  Dreieck an der Oberkante zeigt genau auf die Badge, auf die geklickt wurde
  (--caret-x = Badge-Mitte, viewport-genau ausgerichtet, an den Viewport-
  Rand geklemmt). `overflow:hidden` entfiel (haette das Caret abgeschnitten) —
  die abgerundeten Ecken tragen jetzt der Header (oben) und die transparente
  letzte Zeile (unten, ueber den Eltern-Radius).
- **Breiter: 320 → 420 px** — laengere Zeilen, die Prompt-Texte sind deutlich
  besser lesbar (Geralds Beispieltexte umbrechen auf 3 statt ~6 Zeilen).

## [0.16.5] — 2026-07-05 (Immanenter Opt-in-Gate: fremde Agents sehen Nudge NICHT mehr)

### Fixed
- **Fremde Agents bekamen Nudge-Kontext** (G-8): der Opt-in-Zaun (0.10.2) stoppte
  das ARMEN, nicht das INFORMIEREN. Der UserPromptSubmit- und der SessionStart-
  Hook laufen user-level in JEDER Session und injizierten Nudge-Status/Markierung/
  Queue, sobald irgendein globaler Store existierte — ein CI-Agent bezog sich auf
  die Owner-Session („Die neuen Nudges gehoeren der suite-e-Session", Geralds
  Screenshot). Jetzt IMMANENT: der Kontext-Hook zeigt Nudge NUR Sessions, deren
  id im Bridge-Roster steht (also via /nudge gearmt). Keine Roster-Mitgliedschaft
  → komplette Stille. SessionStart injiziert gar nichts mehr (stellt nur die
  Bridge sicher). Bewiesen von Suite G (4 Legs), Hooks port-/store-konfigurierbar
  fuer hermetische Tests.

## [0.16.4] — 2026-07-05 (Suite F Fixture Gauntlet; zwei Picker-Bugs gefixt)

### Fixed
- **Pick auf einem Link folgte dem href** (A-9): preventDefault auf pointerdown
  unterdrueckt den nachlaufenden Klick NICHT — ein Hash-Link routete die SPA um,
  ein echter Link haette die Seite mitten im Composer verlassen. Jetzt wird genau
  der EINE nachlaufende Klick der Pick-Geste am Document-Capture geschluckt (kein
  Zeitfenster — das killte den naechsten bewussten Klick und brach den Datei-Dialog
  von md-pdf). Gefunden von Suite F (Flowbite-Dropdown).
- **Selector-Qualitaet auf echten Templates** (A-10): finder verwarf legitime ids
  mit kurzen Segmenten (#g-modal-title, #dz-card — jedes <=2-Zeichen-Teil scheitert
  an seiner wordLike-Heuristik) und lieferte bruechige Klassenpfade, die beim
  naechsten Re-Render brachen. Jetzt: echte, eindeutige, nicht maschinell wirkende
  id hat Vorrang (DevTools-Konvention), sonst finder.

### Added
- **Suite F "Fixture Gauntlet"** (`test/fixture-gauntlet.mjs`): Dritt-UIs aus dem
  Netz, VENDORED unter `test/fixtures/` (Flowbite/Tailwind-Komponenten + TodoMVC
  React; Quellen/Lizenzen in `fixtures/README.md`) — Modal mit Backdrop-Outside-
  Close, Dropdown/Anchor, Sticky-Header-Tabelle (40 Zeilen), CSS-Transform-Eltern,
  Shadow-DOM-Web-Component, z-9999-Toast, React-Re-Render zwischen Pick und Send.
  Hermetisch (kein Netz zur Testzeit). Fixtures sind Testmaterial, nie Produktcode.

## [0.16.3] + Bridge 0.11.1 — 2026-07-05 (Tests raus aus dem Live-Port; Suite E Real Apps)

### Fixed
- **Test-Agent in Geralds echter Toolbar** („Agent: suite-e", G-7): Suiten
  mussten Port 4700 erobern, weil die Extension ihn hardcodete — dein Chrome
  hing während Testläufen an der Test-Bridge. Jetzt: Test-Browser werden per
  `chrome.storage.local.nudgePort` umgelenkt (vor dem ersten Seiten-Load, via
  Service Worker), Suite A → 4720, Suite E → 4721. **Tests berühren 4700 nie
  mehr**; die Live-Bridge liefert durchgehend. Echte Chrome-Profile setzen den
  Key nie und bleiben auf 4700.
- Bridge `NUDGE_NO_RELOAD=1`: Reload-Watch abschaltbar — eine Worktree-Bridge
  darf einer Extension, deren Ladepfad auf dem ausgecheckten Branch fehlt,
  keinen Reload schicken (hätte sie bis zum manuellen Neuladen getötet).
- `/.identity` exponiert `store` (exakter Pfad): Suiten verifizieren ihre
  Test-Bridge nicht mehr über den Workspace-Dirname (zwei `/tmp`-Stores sahen
  identisch aus — ein Debug-Prozess auf dem Suite-Port unterlief den Check).

### Added
- **Suite E „Real Apps"** (`test/real-apps.mjs`): md-pdf, estimate, media aus
  dem Worktree auf Seitenports — echtes Dokument laden (PagedJS-Vorschau),
  **A-2 endlich automatisiert** (ProseMirror-Node detached vor dem Senden →
  Pick-Zeit-Rect überlebt), Selector-Eindeutigkeit im Asset-Grid,
  Input-Hygiene-Grenze (element-eigene Kanäle nie, seiten-eigene ehrlich),
  Cross-App-Queue-Wahrheit. Protokoll in `test/protocols.md`.

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

## Bridge 0.11.0 — 2026-07-05 (Brutal-Härtung: Suite D + drei Funde gefixt)

### Added
- **Suite D „Bridge Brutal"** (`test/bridge-brutal.mjs`, Seitenport 4798,
  14 Legs): Store-Shape-Fuzz, Path-Traversal, Payload-/Heartbeat-Fuzz,
  **Identity-Truth-Kontrakt** (Toolbar darf nie lügen: Owner-Wechsel gepusht,
  toter Owner fällt ≤ 17 s um, Stille wird ehrlich dunkel, nie > 1 Owner),
  WS-Abuse, 100er-Parallel-Sturm, SIGKILL-Sturm, feindliche Sockets,
  Bind-Surface, Watcher-vor-Bridge. Protokoll + Threat model in
  `test/protocols.md` (Abschnitt Suite D).

### Fixed
- **Bridge crashte beim Start** bei gültig-JSON-aber-falsch-geformter
  store.json (`null`, `[]`, `{pins:"x"}`): Shape wird jetzt validiert und läuft
  in denselben Recovery-Pfad (Backup + seq-Floor) wie unparsebares JSON. Vorher
  hätte der Native Host den crashenden Prozess endlos neu gestartet (E-11).
- **Client-Felder ungedeckelt**: url/title/ua, Single-Target
  (outerHTML/innerText/styles/xpath), Console-Zeilen, Annotations — alles
  Fremd-Input, jetzt gekappt; ein bösartiger/kaputter Client konnte store.json
  auf MB aufblähen (E-12).
- **/agent/heartbeat ohne Body-Limit und ungetypt**: liest jetzt über readBody
  (413 ab MAX_BODY); pid/since müssen endliche Zahlen sein (sonst 400), Roster-
  Felder gedeckelt — String-/NaN-Identitäten degradierten Owner-Wahl und
  Roster-Keys (E-13).
- Suite A: Kaltstart-Barriere (Status-Punkt grün) von 5 s auf 15 s — flakte
  unter Last; Verhaltens-Asserts bleiben eng (G-6).

## Bridge 0.10.2 — 2026-07-05 (Opt-in-Zaun: /nudge ist die einzige Anmeldung)

### Changed
- **Technischer Opt-in-Zaun im Watcher** (Katalog G-5, Härtung H7): ohne
  bewusst gesetztes `NUDGE_AGENT_LABEL` verweigert `watch-nudges.mjs` den
  Start (exit 1, klare Meldung) — der Default-Fallback „Ordner #pid" entfällt.
  Nur Geralds `/nudge` (der Skill setzt das Themen-Label) meldet eine Session
  bei der Extension an; versehentliches Armen durch übereifrige Agenten ist
  damit physisch unmöglich, nicht nur per Regel. Skill-Kontrakt entsprechend
  geschärft („Invoking /nudge IS the registration"); Doppel-Armen bleibt
  harmlos (Bridge ersetzt den älteren Watcher derselben Session).
- Härtungs-Suite: neues Bein H7 (ohne Label → verweigert; mit Label →
  registriert sich im Roster); `latency-bench` armt seinen Test-Watcher
  jetzt explizit mit Label.

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
