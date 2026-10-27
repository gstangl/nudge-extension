# Run the isolated bridge comparison

The [canonical requirements](specs/bridge-delivery.md) and
[frozen policy](../test/fixtures/bridge-comparison/policy.json) define the experiment.
The Rust executable is experimental and refuses the default bridge port. The
JavaScript bridge remains the installed default. None of these commands installs,
publishes, merges or changes an ordinary browser/agent profile.

From the repository root:

```sh
npm ci --prefix bridge
npm ci --prefix test
cargo test --locked --manifest-path bridge-rust/Cargo.toml
cargo build --locked --release --manifest-path bridge-rust/Cargo.toml
npm run test:ci --prefix test
node test/bridge-mutants.mjs
node test/build-bridge-candidates.mjs
node test/bridge-conformance.mjs
node test/bridge-image-conformance.mjs
node test/bridge-retention.mjs
```

Use the same commands/expectations with a candidate argument array:

```sh
export NUDGE_CANDIDATE='["./bridge-rust/target/release/nudge-bridge-experiment"]'
node test/bridge-conformance.mjs
node test/bridge-image-conformance.mjs
node test/bridge-retention.mjs
node test/browser-protocol.mjs
node test/bridge-boundary.mjs
node test/bridge-realtime.mjs
unset NUDGE_CANDIDATE
node test/bridge-rollback.mjs
node test/bridge-harness-interrupt.mjs
```

Only startup is parameterized in the three existing protocol suites; their
assertions remain unchanged. They use isolated resources and must run serially.
The existing [portable/browser runners](../CONTRIBUTING.md#tests) remain required.
Suite A runs first in the browser runner. Chromium, Chrome for Testing and actual
Google Chrome are separate lanes. Google Chrome is loaded through the documented
[DevTools extension API](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/#method-loadUnpacked)
in a throwaway profile, with native autostart disabled before the worker loads.

```sh
node test/chrome-delivery.mjs --browser chrome --samples 30
node test/chrome-delivery.mjs --browser chromium --headless --samples 10
node test/bridge-compare.mjs --blocks 3 --samples 20
node test/bridge-resources.mjs
```

Paired runs alternate candidate order from a fixed seed, use the same extension,
watcher and inputs, and retain every attempted input, failure and timeout. The
paired command performs essential external checks before timing. Results are
**diagnostic and inconclusive for adoption**; `--qualify` refuses while complete
catalog/coverage/mutation, native/host/OS and soak prerequisites are missing.
The complete local recorder is `node test/bridge-checks.mjs --browsers`; it
stages distinct fault/production bytes and runs all existing required runners
serially with source-bound logs. CI wiring is prepared separately and is not
remote CI evidence until that exact revision executes there.

Bridge-only RSS samples and direct HTTP timing do not establish whole-system cost
or Chrome-to-agent speed. Pull waiting and model scheduling remain separate.

Crash barriers use dedicated instrumented builds, never timing builds:

```sh
node test/bridge-commit-faults.mjs
node test/bridge-withdrawal-fault.mjs
cargo build --locked --release --features fault-hooks --manifest-path bridge-rust/Cargo.toml
NUDGE_CANDIDATE='["./bridge-rust/target/release/nudge-bridge-experiment"]' node test/bridge-commit-faults.mjs
NUDGE_CANDIDATE='["./bridge-rust/target/release/nudge-bridge-experiment"]' node test/bridge-withdrawal-fault.mjs
node test/bridge-withdrawal-fault.mjs
cargo build --locked --release --manifest-path bridge-rust/Cargo.toml
```

The final command restores the production-feature build. File writes/rename and
SIGKILL establish process-crash evidence on a functioning OS, not power-loss
safety. Deterministic pre-write/post-write/pre-rename/post-rename tests do not yet
cover all partial writes, withdrawal/evidence races, sync/ENOSPC simulations or
production random-kill schedules.

Evidence is retained under `artifacts/bridge-comparison/` and the existing
`artifacts/safari/` runner directories. Source manifests include hashes of tracked
and relevant untracked files; candidate executable bytes are bound separately in
Chrome/retention reports. Earlier failed setup runs and red regressions remain.
The [catalog](../test/fixtures/bridge-comparison/catalog.json) maps all 115 IDs to
specific assertions or explicit missing drivers/platform/host prerequisites;
a mapped or partially exercised case is never automatically passed.

JS0 is the reviewed handoff snapshot. JS1 adds the shared retired-socket callback fix in extension 0.35.2 and the
atomic withdrawal journal/recovery in bridge 0.20.1; both candidates use JS1 extension bytes for paired runs.
No shared journal/extension improvement, queue deadline, storage durability or
watcher change is credited to Rust. Rust still leaves the CLI/hook/watcher dependent on Node.
