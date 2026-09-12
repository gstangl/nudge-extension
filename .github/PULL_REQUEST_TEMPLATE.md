## What and why

<!-- One paragraph. Link the issue if there is one. -->

## Checklist

- [ ] `cd test && npm run test:ci` is green
- [ ] Extension or bridge changed → the relevant Playwright suites from
      `test/protocols.md` were run (name them here)
- [ ] Version bumped (`extension/manifest.json`, and `bridge/bridge.mjs` +
      `bridge/package.json` if the bridge changed) and a `CHANGELOG.md` entry
      added in the same change
- [ ] Everything is English (code, comments, UI and agent-facing strings, docs)
- [ ] No personal paths, names or ids added
- [ ] Scope change → I read `docs/VISION.md` (non-goals still hold)
