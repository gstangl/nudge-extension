# Architecture map verification

Date: 2026-09-13. Assurance: `checked_locally`, not independent acceptance.

## Frozen subject

- Tool: Archify 2.16.0, pinned in `toolchain.json`.
- Product source revision: `d2fc35c3d2b997836c7a5476090ccb9e26c08091`.
- Specification: `nudge.architecture.json` (3,849 bytes).
- Specification SHA-256: `34e2322deb87f34e9a6906dc5752993b293450c7b94b3dd2d5635cd97ef0b7e6`.
- Artifact: `nudge.html` (715,456 bytes).
- Artifact SHA-256: `a92817ecd1ddabc58d068e09e67c40de86fcae9b473f6cf6fca318f7ae9b57c8`.

## Evidence ledger

| Check | Result |
| --- | --- |
| Installed tool provenance | Passed: all 190 upstream skill files match Git blob hashes at the revision in `toolchain.json`. |
| `node scripts/render-architecture.mjs --visual` | Passed: doctor, 9/9 Showcase checks, zero errors/warnings, 17 revision-bound source references. |
| Automated viewport checks | Passed at 1440x900, 1600x1000, 1920x1080 and 2048x1320; no horizontal or vertical overflow. |
| Image-capable agent visual review | Passed after inspecting light/dark captures at 1440x900 and 2048x1320: complete cards, readable labels, clear routes and viewer controls. No post-delivery visual correction required. |
| Headless Chrome diagram interaction | Passed: theme switch both ways, search for bridge, focus shared bridge, inspect two revision-bound source links, navigate a relationship to the store, close passport, reset view and download clean SVG. No page errors. |
| `node scripts/render-architecture.mjs` | Passed again under Node 22.23.2; specification and HTML hashes match the Node 26.8.2 visual run byte for byte. |
| `node --check scripts/render-architecture.mjs` | Passed. |
| `cd test && npm run test:ci` | Passed under Node 22.23.2: 172 unit tests, runtime-neutral integration and agent setup checks. |
| `git diff --check` | Passed. |

The renderer writes `nudge.delivery.json`; automated visual evidence is in
`nudge.visual-check.json` and the matching contact sheet/screenshots. Generated
receipts contain local paths and are ignored by Git. The automated report's
`visualReview: pending` is not overwritten: the separate visual review above
records actual image inspection for the exact artifact hash.

The diagram smoke test initially targeted a hidden legacy relationships toggle
and treated an export menu item as a button. Inspection showed all four
relationships already visible in the passport and SVG exposed as a `menuitem`.
The corrected real-input test checked those controls without forcing clicks or
changing the generated viewer. Visual correction rounds: `0`.

## Limits

This is a curated architecture explanation, not a complete graph or live health
monitor. Source-reference validation proves referenced blobs exist at the pinned
revision, not that every architectural claim has independent acceptance.
Headless Chrome interaction here tests the diagram viewer, not extension feature parity.
No Safari, native containing-app, signing or distribution acceptance was added
by this documentation task. Product runtime files were not changed.
