# Nudge installieren & benutzen

**Nudge = Pixel schupfen mit dem Agenten.** Du promptest direkt auf der laufenden Web-App: Element im
Browser anklicken, sagen was du willst — der Claude-Agent in Zed bekommt alles,
was er braucht (Screenshot, Element, Styles, Konsole), erledigt es und meldet
sich mit „✓ erledigt" zurück in deinen Browser. Funktioniert auf jeder
`localhost`-Seite, egal welches Projekt.

---

## Voraussetzungen

- macOS mit **Google Chrome** und **Node.js** (`node -v` sollte etwas ausgeben)
- **Claude Code** (in Zed oder als CLI)
- Das `roots-apps`-Repository lokal (darin lebt der Nudge-Code: `nudge/`)

## Installation — einmalig, ~5 Minuten

### 1. Bridge-Abhängigkeit installieren

```bash
cd <dein-pfad-zu>/roots-apps/nudge/bridge
npm install
```

### 2. Chrome-Extension laden (Developer-Modus)

1. In Chrome `chrome://extensions` öffnen.
2. Rechts oben den Schalter **„Entwicklermodus"** aktivieren.
3. **„Entpackte Erweiterung laden"** klicken und diesen Ordner auswählen:
   `roots-apps/nudge/extension/`
4. Die Karte „Roots Nudge" erscheint. **Kopiere die ID** (lange Buchstabenkette
   unter dem Namen, z. B. `ianmgpfbb…`) — die brauchst du im nächsten Schritt.

### 3. Native Host registrieren (Chrome verwaltet ab dann die Bridge)

```bash
cd <dein-pfad-zu>/roots-apps/nudge/bridge
./install-native-host.sh <deine-extension-id>
```

Ab jetzt startet Chrome den lokalen Brücken-Prozess selbst und hält ihn am
Leben — du musst nie ein Terminal dafür öffnen.

### 4. Agent-Seite einrichten (Skill + Hooks)

```bash
<dein-pfad-zu>/roots-apps/nudge/agent/setup-agent.sh
```

Das installiert in dein `~/.claude/`:
- den **Skill `/nudge`** (das Playbook des Agenten),
- zwei **Hooks** (jede neue Agent-Session verbindet sich automatisch; jede
  deiner Nachrichten trägt die aktuelle Markierung als Kontext),
- den globalen **Store** `~/.claude/nudge/` (dort landen deine Prompts).

Das Script ist ungefährlich: Es ergänzt deine bestehenden Einstellungen, ohne
etwas zu überschreiben, und kann beliebig oft laufen.

### 5. Funktionstest

1. Beliebige `localhost`-Seite öffnen (z. B. deine Dev-App).
2. Oben rechts erscheint die dunkle **Nudge-Leiste**. Der kleine Punkt links:
   erst grau/amber, und sobald ein Agent lauscht **grün**.
3. Claude-Code-Session starten (in Zed), irgendetwas tippen — z. B. `/nudge`.
   Der Agent verbindet sich selbst; der Punkt wird grün.
4. **„Pick"** klicken → ein Element anklicken → kurzen Prompt tippen → **Senden**.
   Rechts oben muss erscheinen: **„nudge_X — Agent arbeitet"**. Das war's.

---

## Bedienung

| Aktion | So geht's |
|---|---|
| **Leiste ein/aus** | `Alt+C` oder Klick aufs Nudge-Symbol in der Chrome-Toolbar |
| **Element prompten** | „Pick" → Element anklicken → Prompt tippen → `⌘↩` |
| **Ebene korrigieren** | Nach dem Klick zeigen Chips die Eltern-Elemente (`td → tr → table`) — klicke die Ebene, die du wirklich meinst |
| **Mehrere Elemente** | `Shift+Klick` sammelt Elemente in EINEN Prompt („tausche diese beiden") — nochmal Shift+Klick nimmt eines wieder raus, normaler Klick startet neu mit einem Element |
| **Region prompten** | „Freeform" → mit gedrückter Maustaste einkreisen → Prompt |
| **Nur markieren** | Element anklicken → **leer senden** (oder Esc) — dann in Zed einfach „mach *das hier* größer" schreiben; der Agent weiß, was gemeint ist |
| **Viele Änderungen schnell** | Einfach hintereinander senden — der Agent arbeitet sie strikt der Reihe nach ab; der Zähler in der Leiste zeigt, wie viele offen sind |

**Feedback rechts oben (kleine Chips):**
- ✈ „nudge_X — Agent arbeitet" — angekommen, Agent ist live dran
- 🕐 „gespeichert — kein Agent verbunden" — geparkt, läuft beim nächsten Agenten
- ⚠ „Bridge offline — Warteschlange" — wird automatisch nachgesendet
- ✓ „nudge_X erledigt" — der Agent ist fertig (mit Vorher/Nachher-Beweis)

**Der Status-Punkt (Leiste + Chrome-Icon):**

| Farbe | Bedeutung |
|---|---|
| **Grün** | Agent lauscht live — Prompts werden sofort bearbeitet |
| **Amber** | Verbindung steht, aber kein Agent — Prompts werden gespeichert |
| **Rot** | Brücke nicht erreichbar — Prompts landen in der Warteschlange |
| **Grau** | Leiste ausgeschaltet (`Alt+C`) |

## Wenn etwas klemmt

1. **Punkt bleibt rot:** ~10 Sekunden warten (Chrome repariert die Brücke
   selbst). Bleibt er rot → Tab neu laden (`⌘R`).
2. **Punkt bleibt amber:** Es lauscht kein Agent. In Zed eine Claude-Session
   starten und eine Nachricht schicken (z. B. `/nudge`).
3. **Alles andere:** Im Agenten `/nudge` tippen — die erste Zeile der Antwort
   ist immer der Verbindungs-Report, und der Agent repariert sich von dort.
4. Nach Nudge-Updates aus dem Repo: einmal `chrome://extensions` → ↻ bei
   „Roots Nudge", dann den Tab neu laden.
