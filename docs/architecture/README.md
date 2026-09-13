# Architecture map

Archify is installed as a **project-local development skill**, outside the
extension and bridge dependency trees. The tool is MIT-licensed, pinned in
`toolchain.json`, and ignored as third-party installation content. No global
agent settings or product runtime are changed.

The authored source is `nudge.architecture.json`. It describes the source
revision recorded in `meta.repository`, not live browser health or independent
acceptance. Its source references are validated against this checkout and the
pinned revision. A green renderer proves diagram consistency, not architecture
correctness or full Safari parity.

## Install and reproduce

Install the `archify/` folder from the
[pinned upstream revision](https://github.com/tt-a1i/archify/tree/c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de/archify)
into `.agents/skills/archify`. With the Codex Skill Installer, use repository
`tt-a1i/archify`, path `archify`, the exact revision in `toolchain.json`, and
project destination `.agents/skills`. The installed skill is discoverable on
the next agent turn. The package needs Node.js 18+ and no dependency
installation for rendering. The render script checks the installed package
version; it does not install, update or repair third-party files.

Run these commands from the Nudge repository root. Source validation needs the
recorded product revision in local Git history; fetch that revision first if
working from a shallow clone.

```sh
node scripts/render-architecture.mjs
node scripts/render-architecture.mjs --visual
```

The first command validates source evidence, runs all nine Showcase checks,
and atomically delivers `nudge.html` with a byte-identity receipt. `--visual`
additionally measures four desktop sizes and captures light/dark screenshots.
Its automated visual-review label remains pending until a person or image-capable
agent actually inspects those screenshots. Generated HTML, screenshots and
machine-specific receipts are deliberately ignored by Git.

See [verification evidence](VERIFICATION.md) for the reviewed artifact hashes,
browser checks and explicit acceptance limits.

To view locally without exposing the repository root:

```sh
python3 -m http.server 4889 --bind 127.0.0.1 --directory docs/architecture
```

Open `http://localhost:4889/nudge.html`. This server only serves the architecture
directory; it is not another Nudge bridge. Stop it with Ctrl-C when finished.

## Reading the map

- **Shared source:** `extension/` contains toolbar, capture, queue and worker.
- **Chrome:** loads that source directly; its platform defaults enable the
  registered native bridge launcher.
- **Safari:** `scripts/package-safari.mjs` stages the same source with
  `safari/manifest-overrides.json`. Release resources disable Chrome-native
  startup and development reload. The containing native app is not implemented.
- **Shared runtime:** both default to the same local bridge on port 4700,
  durable inbox, agent roster and ownership rules. Browser-local storage remains
  separate; image identities include browser, session, tab and document.

Dashed arrows show packaging/loading. Solid arrows show runtime dependencies.
Runtime HTTP/WS arrows summarize a bidirectional transport; they are not a
claim that responses or after-image requests flow only left to right.

The map is intentionally curated. It omits worker internals, every HTTP route,
failure/retry state machines and the detailed test matrix. The Safari evidence
boundary remains in [the Safari guide](../SAFARI.md).
