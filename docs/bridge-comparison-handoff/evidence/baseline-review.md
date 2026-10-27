# Baseline review

All 16 package SHA-256 checks and all 153 source entry hashes passed. Current
source matched the handoff exactly. Reviewed changes were copied individually
into a HEAD-based isolated worktree and committed as the baseline. No archive was
extracted over a checkout. Original artifacts and ignored live state were excluded.

The 35 changed source paths form these retained cohorts: durable queue/retry and
composer restoration; browser document registration and capture identity;
worktree host discovery/routing with CLI, hook, watcher and package dependencies;
toolbar layout and their existing regression tests; version/changelog/install
records. Retention identifies the supplied JS0 source; it does not endorse those
unpublished changes as release-ready. The original checkout was never modified.

JS0 fast gate: 240 units plus runtime-neutral/setup integrations passed. New ledger
checks bring the development unit gate to 242 tests. Suite A passed. Source-bound
Chrome smoke attempts include a path-canonicalization harness failure and a
Playwright default-disable-extensions setup failure, both retained. The successful
30-send baseline uses precomputed button geometry and real pointer dispatch.
