> Public task reference derived from the planning handoff. Procedures describe expected execution; they are not pass evidence. Current implementation/run status is in [EXECUTION.md](EXECUTION.md).

# Bridge comparison test protocols

Protocol version: 1. These are execution specifications for a future harness,
not a claim that new commands already exist. Scenario expectations remain in
the [original comparison plan](PLAN.md); the derived
[115-case catalog](../../test/fixtures/bridge-comparison/catalog.json) maps all 115 cases to these protocols.

Each executed case records: scenario and requirement IDs, setup/fixture hash,
candidate/build hash, command/runtime, expected and observed result, fault/seed,
timestamps, all attempts, timeout/signal, logs, final ledger and cleanup. Use the
[result template](result-template.json). Every planned case starts `not-run`.

## TP-00: subject, isolation and harness self-check

Applies before every lane and directly to H01-H08.

1. Check the package/plan hashes, candidate source identity and fixture/policy
   identity. Distinguish the supplied dirty-source snapshot from Git HEAD.
2. Allocate fresh stores, synthetic sessions and dedicated browser/native test
   resources. Establish port availability before starting existing fixed-port
   suites. Refuse an occupied endpoint; never evict its listener.
3. Start the candidate with an argument-array command. Check the exact canonical
   store, compatible app/capabilities and owned PID/build before mutation.
4. Record the reference ledger outside the bridge store. Pre-register every
   scheduled input and its identity. Do not reconstruct attempted work solely
   from the candidate's output.
5. Exercise negative controls: one lost record, duplicate stored effect, wrong
   owner, omitted timing, empty cases and stale source binding. Every control
   must fail its intended assertion; an unrelated setup error is insufficient.
6. Enforce finite setup/case/whole-run deadlines and process-tree ownership.
   Preserve partial output on timeout/interruption. Terminate owned children,
   await exit and verify resource cleanup. Never kill by a generic process name.

Pass: independent ledger controls catch the injected defects; source identity
and process ownership are unambiguous. Missing prerequisites are `unavailable`,
not a skip/pass. A failed essential self-check blocks comparison qualification.

## TP-01: deterministic unit and state-machine checks

Applies to U01-U24; supplement the P/C/R/L/E cases at their cheapest useful layer.

1. Derive independent expected examples from BR requirements and
   REFERENCE-CASES.json. Review known deviations without copying them as intent.
2. Use Vitest for JavaScript and native Rust tests for Rust. The same reference
   data may drive each language; production code cannot generate expectations.
3. Substitute external time, storage, browser and network boundaries only. Keep
   the actual queue/receipt/routing/retry transitions under test.
4. For each relevant limit run below/at/above values. For each asynchronous action
   order completion, abort, error, retry and late callback both ways. Explicitly
   test callbacks from retired connection/document generations.
5. Use seeded operation sequences, a small independent state model and a bounded
   healthy suffix to check progress after faults. Keep shrinking/reproduction
   data and small hand-written examples that can catch a faulty model.
6. Execute essential seeded mutants named in plan section 8. Save the assertion
   proving failure, then the corrected case. Review equivalent/unreachable
   mutations explicitly; do not ignore meaningful surviving mutants.
7. Collect coverage separately from timing runs. The proposed critical-module
   coverage floor and all critical-branch requirements live in plan section 8.

Pass: required examples/guards/negative controls pass, meaningful mutants fail,
and uncovered critical behavior is absent. Branch percentages alone cannot pass
this protocol. OS/file atomicity remains TP-02/06 proof, not mocked unit proof.

## TP-02: shared real-process conformance and storage ambiguity

Applies to P01-P15, with L/R/M cross-checks as mapped.

1. Start each candidate separately on its own cloned synthetic store. Run the
   same reference inputs through its public HTTP/WS interfaces and unchanged
   supported readers. Unit assertions importing a JS private helper are not
   automatically portable black-box checks.
2. Verify stable response/effect semantics, receipts, owner/source fields,
   snapshots, supported errors and persisted state. Permit only the frozen
   normalization allowlist for inherently variable metadata.
3. Use the transport proxy to cut a request before storage and to discard a
   successful reply after storage. Retry the exact original ID/payload. Reconcile
   storage, receipts, browser queue and watcher observations independently.
4. In test builds pause at semantic barriers: write-start, partial write,
   pre-rename, post-rename, pre-reply, post-reply. Terminate only the candidate,
   restart it and retry uncertain work. Run every meaningful boundary against
   both implementations, including receipt/pin, withdrawal and retention races.
5. Repeat a production-build random-kill campaign with a recorded schedule.
   Label this separately from the deterministic hooked build.
6. Inject bounded write/rename/sync/permission/ENOSPC errors without exhausting
   the actual workstation. Disable the fault and verify both intact prior state
   and subsequent legitimate progress.
7. Test untrusted body/frame/input boundaries with a concurrent healthy peer.
   Assert its deadline and correct effect, not only candidate process liveness.

Pass: confirmed work is preserved under the declared durability class; uncertain
work converges on retry without duplicate stored effects; invalid traffic cannot
corrupt or starve healthy work. Process-kill results do not prove power-loss
durability. Keep TP-06 OS/fault-filesystem simulations separately labeled.

## TP-03: connection, watcher and truthful state recovery

Applies to C01-C16, plus U14-U17, E06 and L07.

1. Establish an eligible browser and real watcher, with a successful initial
   reference submission. Create pending work before each interruption.
2. Apply refused connections, graceful close, reset, bridge termination, frozen
   bridge, WS black-hole, HTTP-only interruption and slow-reader backpressure
   separately. Exercise interruption during hello, enqueue, commit, reply and
   queue drainage. Then restore a bounded healthy interval.
3. Record failure-to-truthful-status time, time deliberately offline, restored-
   service-to-first-valid-snapshot time and restored-service-to-delivery time.
   Do not start recovery timing only after an internal reconnect already succeeds.
4. Repeat with simultaneous tabs, flapping service, stale callbacks, replacement
   watcher and missed filesystem events. Verify WS/watch/poll deduplication and
   independently measure each fallback path.
5. Force worker termination at durable queue boundaries. Separately run natural
   background/idle behavior with worker debuggers detached under TP-05.
6. Reconcile every accepted, uncertain, withdrawn and delivered item after each
   recovery; observe socket/descriptor/process/queue counts and resource bounds.

Pass: frozen policy's deadlines and identity/order obligations hold; no permanent
stall, false healthy status or duplicate writer. Sleeping/frozen clients have a
separately observed reactivation boundary rather than an impossible always-live
connection promise. A host deliberately offline is visible, not omitted.

## TP-04: routing, owner, opt-in and browser-source isolation

Applies to R01-R12 and relevant U/E cases.

1. Use two synthetic projects, hosts and explicitly opted-in sessions plus an
   unarmed session. Record routing/ownership expectations independently.
2. Submit from each eligible tab. Check both intended receipt and absence from
   foreign implicit work/context. Preserve explicitly supported named-reference
   behavior; do not invent a blanket ban beyond the product rules.
3. Switch/re-arm/expire owners around commits and outages only after D03's rule
   is settled. Check immutable original ownership on later resolve/withdraw.
4. Exercise exact ports, default-port aliases, nested localhost names and
   Portless worktree hosts on one proxy. Separate DNS/navigation prerequisites
   from HTTP/WS bridge results.
5. Use separate profiles/windows and source/document generations. Navigate or
   reload during capture; send delayed old evidence and forged source tokens.
6. Observe canonical state, snapshots, unchanged CLI/hook output, intended
   watcher and foreign watcher silence. Chrome/Safari source-coexistence proof
   remains distinct from Safari UI/native acceptance.

Pass: no unauthorized activation, cross-route delivery, owner drift or source
evidence contamination. A successful intended delivery alone cannot prove the
negative isolation assertion; the foreign channels must also be observed.

## TP-05: browser Send path and actual coding-agent handoff

Applies to E01-E12, the browser parts of C/R and B01-B07.

1. Stage and hash the test extension with native autostart disabled before worker
   load. Use persistent isolated Playwright Chromium for automated regression.
   Add separately identified Chrome for Testing and actual Google Chrome lanes.
2. For installed Google Chrome use supported loading/installation in a dedicated
   profile. Do not assume removed sideload flags still work. Use task-specific
   native registration for the native lane, never the ordinary live manifest.
3. Open a known synthetic local app, select the element, fill the real composer
   and wait for readiness. Record prepared-payload and unfinished-capture profiles
   separately. Dispatch an actual pointer/keyboard Send interaction.
4. Observe T0, TQ, TA and TW using the externally timed boundaries in plan section
   6. Match the exact submission/pin, not an incidental number in console output.
5. Test ready images, failed/throttled capture, double clicks, worker/page/extension
   reload, browser restart, queue overflow and menu/status updates during outage.
6. For actual-agent TS proof, use a dedicated harmless test project/session and
   the supported host receipt channel. Test idle/busy push and pull separately.
   A synthetic sink or watcher stdout proves only its labeled boundary.
7. For natural idle/native tests detach worker debugger/evaluation and verify
   actual suspension. Do not keep the worker alive by inspecting it repeatedly.

Pass: intended context reaches the observed boundary, UI state is truthful,
latency deadlines apply to their declared profile, all work reconciles. Report
TS as unverified if the real host cannot expose trustworthy receipt evidence.
Model generation time is diagnostic, not the bridge transport metric.

## TP-06: native lifecycle, OS and boundary protection

Applies to L01-L10, P14, C15-C16 and architecture-specific M cases.

1. Validate bridge/store identity and owned process trees. Exercise concurrent
   launcher requests, canonical store aliases, stale/ambiguous leases and a
   foreign listener. No unknown process may be terminated or replaced.
2. Test framing, startup errors, denied execution, unexpected stdout, host exit
   and detached bridge lifetime using a test-only native host registration.
3. Close/reopen actual Chrome without terminal/session-hook assistance; terminate
   only the test bridge and demonstrate native recovery. A test driver respawn
   is not proof that Chrome self-healed.
4. Run real OS sleep/resume externally with queued and idle states. Keep the
   normal browsing profile and everyday agent untouched.
5. If D01 includes OS/power-loss durability, use a separate fault filesystem/VM
   simulation for interrupted/lost/reordered unsynced writes. Never power-cycle
   the workstation or fill its real disk to obtain evidence.
6. Run Host/Origin HTTP/WS, loopback/LAN and traversal matrix. A missing required
   network interface is an unavailable check, not a verified bind restriction.
7. Record actual OS/CPU architecture and installation bytes. Intel, Apple Silicon,
   Linux CI and unverified platforms remain separate evidence subjects.

Pass: only owned instances are changed, framing/lease/lifecycle guarantees hold,
native recovery is actually observed and the declared durability class is met.

## TP-07: installed-client compatibility, packaging and rollback

Applies to M01-M08, L10 and relevant P/E cases.

1. Declare the supported version/platform range and produce reviewed synthetic
   fixtures for its store/receipts/wire contracts. Keep copies pristine.
2. Read and mutate each clone with supported old/new extensions, bridge versions,
   CLI, hooks and watchers. Check contents, not just successful startup/version.
3. Exercise JS-to-Rust-to-JS with pending, committed, uncertain, withdrawn and
   source-bound evidence work. Check original IDs/receipts and direct readers.
4. Interrupt installation and handoff at semantic boundaries; verify either
   prior usable state or explicit recoverable refusal, never concurrent writers.
5. Relocate the staged package to a path with spaces, remove source-checkout
   availability, and test missing/corrupt resources. For the Rust launcher only,
   test absence of Node without claiming remaining Node readers are native.

Pass: supported prior data/readers remain usable or the operation refuses safely
before mutation; rollback is demonstrated. A checksum or package build alone is
not installation, native host or user acceptance proof.

## TP-08: paired latency and resource experiment

Applies to B01-B07, B10 and measurement portions of E/C.

1. Freeze candidate bytes, common extension/watcher, datasets, policy/normalization,
   durability mode, timeouts, browser binary, host load and sampling tool.
2. Validate the reporter with independent small examples before measuring. Use
   one monotonic observation clock; retain input dispatch and pipe overhead.
3. Run paired alternating blocks, seeded order, never competing candidates in
   parallel on one host. Separate warmup, cold start and steady state. Reset
   fixtures between blocks on the same storage medium.
4. Use plan section 11's sample counts, cadences, history/payload profiles and
   primary measurement boundary. Record offered load and queue wait; avoid
   timing only requests whose predecessors have already completed.
5. Preserve all attempts and failure denominators. Report successful latency
   distributions alongside deadline success rates, uncertainty and failures.
6. Report bridge resources and the whole delivery process tree separately. Take
   idle, active, slow-storage and recovery-storm samples with low-overhead tools.

Pass: frozen correctness requirements and profile targets hold with adequate
precision. An uncertain non-inferiority interval is inconclusive; a tiny apparent
speedup is not automatically a meaningful benefit. Use plan section 13's proposed
decision policy only after its parameters have been frozen.

## TP-09: long-running resilience and resource bounds

Applies to B08-B09, supported connection fault combinations and late resource
growth. This protocol is long and not part of a fast unit gate.

1. Pass essential conformance before spending long-run machine time. Run a
   two-hour development soak, then a 24-hour qualification per candidate.
2. Use declared traffic, same initial fixtures and seeded scheduled failures.
   Record natural host interruptions instead of deleting them from the sample.
3. Reconcile the independent ledger after each recovery and at completion.
   Track queue size, sockets, descriptors, live processes, memory and CPU trend.
4. Examine post-warmup and post-drain behavior. Distinguish allocator high-water
   marks from unbounded growth; do not reject every retained allocation as a leak.
5. Keep worker inspection detached during natural-idle windows. Retain partial
   output and owned-process cleanup if the run is interrupted.

Pass: no accepted-work loss/cross-delivery/duplicate stored effect; automatic
progress after the healthy suffix; no unbounded resources. Shorter/incomplete
runs cannot be relabeled as completed 24-hour qualification.

## TP-10: existing regression and CI qualification

Existing executable commands, run from the repository root unless stated:

| Command | Actual current scope / prerequisites |
|---|---|
| `cd test && npm run test:ci` | JS unit, runtime and installer fast gate; verify its fixed side port is free |
| `node test/run-portable-regression.mjs` | Serial portable suites with retained logs; shared side ports; not parallel with browser runner |
| `node test/run-browser-regression.mjs --headless` | Serial Chromium suites, beginning with Suite A and native-disabled staged resources |
| `node test/browser-parity.mjs --chromium --headless` | Shared interaction/capture behavior in Chromium; not Safari acceptance |
| `node test/browser-coexistence.mjs --chromium-only --headless` | Existing explicitly Chromium-only multi-profile/worker cases |

Check [current protocols](../../test/protocols.md) before running: source or
commands may change after this handoff. Do not run the legacy latency benchmark
as comparative proof until W2 repairs the source-noted setup/measurement gaps.
New Rust/conformance/comparison commands are W1-W5 deliverables, not existing
commands that can be invoked from this document today.

Preserve required existing regression checks. Add candidate-specific CI only as
its code exists. Bind provider results to the exact revision/build and retain
failure artifacts. Shared CI timing is diagnostic rather than quiet-host
performance qualification. Local, CI, Chrome, native and agent proof stay distinct.

## TP-11: report, reconciliation and decision

1. Use RESULT-TEMPLATE.json with actual observed data, not copied pass labels.
2. Map every selected scenario to its assertion/artifact and requirement. The
   scenario index is planning coverage, not execution coverage.
3. Reconcile all accepted and uncertain input identities. Classify intended
   withdrawals, unexpected loss, duplicate effects and notification replays
   separately. Keep supported retries/expiration visible.
4. Include passed, failed, unavailable, not-run, stale and inconclusive subjects;
   record each attempt. Missing required lanes prevent a whole-catalog claim.
5. Apply the frozen common policy, then compare practical benefits. Report
   adopt-Rust, retain-JavaScript or inconclusive with evidence and maintenance/
   installation consequences. Do not turn the decision into deployment authority.

Pass: the report's claim matches its actual source/runtime/browser/host scope,
contains a complete selected-case accounting and survives negative controls.

## TP-12: package and fresh-context readiness

1. Check SHA256SUMS and PACKAGE-MANIFEST.json in an extracted temporary directory.
2. Verify the scenario index has exactly the canonical plan's 115 unique IDs,
   all 12 requirement IDs resolve, every protocol resolves and all execution
   statuses remain not-run until actual runs are attached.
3. Verify baseline archive entries/bytes match source-manifest.json, the tracked
   patch is separate from untracked source and no live state/dependencies/generated
   native wrapper were included.
4. Verify reference cases contain explicit independent expected outcomes, do not
   call production code, and mark unresolved policy dependencies explicitly.
5. Verify the result example is visibly unexecuted and cannot be mistaken for a
   real passing record. A fresh session must have enough context to start W1
   without reading the planning conversation.

Historical planning scope: this was the packaging protocol executed before implementation. The separately
recorded fast-gate command is existing test execution, not completion of TP-01
through TP-11 against Rust or the future harness.
