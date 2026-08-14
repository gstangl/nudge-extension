# Schriften in diesem Verzeichnis

`rn-sans.woff2` und `rn-sans-italic.woff2` sind abgeleitet von **IBM Plex Sans**
(© 2017 IBM Corp.), lizenziert unter der SIL Open Font License 1.1 — der
vollständige Text liegt in `OFL-IBMPlexSans.txt`.

Änderungen gegenüber dem Original:

- Breitenachse auf `wdth 100` fixiert (nur `wght 100–700` bleibt variabel)
- Subgesettet auf Latein + deutsche Typografie
- **Umbenannt in „Roots Nudge Sans"**

Die Umbenennung ist keine Kosmetik, sondern eine Auflage: IBM Plex führt den
Reserved Font Name **„Plex"**. Die OFL untersagt es modifizierten Fassungen,
diesen Namen als primären Schriftnamen zu tragen. Da wir subsetten und
instanzieren, ist unsere Fassung eine Modified Version — sie darf „Plex" weder
im CSS-Familiennamen noch in der `name`-Tabelle führen.

Quelle: https://github.com/IBM/plex
