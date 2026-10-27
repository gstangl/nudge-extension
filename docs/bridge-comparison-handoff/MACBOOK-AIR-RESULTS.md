# MacBook Air execution results

Execution of [EXECUTION.md](EXECUTION.md) (issue #12) on 2026-10-27. Every claim
below is bound to a file under [evidence/macbook-air/](evidence/macbook-air/)
(sanitized text export, original/exported hashes in its `evidence-export.json`).
Local evidence only: no remote CI, native lifecycle, OS power-loss, actual-agent
receipt (TS), independent human review or acceptance is claimed.

## Host

Shell verified on the physical laptop before any build: MacBook Air `Mac14,2`,
Apple M2 (4P+4E), 24 GB, macOS 26.7.1 (25G241), arm64. Native arm64 Node
v26.12.1; rustc/cargo 1.99.1 Homebrew, host `aarch64-apple-darwin` (installed for
this run; same toolchain version as the earlier Intel lane). Google Chrome
156.0.8078.48 (universal binary, SHA-256 in `host/host.json`); Playwright
Chromium 1228 in a test-local browser directory. Spotlight indexing and unrelated
user processes ran throughout (load average 5–18 on 8 cores); nothing was stopped.
No result here is a quiet-host measurement.

## Source, build and policy identity

| Item | Value |
|---|---|
| Fetched handoff | `915b2030a7bb6f731fdd2aee536ab9b291fa0116` (branch tip at fetch) |
| Final candidate source | `c467513`, recorder source manifest `043f31cf…7852` |
| Rust production build | `3e095928…f582` (native arm64, `--locked`, release) |
| Rust fault-hooks build | `fec219a8…85ecf5` (crash barriers only, never timed) |
| Frozen policy v1 | `a9df457c…9a68` (verified, unchanged) |
| JS0 | `9241fae9…7d758`, all 153 manifest entries byte-verified in a separate worktree |

## Defects found and fixed (Rust candidate)

Each was reproduced red against the earlier build before the fix and is now a
permanent check for both candidates. Expectations come from the reviewed
JavaScript behavior, the product contract and ECMAScript, never from Rust.

| # | Defect | Requirement | Red evidence | Check |
|---|---|---|---|---|
| 1 | Equal-`since` owner election followed `HashMap` order (random per process) | BR-05 | `red-owner-tie-915b203` 6/6 wrong | `bridge-owner-tie` |
| 2 | v2 receipt signature not JS-compatible (number spelling, UTF-16 key order, `\|\| null`, UTF-16 cut): JS↔Rust retries returned 409 | BR-02, BR-10 | `red-canonical-retry-915b203` | `bridge-canonical-retry` |
| 3 | Valid JS store with an unpaired surrogate classified corrupt; Rust served an empty store | BR-01, BR-04, BR-10 | same | same |
| 4 | Responses dropped after client half-close (28/40 valid requests lost) | BR-08 | `red-half-close-915b203` | `bridge-half-close` |
| 5 | Request bodies with the unpaired-surrogate escape the extension's own 300/1200/400-unit truncation can send were refused 400 | BR-02, BR-10 | `red-canonical-lone-body-49d89de` | `bridge-canonical-retry` |
| 6 | Inbox mirror and withdrawal marker differed from the direct-reader format | BR-10 | `red-differential-256891c` | `bridge-differential` |
| 7 | WS pin projection sent full multi-target objects and amendment authors | BR-10 | same | same |
| 8 | Unlabelled sessions `null` instead of `?`; claimed hosts not normalized | BR-06, BR-05 | same | same |
| 9 | Host-less watchers never discovered Portless previews, so foreign hosts fell back to them | BR-05 | same | same |
| 10 | Selection crop overwritten before an invalid overview was refused | BR-09 | same | same |
| 11 | Annotations kept unknown keys | BR-10 | same | same |

Defects 6–11 came from an independent route-by-route review and were then
confirmed by the differential check, which itself passes JS-vs-JS. One
deviation is declared, not hidden: Rust strings cannot hold an unpaired
surrogate, so a JS-truncated prompt's last half-character reads as U+FFFD; ids,
receipts, effect counts and every other unit stay exact.

Shared test fix: the fixture gauntlet navigated before its static server was
ready (`net::ERR_CONNECTION_TIMED_OUT`, recorder 1); it now waits with a finite
deadline and owned cleanup.

## Recorded runs

| Run | Revision | Result |
|---|---|---|
| Recorder 1 | `915b203` | failed: `rust-bridge-origin-headers` (real half-close defect), `rust-bridge-conformance` (all cases passed, but source manifest contaminated by a test file I briefly placed in the worktree; not counted), `browser-regression` (gauntlet setup race). Suite X **passed**; no stall reproduced. |
| Recorder 2 | `49d89de` | 34/34 passed, source unchanged |
| Recorder 3 | `256891c` | 34/34 passed, source unchanged |
| Recorder 4 (final) | `c467513` | **35/35 passed**, source unchanged, includes Suites A–Z browser regression, parity, coexistence, both candidates' shared suites, crash barriers, rollback, negative controls and interruption |

`npm run test:ci` passed before every recorder (254 unit tests, runtime-neutral
and setup integrations). `cargo test --locked`: 17 passed at `c467513`.

## Coverage of the 115 scenarios

Mapper: `test/bridge-coverage.mjs` over recorder 4 plus the diagnostics below
(`recorder-4-c467513-final/coverage.json`).

| Execution | Count | Meaning |
|---|---|---|
| passed | 41 | fully mapped and every assertion file ran green |
| partially-exercised | 36 | ran green, but the catalog lists missing drivers/prerequisites |
| unavailable | 31 | no driver/platform exists (clock control, OS faults, native host, Safari, soak…) |
| partially-run | 5 | R03–R07: `portless-worktrees` needs an installed Portless CLI (not present; not installed to avoid altering everyday tooling) |
| not-run | 2 | C09 (`latency-bench`), M08 (full Safari package lane) |

A passing check covers its cases only; the catalog is not green as a whole.

## Diagnostics (not qualification)

Real Google Chrome Send, T0 ready pointer dispatch → TW unchanged watcher
stdout, synthetic opted-in session, pull wake. TA recorded; TQ and TS
unavailable. Nearest-rank percentiles over successful values, full denominators.

| Lane | Attempts | Delivered | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| JS0 (own extension 0.35.1, bridge 0.20.0, watcher) | 30 | 30 | 21.3 | 22.2 | 24.0 |
| JS1 (extension 0.35.2, bridge 0.20.1) | 30 | 30 | 20.9 | 22.4 | 26.1 |
| Rust `c467513` with JS1 extension/watcher | 30 | 30 | 21.4 | 37.3 | 207.7 |

Paired seeded blocks (`bridge-compare --blocks 3 --samples 20`, essential gates
passed first): 60/60 delivered per candidate; p95 differences Rust−JS of
−0.4, +149.5 and −126.1 ms, with both candidates showing 160–420 ms tails in later
blocks under load 10–14. Three pairs are below the policy's five-pair minimum:
**inconclusive**.

Bridge-only RSS after 300 direct sequential HTTP submissions: JS 89.8 MB, Rust
13.1 MB; direct HTTP p50 2.26 vs 2.95 ms. This is the bridge process only, not
the process tree; the watcher, CLI and hook remain Node in both candidates.

## W1–W5 status

- **W1** Harness: real Chrome Send through the unchanged watcher passed in all
  lanes; seeded drop/duplicate/misroute candidates killed (`negative-controls`);
  after the campaign no candidate, watcher, test browser or fixture server
  process remained, and source/build identities were unchanged at every run end.
  Invalid clocks and stale bindings remain covered only where the catalog maps them.
- **W2** JS0 measured with its own verified bytes in an isolated worktree, plus
  only the current harness files (untracked, inside its source manifest
  `05dd65bc…8a56`); JS1 measured separately.
- **W3** Retained socket/withdrawal red/green regressions re-ran green in every
  recorder. Coverage/mutation floors (95 % critical branch/line) are **not**
  measured; no coverage tooling ran.
- **W4** Rust independently inspected; 11 defects fixed (above). Open, recorded
  divergences: extra broadcast on any socket close; hello URLs over 2000 chars
  truncated instead of cleared; several error strings/status codes; legacy
  no-`submissionId` submissions with an invalid crop refused instead of stored
  without image; non-RFC-3339 `submissionCreatedAt` refused; BOM-only amend
  accepted; unbounded vs 32-frame WS client queue; no mtime reload of external
  store edits; v1 receipts refused. Native launch/framing is not implemented.
- **W5** Not qualified. Five blocks × 2000 sends, the cadence scheduler, paired
  bootstrap uncertainty, 2-hour and 24-hour soaks, native/OS/host lanes and TS
  were not run: their prerequisites (complete catalog, coverage floors, native
  launcher, supported host receipt observer) are missing. `--qualify` still
  refuses deliberately.

## W6 decision: retain JavaScript

The frozen policy requires Rust to show a practical benefit.

- **Primary benefit is not attainable here.** It needs a Chrome→watcher p95
  improvement of ≥ 20 % and ≥ 20 ms. JS1's p95 is 22.4 ms (JS0 22.2 ms); a 20 ms
  gain would require p95 ≤ 2.4 ms, below the ≈ 21 ms dispatch-to-watcher floor
  both candidates share. No Rust run approached it; its single lane had the
  worse tail.
- **Alternative benefit is not demonstrated.** Bridge-only RSS is 85 % lower, but
  it is neither the whole process tree nor a dominant cost on this machine, and
  Rust removes no installation failure class: it adds a Rust toolchain while
  still requiring Node for the watcher, CLI and hook, and has no native launcher.
- **Correctness cost was real.** Eleven compatibility defects, three of them
  policy hard-failure classes (unsafe compatibility, false conflict on retry,
  store served empty), were found in one session; further divergences remain open.

So the JavaScript bridge stays the everyday bridge; nothing was merged,
released, deployed or installed. The Rust candidate and its checks stay in the
tree as an experiment. Revisit only with a whole-process-tree resource case that
is dominant, or a native-host installation case it actually removes.
