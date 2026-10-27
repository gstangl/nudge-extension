# Execution commission: complete the Nudge bridge comparison on the local MacBook Air

This is an execution task. Continue the existing implementation, run every available
local check afresh and finish the missing assurance/comparison work. Do not start
another general planning round. Do not presume that Rust is better.

## Source and independent references

Repository: https://github.com/gstangl/nudge-extension

Handoff branch: `agent/bridge-comparison`. Use a fresh isolated worktree and record
the exact fetched commit. The implementation checkpoint before this public
handoff is `0431c12e85f68864d4d4a78a34977cc1f03985c4`.

Read in order:

1. Root `AGENTS.md` and `CONTRIBUTING.md`.
2. This execution commission and [the current runbook](../bridge-comparison.md).
3. [Canonical requirements](../specs/bridge-delivery.md).
4. [Original complete plan](PLAN.md), [test protocols TP-00–TP-12](PROTOCOLS.md)
   and [decision inventory](DECISIONS.md). Their historical planning statements
   are not execution evidence.
5. [All 115 scenarios](../../test/fixtures/bridge-comparison/catalog.json),
   [12 independent reference examples](../../test/fixtures/bridge-comparison/reference-cases.json),
   [frozen comparison policy](../../test/fixtures/bridge-comparison/policy.json)
   and [result template](result-template.json).
6. [Evidence export provenance](evidence-export.json), the retained red/green
   regressions and the interrupted check record under `evidence/`.

All required task context is committed. The ignored `docs/plans/` folder and the
old transfer archive are not prerequisites for this GitHub handoff. Keep one
AGENTS.md; add no second agent constitution or whole-framework installation.

The JS0 baseline is the reviewed source in commit `9241fae` (resolve its full SHA
from Git). Its 153 original source entries are bound by
[baseline-source-manifest.json](baseline-source-manifest.json). Extract any source
archive into an empty directory, verify it, inspect differences, and never overlay
an active checkout blindly. Historical fast-gate proof is retained separately.

Frozen policy v1 SHA-256:
`a9df457cd46adea682dca17c105e0e5db041fc9e9624498d799d2a91b5f99a68`.

## First prove the execution host

The user is commissioning execution on the physical local MacBook Air. A chat
window open on that laptop does not prove that its shell runs there. Before any
build/test, record the hardware model/name, CPU/chip, OS, architecture, working
directory and tool versions. Useful read-only commands are:

```sh
pwd
sw_vers
sysctl -n hw.model
sysctl -n machdep.cpu.brand_string
uname -m
node -p 'JSON.stringify({version:process.version,arch:process.arch})'
rustc -vV
cargo --version
```

Use the hardware name from System Information if the model identifier is ambiguous;
do not export serial numbers or hardware UUIDs. If the shell reports `iMacPro1,1`
and Intel Xeon, it is still the old execution host: do not run the campaign there
or label it a laptop result. Explain the concrete execution-location blocker.

On Apple Silicon, verify native arm64 Node and an aarch64 Rust target. Do not
compare one Rosetta-emulated candidate with one native candidate. Record the
actual architecture on an Intel MacBook Air too. Locate actual Google Chrome;
Chrome for Testing and Playwright's bundled browser are distinct lanes. Capture
binary path/identity and version, not just a Playwright channel label.

## Preserve isolation

The old source checkout contained unrelated dirty work. It was preserved in a
separate baseline commit; its inclusion is not a release endorsement. Preserve
any dirty/active work on the laptop too. Use an isolated worktree, side ports,
stores, browser profiles, synthetic sessions and test-only native hosts.

Never use port 4700, the live prompt store, ordinary Chrome profiles, ordinary
native host registration or everyday agent sessions for these tests. Do not
install hooks into real agent homes. Before stopping anything, verify its exact
test-owned PID/process tree and store. Never kill by a generic process name or
terminate other work to make benchmark numbers look quiet.

Keep the extension plain JavaScript: no bundler, TypeScript or framework. Preserve
opt-in, host routing, source attribution, ownership, existing HTTP/WS surfaces and
direct file readers. Store changes must be additive and tested. No database
migration. Do not commit generated native wrappers. Follow existing version,
changelog and PR-template obligations for runtime changes.

## Current implementation and honest prior results

- JS0: reviewed original snapshot, extension 0.35.1 / bridge 0.20.0.
- JS1: shared extension retired-socket guards and content-free atomic withdrawal
  journal/recovery, extension 0.35.2 / bridge 0.20.1. Compare both candidates using
  these same shared changes; do not attribute their benefit to Rust.
- Rust is an experimental bridge with locked Cargo dependencies and a release
  build. Native launcher/framing/distribution and broad historical compatibility
  remain unfinished. The CLI, hook and watcher still require Node.
- `test/bridge-checks.mjs --browsers` provides a serial recorder. Common external
  suites run unchanged against candidate argument arrays. Only startup is
  parameterized in the existing boundary/realtime/browser-protocol suites.
- At implementation revision `c70de37`, 24 recorded check groups passed, including
  the existing portable gate, common JS/Rust protocol/image/retention/header
  checks, commit barriers, withdrawal recovery, rollback, mutants and interruption.
  The browser campaign then stalled in Suite X's browser leg and was interrupted.
  The aggregate run is failed/interrupted, not fully green. Later browser lanes
  remain unqualified. The final `0431c12` change prevents scheduling another check
  after interruption; its single-signal probe passed.
- Real Google Chrome Send reached the unchanged watcher with matched input,
  payload and owner in the observed development runs. This proves TW, not actual
  agent-session receipt TS. Storage acknowledgement TQ is not instrumented;
  composer disappearance is only a UI acknowledgement upper bound.
- Intel timing runs had substantial competing load and small sample counts. Early
  paired markers were independently random; the current runner now seeds identical
  text/DOM inputs for each pair. Retain those older attempts as diagnostics and do
  not pool their timings with laptop results.
- Exact-revision remote CI, native real-Chrome recovery, actual host input receipt,
  complete mutation/coverage qualification and two-hour/24-hour campaigns were not
  established by the handoff. No adoption decision is supported yet.

The public text evidence retains failures, attempts, timings, source/build hashes
and synthetic identities. Machine/home/temp/toolchain prefixes are redacted, with
original/exported hashes in `evidence-export.json`. Binary artifacts are explicitly
omitted; rebuild on the target. Do not represent a sanitized export as the original
unmodified file bytes or a mapped scenario as an executed pass.

## Rebuild and execute locally

Use existing native Git, Node 22+, npm and Rust/Cargo. Install locked project/test
dependencies and a test-local Playwright browser as needed; do not run a general
system updater or alter ordinary browser/agent installations. Keep the same
PLAYWRIGHT_BROWSERS_PATH for all related browser commands. For example, from the
isolated worktree:

```sh
comparison_runtime=$(mktemp -d "${TMPDIR:-/tmp}/nudge-comparison-runtime.XXXXXX")
export PLAYWRIGHT_BROWSERS_PATH="$comparison_runtime/browsers"
export NUDGE_NO_RELOAD=1
npm ci --prefix bridge
npm ci --prefix test
(cd test && npx playwright install chromium)
node test/build-bridge-candidates.mjs
node test/bridge-checks.mjs --browsers
```

Record the runtime directory/environment and pass it into later tool invocations;
an export inside one short-lived shell does not configure a different shell.
`build-bridge-candidates.mjs` stages separate production and fault-feature binaries
and restores the production-feature executable. Use the matching build in each
lane. Do not measure fault-instrumented or coverage builds as production latency.

The required existing checks are:

```sh
npm run test:ci --prefix test
cargo test --locked --manifest-path bridge-rust/Cargo.toml
node test/run-portable-regression.mjs
node test/run-browser-regression.mjs --headless
node test/browser-parity.mjs --chromium --headless
node test/browser-coexistence.mjs --chromium-only --headless
```

They are included in the complete recorder where applicable. Keep browser suites
serial; start with Suite A. If a suite stalls, identify the actual operation and
apply a finite test/setup deadline with owned-process cleanup. Preserve its partial
output and fix clear technical defects. Do not skip Suite X, weaken expectations,
or count the old interrupted run as a laptop pass.

Run the common conformance, image, retention, malformed-header, browser-protocol,
realtime, crash-boundary, withdrawal and rollback cases against both candidates.
`NUDGE_CANDIDATE` is a JSON executable/argument array; see the runbook and recorder.
Keep the same expectations. For small fresh diagnostics after essential checks:

```sh
node test/chrome-delivery.mjs --browser chrome --samples 30
node test/bridge-compare.mjs --blocks 3 --samples 20
node test/bridge-resources.mjs
```

These current commands are development diagnostics. Larger sample arguments alone
are not full qualification. `--qualify` currently deliberately refuses; replace
that stub only with real prerequisite/evidence gating after implementing the
missing work, never remove it just to obtain a green result.

## Finish W1–W5 and supply W6

1. **W1 — validate the independent harness.** Reproduce a small real-browser Send
   through JavaScript to the unchanged watcher. Pre-register intentions outside
   the candidate store. Reject real deliberately lost, duplicate and misrouted
   candidates, missing/duplicate/empty samples, invalid clocks and stale bindings.
   Expected results must not come from the tested implementation. Verify exact
   store/build/process identity and finite owned cleanup.
2. **W2 — fresh laptop JavaScript baseline.** Verify JS0's bytes and run it with
   its own original extension, watcher and configuration in isolated resources.
   Do not label an old bridge plus the new extension as the original JS0 baseline.
   Record every attempt and known deviation. Measure JS1 separately.
3. **W3 — complete shared reliability protection.** Reproduce retained red/green
   socket and withdrawal regressions. Add missing meaningful unit/race/storage/
   transport/clock/recovery cases and complete effective mutation/coverage checks.
   Shared fixes must become an explicitly identified common comparison stage.
   Preserve process-crash vs OS/power-loss durability distinctions.
4. **W4 — independently qualify Rust.** Inspect its code and fixtures afresh. Before
   wider comparison, write independent tests for equal-`since` owner tie-breaking
   and ECMAScript-compatible numeric/Unicode/object-key receipt canonicalization,
   including JS→Rust→JS retries. These are review concerns, not established failing
   tests or accepted implementation behavior. Check old receipts/readers, images,
   source-bound evidence, legacy refusals, native launch/framing and rollback.
   Fix defects without adapting expectations to the candidate.
5. **W5 — same-condition paired comparison.** Complete the mapped 115 scenarios or
   name the precise unavailable prerequisites. A missing driver is unfinished work,
   not a passed case. Freeze source/build/config/fixture/policy identities before
   candidate qualification. Use identical logical inputs, shared extension/watcher
   versions, storage guarantees, deadlines and seeded schedules. Finish the real
   Chrome/native/OS/host lanes available on this machine. Distinguish whole process
   tree resources from bridge-only RSS. Run long campaigns only after essential
   conformance passes and with an explicit local resource/deadline/cleanup plan.
6. **W6 — decision.** Assess correctness, speed/recovery, resource use, installation,
   compatibility, rollback and maintenance using the frozen policy. Rust must show
   practical benefit. Choose adopt Rust, retain JavaScript, or insufficient evidence.
   Do not merge, publish a release, deploy or replace the everyday bridge.

## Measurement and proof requirements

Use one harness monotonic clock for T0 (ready real input dispatch) to TW (exact
unchanged watcher output). Validate browser request identity, stored effect,
owner, source, DOM target and watcher receipt independently. Record TA separately;
implement a real TQ observation before claiming that boundary. Geometry preparation
must not become hidden delivery time; dispatch and observer overhead remain named.

TW is not TS. Actual opted-in host input needs a supported input receipt observer.
A generated answer alone is not that observer. Separate push idle/busy behavior,
pull's next authorized prompt and intentional waiting, and model scheduling.
Use only dedicated synthetic projects/sessions. Where actual host tests need a
provider, use existing subscription-backed CLI authentication; do not switch to
API-key billing or send real/private prompts. Missing supported observability is
unavailable TS proof, not watcher-based automatic-wake proof.

Record all failures, timeouts, late results, scheduled-but-undispatched work and
retries. Report successful latency distributions alongside full attempt/deadline
success denominators. Use nearest-rank percentiles and tested reporting examples.
Include warmup/cold-start separation, offered load and queue waiting. Implement the
missing independent cadence scheduler and paired block uncertainty before calling
runs formal qualification. Five blocks of 2,000 sends per candidate, the declared
cadence, two-hour development soak and 24-hour-per-candidate qualification are the
frozen engineering policy, not current product promises or completed results.

Do not retune targets after seeing which candidate wins. A justified policy change
must be versioned, explained and invalidate affected eligibility; retain earlier
raw evidence. Do not infer quiet-host speed from shared CI, mix architectures/hosts,
claim natural worker suspension while debugging keeps it alive, or substitute a
harness restart for actual native self-heal. Do not power-cycle the workstation,
fill its real disk or interrupt everyday use to simulate power loss/sleep.

## Autonomy and final deliverables

Proceed with authorized local implementation, testing and recovery. Ask only for
an unresolved product decision or external prerequisite that truly blocks dependent
work; continue independent work. Do not seek permission repeatedly for the tests
already commissioned here. Use no blanket resets, cleans or unknown-process kills.

Deliver implementation and tests, a filled PR template, reproducible commands,
source/build/policy-bound raw events and logs, scenario-to-assertion/execution
coverage, important red/green regressions, and the reasoned W6 decision. Separate
local, remote CI, real Chrome, native/OS, actual-agent, independent review and human
acceptance evidence. State missing proof explicitly. A passing check covers its
cases; it does not make the whole 115-scenario catalog green.
