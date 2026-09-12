# Fonts in this directory

All three files are derived from **IBM Plex** (© 2017 IBM Corp.), licensed under
the SIL Open Font License 1.1. The full license text is in `OFL-IBMPlexSans.txt`.

| File | Original | Changes |
|---|---|---|
| `rn-sans.woff2` | IBM Plex Sans | width axis pinned to `wdth 100` (only `wght 100–700` stays variable), subsetted, renamed |
| `rn-sans-italic.woff2` | IBM Plex Sans Italic | same |
| `rn-mono.woff2` | IBM Plex Mono Regular | subsetted, renamed to "Roots Nudge Mono" |

Each file is subsetted to Latin plus German typography.
**Renamed to "Roots Nudge Sans" and "Roots Nudge Mono".**

The rename is a license requirement, not cosmetics: IBM Plex carries the
Reserved Font Name **"Plex"**. The OFL forbids modified versions from using that
name as the primary font name. Because these files are subsetted and
instanced, they are a Modified Version and must not carry "Plex" in the CSS
family name or in the `name` table.

Source: https://github.com/IBM/plex
