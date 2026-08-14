# Schriften in diesem Verzeichnis

Alle drei Dateien sind abgeleitet von **IBM Plex** (© 2017 IBM Corp.),
lizenziert unter der SIL Open Font License 1.1 — der vollständige Text liegt in
`OFL-IBMPlexSans.txt`.

| Datei | Original | Änderungen |
|---|---|---|
| `rn-sans.woff2` | IBM Plex Sans | Breitenachse auf `wdth 100` fixiert (nur `wght 100–700` variabel), subgesettet, umbenannt |
| `rn-sans-italic.woff2` | IBM Plex Sans Italic | dito |
| `rn-mono.woff2` | IBM Plex Mono Regular | subgesettet, umbenannt in „Roots Nudge Mono" |

Subgesettet wurde jeweils auf Latein + deutsche Typografie.
**Umbenannt in „Roots Nudge Sans" bzw. „Roots Nudge Mono".**

Die Umbenennung ist keine Kosmetik, sondern eine Auflage: IBM Plex führt den
Reserved Font Name **„Plex"**. Die OFL untersagt es modifizierten Fassungen,
diesen Namen als primären Schriftnamen zu tragen. Da wir subsetten und
instanzieren, ist unsere Fassung eine Modified Version — sie darf „Plex" weder
im CSS-Familiennamen noch in der `name`-Tabelle führen.

Quelle: https://github.com/IBM/plex
