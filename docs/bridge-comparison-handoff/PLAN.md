> Reviewed public copy of the original comparison plan. Its future-tense/status statements record planning scope, not current implementation evidence. Continue from [EXECUTION.md](EXECUTION.md).

---
id: bridge-comparison
status: proposed
date: 2026-10-27
scope: Bridge assurance, Chrome delivery latency and JavaScript/Rust comparison
---

# Bridge comparison and delivery assurance

Build one independent test system before replacing the JavaScript bridge. Run
the same product scenarios against JavaScript and Rust. Decide on measured
delivery, recovery and operational cost after both satisfy the same obligations.

This document is an implementation plan, not evidence that the proposed tests,
Rust bridge, numeric service levels or Groundworks registrations already exist.
The owner commissioned this plan and prioritized speed from Chrome to the agent,
connection robustness and strong unit testing. Numeric targets below are initial
engineering proposals; they must be frozen before candidate comparison, never
adjusted after seeing which implementation wins.

Fresh implementation session: start at the
[handoff package](EXECUTION.md). It includes executable-test
protocols to implement, the complete scenario index, independent design examples,
an unexecuted result template and source-bound existing-test evidence. No planning
conversation is required. The separate coding agent owns implementation and its
independent verification; this handoff does not preselect Rust as the outcome.

This file follows the existing local `docs/plans/` convention and is Git-ignored.
Promote accepted permanent requirements to their canonical specification during
implementation. Do not force-add private planning notes or copy them into a
second agent instruction file.

## 1. Scope and authoritative sources

- Nudge scope: [Vision](../VISION.md).
- Repository obligations: [AGENTS.md](../../AGENTS.md) and
  [Contributing](../../CONTRIBUTING.md).
- Existing checks and incident examples: [protocols](../../test/protocols.md)
  and [scenarios](../../test/scenarios.md). Map them; do not duplicate their rules.
- Groundworks sources inspected at revision
  `c238d44593a1ef1eda4c89d0cbf6aae734d0af89`:
  [specifications](https://github.com/gstangl/groundworks/blob/c238d44593a1ef1eda4c89d0cbf6aae734d0af89/kit/docs/groundworks/specifications.md),
  [behavior tests](https://github.com/gstangl/groundworks/blob/c238d44593a1ef1eda4c89d0cbf6aae734d0af89/kit/docs/groundworks/engineering-methods.md#test-observable-behavior),
  [contracts](https://github.com/gstangl/groundworks/blob/c238d44593a1ef1eda4c89d0cbf6aae734d0af89/kit/docs/groundworks/contracts.md),
  [verification](https://github.com/gstangl/groundworks/blob/c238d44593a1ef1eda4c89d0cbf6aae734d0af89/kit/docs/groundworks/verification.md),
  and [test execution](https://github.com/gstangl/groundworks/blob/c238d44593a1ef1eda4c89d0cbf6aae734d0af89/docs/groundworks/testing.md).

The extension remains plain JavaScript. Initial Rust parity preserves existing
HTTP/WS behavior and on-disk formats consumed directly by the CLI, hook and
watcher. Changing the database and porting the language are separate experiments.
No cloud, own agent, framework adapters or automatic session opt-in are added.
Chrome is the primary acceptance platform. Shared-core and Safari regressions
remain protected under [Safari's existing limits](../SAFARI.md); Chrome proof
does not establish Safari acceptance.

## 2. Groundworks principles applied to this feature

1. Define observable intended behavior and independent examples before code.
2. Separate authorized obligations, current observations, known deviations and
   proposed improvements. Existing behavior is not automatically intended.
3. Use one canonical clause per requirement, with stable requirement IDs.
4. Keep hard contracts scarce. Proposed groups are preservation of accepted
   submissions; session/source isolation including opt-in; compatibility with
   installed clients and their data. Ordinary checks cover the other behavior.
5. For every essential check, demonstrate a plausible wrong result it rejects.
6. Prefer a cheap behavior test when sufficient. Keep real-process, real-browser,
   real-OS and actual-agent evidence where substitutes cannot prove the outcome.
7. Bind results to source, test policy, configuration, fixtures and build bytes.
   Preserve failures and retries. Changed candidates require fresh evidence.
8. Keep local checks, exact-revision CI, independent review, real Chrome and human
   acceptance separate. A missing prerequisite is unavailable proof, never a pass.

During implementation add a bounded `bridge-delivery` feature mapping and
registered checks using Groundworks' current supported schema. Select only the
needed project adoption files; preserve this repository's sole AGENTS.md. Do not
install the entire framework or invent a new release-approval requirement as a
side effect of preparing this plan. Groundworks commands become usable only
after that wiring exists. Native Rust tests remain registered command checks;
do not assume Groundworks' interpreter method adapter directly supports Rust.

## 3. Current observations and gaps

| Observation from source inspection | Consequence for the plan |
|---|---|
| Bridge and watcher are Node ES modules; extension is plain JavaScript | Compare executable implementations behind the existing interfaces |
| Existing suites directly spawn `bridge/bridge.mjs` | Introduce one command/argument adapter; retain implementation-specific unit tests |
| Store mutations synchronously serialize and replace JSON | Measure history size and slow storage; preserve current readers before storage redesign |
| WS ping interval defaults to 30 seconds; reconnect delays start at 3 and cap at 8 seconds | Measure failure detection independently from reconnect delay; tighter goals affect both candidates |
| Watcher uses WS, filesystem events and a polling fallback | Measure each path separately and verify deduplication across paths |
| `test/latency-bench.mjs` sends 12 direct HTTP requests and reports median/max | It does not measure the Chrome Send action or actual session receipt |
| That benchmark checks legacy `identity.workspace`, lacks an explicit agent ID and filters failed samples from its latency summary | Repair the measurement setup before using it as evidence; never drop timeouts |
| Brutal D8 kills after an acknowledged POST, despite its mid-traffic description | Add deterministic failures at commit boundaries and ambiguous acknowledgements |
| Queue, store, lease, evidence and opt-in already have useful unit/integration checks | Reuse their meaningful assertions; map exact cases before claiming completeness |
| CLI and hook read store files directly | HTTP parity alone is insufficient for migration |
| The checkout contains unrelated modified and untracked work | Freeze exact contents for a baseline; HEAD alone does not identify this tree |

Local check performed while preparing this plan: `cd test && npm run test:ci`
passed on 2026-10-27 with Node 26.12.0 / npm 12.2.1: 16 unit files, 240 unit
tests, runtime-neutral integration and setup checks. This is exploratory proof
for the then-current dirty working tree, not a clean comparison baseline, CI
qualification, performance measurement or execution of the catalog below.

## 4. Requirements and independent examples to establish first

The IDs below are proposed stable IDs for the future canonical specification.
Preserve the underlying existing obligations by linking their current authority.
Keep improved numeric targets draft until the baseline/target policy is frozen.

| ID | Observable requirement | Independent example / rejected counterexample |
|---|---|---|
| BR-01 | A confirmed bridge acceptance survives bridge process restart | Confirm submission A, terminate bridge, restart, read A; an empty store fails |
| BR-02 | A stable submission identity denotes one stored submission within the supported retry horizon | Deliver A, lose its response, retry A: one ID; a second record fails |
| BR-03 | Conflicting content under an existing submission ID cannot overwrite or create work | Retry A with changed text/image: explicit conflict, original intact |
| BR-04 | Accepted browser work stays recoverable and preserves the queue's defined order | Queue A/B/C offline, recover: A/B/C; removing B or delivering C first fails |
| BR-05 | Session opt-in, host routing and immutable ownership prevent cross-session work | Session A owns host A, session B owns host B; either receiving the other's implicit work fails |
| BR-06 | Reported bridge connectivity, agent liveness and wake capability match observable state within declared deadlines | Stop a watcher; stale green after its deadline or pull shown as push fails |
| BR-07 | A transient interruption recovers without user resubmission while participants remain eligible | Interrupt transport, restore it, drain the same IDs; changing identity or losing work fails |
| BR-08 | Invalid clients and slow peers cannot crash or indefinitely block healthy clients | Malformed WS peer plus a healthy sender; crash or healthy starvation fails |
| BR-09 | Source-bound screenshots, selection and after-evidence belong to the intended document | Late old-document pixels after navigation cannot replace current evidence |
| BR-10 | Installed supported clients, watchers and stores remain usable or are refused safely before mutation | Open a legacy store, submit/retry/resolve, return to the old implementation; silent data loss fails |
| BR-11 | Delivery and recovery latency are measured at named external boundaries with all attempts counted | One deliberately dropped message appears as a failed/timed-out attempt, not a faster average |
| BR-12 | Start, stop and upgrade operate only on a positively identified owned instance | An unrelated listener on the requested port remains untouched |

Clarify BR-04 in the canonical spec: browser queue order is the durable acceptance
order within one extension installation. Independent profiles have independent
queues; no global order based on unsynchronized user click times is promised.
Concurrent HTTP commits must have unique monotonic IDs and an observable order.
Exactly-once storage effects do not promise exactly-once LLM execution or a
single watcher notification across watcher restarts. Record notifications and
replays separately instead of silently treating them as duplicate work.

## 5. Candidates and controlled comparison

| Candidate | Definition | Purpose |
|---|---|---|
| JS0 | Frozen current JavaScript source snapshot, including reviewed uncommitted changes | Establish present behavior, gaps and baseline cost |
| JS1 | JavaScript with the chosen reliability improvements, if improvements are made | Determine how much benefit comes from architecture |
| RS1 | Release-built Rust bridge implementing the same obligations and configuration as JS1, or JS0 if no JS1 is needed | Determine incremental benefit of the Rust implementation |

Freeze extension, watcher, CLI, fixture, durability policy, heartbeat deadlines,
compression and queue limits for each comparison pair. If extension improvements
are necessary, report JS0 with the old extension separately, then run both JS1 and
RS1 with the same improved extension. Do not attribute changed timeouts to Rust.

Run core bridge comparisons with the same external watcher and test launcher.
Then compare complete packaged lifecycles, including each candidate's native
launcher. Keep core and packaged results distinct. Porting only the bridge does
not make the remaining Node CLI/watcher independent of Node.

Each candidate gets its own cloned fixture/store, endpoint and process tree.
Never run two bridges against one writable store to compare them. Replay the
same seeded operation schedule against each separately. Compare stable semantic
results, not raw timestamps, PIDs, random tokens or JSON key order. Declare the
normalization allowlist; never normalize away owner, order, evidence, error
semantics, receipt identity or loss. Differential agreement supplements BR-01
through BR-12; two implementations agreeing on a bug still fail the reference.

## 6. Independent harness and measurement boundaries

Proposed components, not existing files:

| Component | Responsibility |
|---|---|
| Candidate adapter | Start an argument-array command, verify exact identity/store/build, await readiness, stop only its owned process tree |
| Scenario runner | Replay versioned inputs and seeded fault schedules against either candidate; enforce finite per-case deadlines |
| Reference ledger | Keep attempted, browser-accepted, bridge-confirmed, uncertain, withdrawn and observed submissions independently of bridge data |
| Transport fault proxy | Delay/drop HTTP replies, black-hole WS traffic, reset connections and throttle slow readers on isolated endpoints |
| Storage fault driver | Inject write/rename/sync errors and deterministic crashes at semantic commit boundaries in test builds only |
| Browser driver | Operate the real Nudge composer and Send button; retain UI states and document identity |
| Agent observer | Correlate exact submission/pin IDs at watcher output and, separately, at the actual session input boundary |
| Reporter | Preserve raw JSONL events, failures, all attempts, source identities, statistics and verdict scope |

Use synthetic input, not the live prompt store or private projects. Test hooks
cannot change production routing or acknowledgements. Report instrumented and
production-build runs separately. Calibrate observer overhead; disable tracing,
coverage, verbose console output and fault hooks for performance qualification.

### What "arrived at the agent" means

| Boundary | Observation | Interpretation |
|---|---|---|
| T0 | Harness monotonic timestamp immediately before dispatching a real Send interaction to a ready composer | Start of the externally observed Chrome action interval |
| TQ | Harness observes a successful browser queue acknowledgement | Browser accepted recoverable work, not bridge delivery |
| TA | Harness receives validated HTTP acceptance | Bridge acknowledged storage according to the declared durability policy |
| TW | Harness observes the exact submission at the real watcher output | Transport reached the agent-facing watcher |
| TS | Supported host records receipt of that same submission in the opted-in agent session input | Actual host/session handoff; separate runtime-specific evidence |
| TR | Harness observes a model response | Optional diagnostic including model scheduling; not a bridge-speed metric |

Primary bridge product metric: TW minus T0, including browser input dispatch,
queueing, storage and watcher delivery. Report TQ minus T0 and TA minus T0 too.
The harness uses one monotonic clock for these external observations. The browser
click event timestamp is a diagnostic with clock calibration and uncertainty;
do not subtract unrelated browser, bridge and OS clock origins. The T0 interval
includes automation and output-pipe overhead equally for both candidates; label
it explicitly rather than claiming nanosecond-accurate physical click latency.
Direct POST-to-watcher timing is a secondary bridge microbenchmark only.

TW is not TS. A push-capable host must demonstrate an actual receipt through its
supported host channel. A pull-only host intentionally waits for a later user
prompt: report queue-ready latency and prompt-to-context handoff separately, plus
the intentional waiting interval. A synthetic agent sink tests integration but
cannot stand in for observed delivery to a real coding-agent session. Missing
host observability leaves TS unverified. Do not infer autonomous wake from labels.

Recovery has three separate clocks: failure to truthful status; restored service
to first valid snapshot/delivery; and original interruption to completed recovery.
Record time spent deliberately offline separately. Observe real sleep/resume
boundaries externally; wall-clock changes must not produce negative latencies.
No software can keep a connection established while its machine is asleep.
The product obligation is honest state, preserved work and bounded recovery.

## 7. Proposed performance and recovery policy

These are starting targets for a foreground Chrome profile with a ready composer,
healthy loopback and ordinary writable local storage. They are not current claims.
Use baseline results to assess feasibility, then version the final policy before
testing RS1. Any later policy change invalidates earlier comparison eligibility.

| Metric | Proposed target | Qualification scope |
|---|---|---|
| Chrome action to watcher, normal ready-payload profile | p50 <= 50 ms; p95 <= 150 ms; p99 <= 300 ms | Foreground, warm, prepared text/DOM payload |
| Browser queue acknowledgement, healthy storage | p95 <= 100 ms | Distinguish acceptance from delivery |
| Ready screenshot payload delivery | p95 <= 500 ms | Valid 512 KiB screenshot fixture; capture already complete |
| Send requiring unfinished/failed capture | No hidden/lost prompt; separate latency distribution and capture deadline | Preserve existing capture behavior; do not mix with ready-payload samples |
| Fault detection and truthful offline status | <= 5 s | Foreground bridge/socket failure; new target compared with existing behavior |
| Restored healthy bridge to first confirmed queued delivery | <= 5 s | Eligible foreground client; not time spent offline |
| Cold native launch to validated healthy bridge | p95 <= 2 s | Supported installation and quiet reference host |
| Agent liveness expiration | Existing declared freshness/sweep bound | Preserve current contract until an explicit policy change is adopted |
| Accepted work loss / duplicate stored effects / cross-session deliveries | Zero observed in every qualifying run | Hard failure, never averaged away |
| Long-run resource use | No unbounded queue, socket, descriptor, process or memory growth | Evaluate trend after warmup and drainage; report allocator high-water behavior |

Report separate profiles for payload sizes and imposed faults. Injected 500 ms
storage latency cannot be judged against the healthy 150 ms bound. Background
tabs, frozen tabs and sleeping hosts need their own observed wake boundaries.
Absence of measured failures is bounded evidence, not universal reliability.

## 8. Unit-test design and quality controls

Keep Vitest for JavaScript and native `cargo test --locked` for Rust. Shared
reference fixtures define observable inputs/expected results; neither candidate
generates its own expected answers. Rust's Rust-only module tests do not replace
the shared external conformance suite. Keep real filesystem/OS semantics in
integration tests rather than mocking them and claiming platform proof.

Use fake time and injected clocks/randomness for deterministic state transitions;
run explicit real-timer cases later. Mock browser/storage/network boundaries, not
the queue, retry or ownership behavior under test. Refactor into cohesive modules
where that improves the runtime design; do not export every private helper merely
to test it. Assert effects and preserved state rather than internal call counts.

For critical delivery, retry, ownership and commit state machines require every
documented transition, guard and failure exit to have positive and negative cases.
Proposed numeric coverage floor for these instrumented modules: 95% branch and
95% line coverage, with no uncovered critical guard/failure path. List exclusions
with reasons; generated/vendor code is excluded explicitly. Coverage collection
tooling and thresholds are implementation tasks, not currently configured facts.

Add seeded property/state-machine tests with failure shrinking where practical.
Use a small independent ledger model: generate submit/retry/disconnect/restart/
withdraw/switch/read schedules, then check uniqueness, conservation, immutability,
defined ordering and eventual progress after a bounded healthy suffix. Do not
derive expected owner normalization or receipt signatures by importing production
helpers into the model. Keep small reviewed examples that catch model mistakes.

Mutation checks must reject deliberate faults: omit enqueue persistence; clear
before delivery; acknowledge before commit; remove receipt persistence; accept
conflicting content; reset IDs; bypass opt-in; change owner on resolve; retain
stale green; ignore timeout; accept stale socket callbacks; mix old-document
evidence; strip an attempt from the report. All seeded essential mutants must
fail for the intended assertion. Review surviving generated mutants rather than
raising coverage with tautological assertions. Keep the original red result and
the corrected result; never update fixtures merely to match a candidate.

### Unit scenario catalog

All catalog entries are planned obligations. Existing similarly named tests are
starting coverage, not proof that every listed variant has already been executed.

| ID | Stimulus / boundary | Required assertion | Requirement |
|---|---|---|---|
| U01 | Successful queue enqueue; storage rejects or never answers | Persisted acceptance precedes transport; failure preserves the editable draft and returns a bounded outcome | BR-04 |
| U02 | Two submits while first delivery hangs | Both accepted payloads remain recoverable; acceptance does not wait behind network delivery | BR-04 |
| U03 | Concurrent submit/flush/discard calls | Defined FIFO, no lost update; discard serializes with in-flight delivery | BR-04 |
| U04 | HTTP success with missing/wrong ID, malformed JSON, 409, 500 or timeout | Only validated receipt removes an entry; ambiguous outcomes retain original payload | BR-02 |
| U05 | Worker restart after queue acceptance or bridge commit | Same submission ID, creation time, text and image replay; no new work identity | BR-02 |
| U06 | Queue at capacity-1, capacity, capacity+1 | Existing work retained; overflow refused explicitly; no evicted prompt | BR-04 |
| U07 | Receipt/retry horizon and clock allowance: just before, at, just after boundary | Frozen policy's exact inclusivity; expired/unknown-age work not silently resent as new | BR-02 |
| U08 | Unsupported/corrupt queue schema or uncertain legacy payload | Original data preserved; explicit pending/error state; later work not silently bypassed | BR-04 |
| U09 | Same submission ID with equivalent/reordered fields versus changed text/image/console | Equivalent replay returns original effect; material changes conflict | BR-03 |
| U10 | Store mutation fails at write/rename/sync, followed by retry | No success from uncommitted in-memory state; original committed view remains authoritative | BR-01 |
| U11 | Sequence after delete/prune/corrupt-store recovery and label wrapping | Persistent IDs never reused; UI labels remain display-only | BR-01 |
| U12 | Owner/session changes before/after submit and resolve | Server chooses/stamps owner according to the canonical acceptance rule; later actions do not relabel owned work | BR-05 |
| U13 | Foreign/unarmed/malformed session plus bridge unavailable | No automatic watcher activation or implicit hook context leakage | BR-05 |
| U14 | Freshness expiration, delayed heartbeat and watcher replacement | Correct liveness, stable session identity and no false push capability | BR-06 |
| U15 | Retry delay growth/reset/cap; close/error/focus at the same instant | One eligible connection attempt; bounded retry; no orphan timer loop | BR-07 |
| U16 | Old socket fires close/error/message after a replacement opens | Stale callbacks cannot close or update the current connection | BR-07 |
| U17 | Abort fires before/during/after response; late callback arrives | One terminal result; no late duplicate mutation or unresolved promise | BR-08 |
| U18 | Foreign listener, timeout, malformed identity, wrong store/capability/version | Do not kill or replace unknown process; report bounded diagnostic | BR-12 |
| U19 | Lease holder alive/dead/EPERM/PID reuse/malformed/recovery guard | Fail conservatively; release only own lease; never create two writers | BR-12 |
| U20 | Host variants, exact ports, aliases, nested names, invalid credentials and route changes | Reviewed route examples select intended host without prefix/query-based matches | BR-05 |
| U21 | NaN/infinity/wrong types/deep structures/oversized tokens/UTF-8 splits | Bounded validation, correct rejection and no partial mutation | BR-08 |
| U22 | Navigation, worker restart and late capture from retired document | Source/generation checks prevent stale or foreign evidence | BR-09 |
| U23 | Wall clock jumps forward/backward around liveness/retry/retention | Durations use appropriate clocks; no accidental huge retry or premature data removal | BR-06 |
| U24 | Malformed, empty, duplicate or missing benchmark cases; altered normalization | Comparison fails explicitly instead of reporting success | BR-11 |

## 9. Shared conformance, fault and product scenario catalog

Layers: `P` real-process protocol/storage; `B` real browser; `O` real OS/native;
`A` actual opted-in coding-agent session. Run JavaScript and Rust against identical
reference expectations. Browser cases also retain their lower-cost unit coverage.

### Protocol, persistence and ambiguity

| ID | Scenario | Required observation | Layer / requirement |
|---|---|---|---|
| P01 | Health and identity on startup/restart, including canonical store aliases | Correct app/capabilities/store; readiness only after usable state | P / BR-12 |
| P02 | Real HTTP submit/read/resolve/delete; WS hello and snapshots | Stable supported response semantics and matching persisted state | P / BR-10 |
| P03 | Drop the HTTP response after commit, then retry after reconnect | One persisted effect with original receipt; uncertain attempt remains visible | P / BR-02 |
| P04 | Disconnect before commit; retry same submission | Either no initial effect or the original effect; final convergence to one record | P / BR-02 |
| P05 | Kill at write-start, partial-write, pre-rename, post-rename, pre-reply and post-reply barriers | All confirmed submissions survive; unconfirmed submissions converge on retry | P / BR-01 |
| P06 | Kill during replay/withdrawal/retention, then replay original ID | No resurrection, ID reuse or receipt/pin mismatch | P / BR-02 |
| P07 | Many concurrent submits and duplicate-ID races | Unique IDs for distinct work; one effect per stable submission ID; defined commit order | P / BR-02 |
| P08 | Same ID with changed evidence/payload and JSON field permutations | Reviewed equivalence cases replay; conflicting cases fail without mutation | P / BR-03 |
| P09 | Unsupported methods, malformed/oversized/chunked body, lying content length | Bounded errors; healthy parallel request still completes | P / BR-08 |
| P10 | Body/header/WS limits at limit-1, limit, limit+1; invalid UTF-8 and binary frames | Exact boundary policy; only offending connection closes | P / BR-08 |
| P11 | Browser retry after bridge restart, worker restart and receipt pruning | Retry policy preserved, including legacy receipts and expired IDs | P+B / BR-02 |
| P12 | Historical invalid selection/annotation/store shape | Original corruption retained as evidence; explicit recovery/error semantics; no silent destructive rewrite | P / BR-10 |
| P13 | Filesystem write/rename/sync/permission/ENOSPC errors | No false confirmation; healthy recovery after fault removal; inspect committed data | P / BR-01 |
| P14 | Simulated OS crash or lost unsynced writes | Meets explicitly chosen durability level; kept separate from process-kill evidence | P+O / BR-01 |
| P15 | Shared reviewed operation sequences with JS and Rust, including errors | Same semantic state and required events after allowed normalization | P / BR-10 |

P05 uses the same semantic barriers in both implementations. Production-build
random kill campaigns supplement deterministic test-hook runs. P14 uses a bounded
fault filesystem/VM simulation; never fill or power-cycle the user's workstation.
First freeze whether acknowledgements promise process-crash or OS/power-loss
durability. A stronger policy must be implemented and measured in both candidates.
The distinction follows the separate I/O and crash simulations described by
[SQLite's testing documentation](https://www.sqlite.org/testing.html#anomaly_testing);
it is not a decision to migrate Nudge to SQLite.

### Connection recovery and availability

| ID | Scenario | Required observation | Layer / requirement |
|---|---|---|---|
| C01 | Bridge absent when watcher/browser starts; bridge comes up later | Automatic eligible registration and recovery, same queued IDs | P+B / BR-07 |
| C02 | Kill bridge with active tabs and queued submissions | Truthful status, bounded restart/reconnect and complete drainage | P+B+O / BR-06/07 |
| C03 | Freeze bridge without closing sockets | Detect non-progress; no false healthy state past declared bound; do not spawn a second writer | P+B / BR-06/12 |
| C04 | Black-hole WS frames while HTTP still works, and vice versa | Correct differentiated state and retained work; restored transport converges | P+B / BR-06/07 |
| C05 | TCP reset, graceful close, half-open request and slow response | Healthy peers progress; retries preserve exact identity | P+B / BR-08 |
| C06 | One client never reads snapshots; writer produces updates | Bounded buffering/backpressure; other clients remain responsive | P / BR-08 |
| C07 | All tabs reconnect together after an outage | No duplicate bridge, writer, watcher or reconnect storm; bounded resource use | P+B / BR-07 |
| C08 | Repeated flap: up/down during hello, snapshot, queue drain and resolve | Eventual stable recovery; no old socket callbacks corrupt new state | P+B / BR-07 |
| C09 | Disable WS watcher delivery; drop filesystem events; restore each | Poll fallback works; deduplication across paths; honest latency labels | P / BR-07 |
| C10 | Watcher exits, is replaced in the same session, or stops heartbeating | Correct roster/liveness expiration and current eligible ownership | P+B / BR-05/06 |
| C11 | Bridge up, no agent; agent joins/leaves/is pull-only | Reachable, listening and automatic wake remain distinct visible states | P+B / BR-06 |
| C12 | Foreground/background/frozen tab then return | Work remains; recovery measured from actual reactivation; no idle busy loop | B / BR-07 |
| C13 | Extension worker terminates during enqueue, POST, receipt removal and notification | Recoverable original state; no loss or duplicated stored effect | B / BR-02/04 |
| C14 | Browser closes/reopens with pending queue, including offline reopen | Queue restored and drains in its defined order without user resubmission | B+O / BR-04 |
| C15 | Actual machine sleep/resume with pending and idle work | Preserved state, truthful post-resume status and bounded eligible recovery | O+B / BR-06/07 |
| C16 | Clock changes and heavy CPU/storage contention during heartbeat/reconnect | No false owner reassignment, runaway timer or permanent stall | P+O / BR-06/08 |

### Routing, session and source isolation

| ID | Scenario | Required observation | Layer / requirement |
|---|---|---|---|
| R01 | Two projects, two opted-in sessions, many tabs | Only intended owner receives each implicit submission | P+B / BR-05 |
| R02 | Unarmed session/hook alongside an armed session | Unarmed session stays silent; cannot inherit another session's readiness | P+A / BR-05 |
| R03 | Owner switch during enqueue, before commit, after commit and during outage | Owner follows the canonical acceptance rule; original committed ownership remains immutable | P+B / BR-05 |
| R04 | Work accepted without a current owner; later owner appears | Explicit existing ownerless-work policy; no invented or foreign assignment | P+B / BR-05 |
| R05 | Re-arm same session; PID reuse; selected owner dies | Stable session selection; no stale identity takeover | P+B / BR-05 |
| R06 | Nested named localhost, exact ports, default port and IPv4 alias | No host-prefix/query confusion; route claim is correctly scoped | P+B / BR-05 |
| R07 | Portless worktrees start/stop/change ports on a shared proxy | Exact full-host binding, no cross-wake; DNS failure distinguished from bridge failure | P+B / BR-05 |
| R08 | Different Chrome profiles/windows use same route | Separate client identity and queues; no accidental source/evidence crossover | B / BR-09 |
| R09 | Resolve/delete from non-owner; owner switch after stored work | Original owner preserved; withdrawal reaches intended original recipient under existing rules | P+B / BR-05 |
| R10 | Reload/navigation/SPA route change while capture is in flight | Retired document cannot reclaim registration or replace current pixels | P+B / BR-09 |
| R11 | Foreign browser/tab submits another source's capture token | Rejected without changing source-bound evidence | P+B / BR-09 |
| R12 | Chrome and Safari share a bridge during Chrome acceptance | Shared protocol/source isolation maintained; Safari UI remains a separately scoped gate | P+B / BR-09/10 |

### Native lifecycle, boundary and compatibility

| ID | Scenario | Required observation | Layer / requirement |
|---|---|---|---|
| L01 | Concurrent native/CLI launch requests | One healthy writer; all successful callers observe the same compatible identity | P+O / BR-12 |
| L02 | Requested port owned by foreign/old/hung/malformed listener | No killing or takeover; clear error; existing data untouched | P+O / BR-12 |
| L03 | Two ports, same store; canonical symlink aliases | Second writer refused; no parallel mutation | P+O / BR-12 |
| L04 | Stale/ambiguous lease and interrupted recovery | Only provably dead ownership recovered; ambiguous state stays safe and diagnosable | P+O / BR-12 |
| L05 | Native host missing, wrong path, denied execution or unexpected stdout | Bounded accurate startup failure; framed protocol remains valid | P+O / BR-12 |
| L06 | Native input split/coalesced/oversized/truncated; launcher exits | Bounded parsing; bridge lifetime follows intended detached lifecycle | P+O / BR-08/12 |
| L07 | Chrome-only restart without any terminal or session hook assistance | Actual native self-heal demonstrated in an isolated real Chrome installation | O+B / BR-07 |
| L08 | Normal termination and forced abort during active requests | Owned resources cleaned or safely recoverable; foreign listeners untouched | P+O / BR-12 |
| L09 | Loopback/LAN, Host/Origin HTTP/WS admission matrix and traversal attempts | Preserve independent boundary restrictions and healthy peer progress | P / BR-08 |
| L10 | Uninstall/reinstall/relocate packaged candidate in paths containing spaces | Data preservation and executable identity checked; no dependency on source checkout | O / BR-10 |
| M01 | Supported legacy store/receipt fixtures, new candidate writes, legacy reader reads | CLI, hook and watcher keep interpreting data; no schema-only appearance of success | P / BR-10 |
| M02 | Existing extension with new bridge and new extension with supported old bridge | Capability negotiation or explicit safe refusal, never silent feature misuse | P+B / BR-10 |
| M03 | JS to Rust to JS using a cloned real-format store and pending queue | Submit/retry/resolve/withdraw and after-evidence survive rollback | P+B / BR-10 |
| M04 | Interrupt upgrade after staging, lease handoff and before readiness | Recoverable prior installation/data; never two writers | P+O / BR-10/12 |
| M05 | Native Rust launcher starts without Node available to that launcher | Bridge launch claim verified; Node-dependent watcher/CLI still reported separately | O / BR-12 |
| M06 | Intel and Apple Silicon package/runtime checks on supported macOS | Actual architecture-specific startup, native messaging, locks and recovery evidence | O+B / BR-10/12 |
| M07 | Existing supported Linux test/runtime lane; Windows status | Preserve tested Linux behavior; do not turn currently open Windows support into a claimed acceptance | P+O / BR-10 |
| M08 | Artifact lacks dependency/resource, is corrupted or incompatible | Failure before destructive mutation; actionable bounded diagnosis | O / BR-10 |

### Chrome and actual agent behavior

| ID | Scenario | Required observation | Layer / requirement |
|---|---|---|---|
| E01 | Real composer Send with text and prepared DOM context | T0/TQ/TA/TW recorded; one correct receipt and context | B / BR-01/11 |
| E02 | Ready screenshot, region/freeform/multi-element context | Correct payload/evidence delivered; size/capture costs separately labeled | B / BR-09/11 |
| E03 | Screenshot slow, rejected, never resolves or loses document eligibility | Existing capture grace/timeout behavior; usable draft and truthful evidence state | B / BR-04/09 |
| E04 | Double-click Send, repeated keyboard submit and late RPC answer | Same logical send is not duplicated; distinct intended sends remain distinct | B / BR-02 |
| E05 | Rapid-fire send with outstanding work and full queue boundary | Responsive composer; recoverable ordered work; explicit overflow | B / BR-04 |
| E06 | Reload extension/page during pending send and retry restoration | Exact original submission restored; no phantom delivered state | B / BR-02/04 |
| E07 | Off/on toolbar, native button/shortcut, menus and tab switch during outage | Existing interaction checks pass; status updates without reopening menus | B / BR-06 |
| E08 | Unchanged real watcher with synthetic opted-in session sink | Correct transport/hook/CLI integration; labeled as sink proof, not actual agent receipt | P / BR-05/11 |
| E09 | Supported actual push-capable agent host, idle and busy | Same submission observed at TS through supported channel; wake capability matches reality | B+A / BR-06/11 |
| E10 | Supported actual pull-only host, idle and busy | No false auto-wake; next authorized prompt gets correct scoped context; waiting time explicit | B+A / BR-05/11 |
| E11 | Actual host restart/re-arm with pending work and a withdrawal | No foreign delivery; unfinished work and stop signal surfaced under defined host semantics | B+A / BR-05/07 |
| E12 | Slow/unavailable model or host scheduling | Bridge TW remains separately measured; model delay not attributed to bridge | B+A / BR-11 |

Actual-agent qualification uses only a dedicated test project/session and harmless
synthetic prompts. It must observe supported input/receipt evidence, not infer it
from a generated answer. Do not arm the everyday session or send external messages
to obtain proof. A host without a reliable receipt surface stays explicitly
unverified at TS; bridge qualification can still report its narrower TW result.

### Workload, soak and harness validation

| ID | Scenario | Required observation | Layer / requirement |
|---|---|---|---|
| B01 | One foreground tab, one eligible watcher, small prepared payload | Baseline T0-to-TW distribution with every attempt counted | B / BR-11 |
| B02 | Five then 25 tabs; one then five sessions | Delivery/status tails and resource scaling; no source/routing errors | P+B / BR-05/11 |
| B03 | Empty, typical and large history fixtures | Measure serialization/read/broadcast costs and healthy peer latency | P+B / BR-08/11 |
| B04 | Text/DOM, 512 KiB screenshot, 2 MiB screenshot, maximum valid payload | Size-specific distributions; correct boundary behavior | P+B / BR-08/11 |
| B05 | Human cadence and controlled bursts with fixed offered load | Queue wait and end-to-end latency included; overload not hidden by waiting for each reply | P+B / BR-04/11 |
| B06 | Slow disk, CPU contention, delayed network and slow WS reader separately | Identify cause; preserve progress and retention; label fault duration | P+B / BR-08/11 |
| B07 | Cold bridge, warm bridge, worker idle restart and first send after resume | Startup/wake costs separated from steady-state latency | O+B / BR-07/11 |
| B08 | Two-hour development soak; 24-hour qualification soak | No accepted loss or cross-delivery; resource trends and every outage retained | P+B+O / BR-01/07 |
| B09 | Repeated deterministic restart/flap campaign plus seeded random schedules | Reproducible failures, final ledger reconciliation and finite recovery | P+B / BR-01/07 |
| B10 | Idle service, normal use and recovery storm resource sampling | Bridge and whole delivery process-tree RAM/CPU/wakeups reported separately | O / BR-11 |
| H01 | Substitute a deliberately wrong bridge that drops, duplicates or misroutes one submission | Harness fails the corresponding independent assertion | P / BR-01/02/05 |
| H02 | Lose one timed sample or omit a late result from output | Report fails/incomplete; timeout stays in denominator | P / BR-11 |
| H03 | Empty fixture, duplicate case ID or unknown expected field | Fail before qualifying execution; no empty green run | P / BR-11 |
| H04 | Point test at foreign listener or live default endpoint/store | Refuse before mutation; exact store/build identity verified | P / BR-12 |
| H05 | Change candidate/fixture/policy during or after a saved plan | Evidence marked stale/ineligible; old result retained | P / BR-11 |
| H06 | Interrupt runner or exceed deadline | Terminate owned children, preserve partial logs and fail/unavailable status; no global process cleanup | P+O / BR-12 |
| H07 | Inject unrealistic zero/negative timings or shifted clock origin | Reject invalid timing; retain diagnostic and mark sample invalid, not fast | P / BR-11 |
| H08 | Retry a failed suite; instrumentation overhead; background host load | All attempts visible; overhead/load recorded; no cherry-picked best result | P+O / BR-11 |

The matrix contains 115 named scenarios, including 24 unit scenarios. Each row
can expand into multiple boundary values, interruption points and candidate
executions; report that expansion explicitly rather than inflating the scenario
count. Map every scenario ID to its executable assertion or an explicit missing
prerequisite before claiming catalog completion.

This is the declared initial coverage boundary. Add reduced regressions for new
findings and version the catalog. A count of cases is not proof that every
possible application behavior or failure combination has been covered.

## 10. Browser lanes and measurement integrity

1. Run fast automated extension regressions in Playwright's packaged Chromium,
   persistent isolated profile, native startup disabled before worker load.
2. Use Chrome for Testing as a separately identified repeatable browser lane
   where installed; record exact binary/version and extension artifact hash.
3. Qualify actual installed Google Chrome in a dedicated disposable profile with
   the extension loaded by supported installation/UI. Exercise native self-heal,
   background idle, full browser restart and real OS sleep/resume there. Disable
   only test autostart until its own isolated native registration is ready; native
   lifecycle cases then enable the test launcher against its own side endpoint.

Native tests use a distinct test host name/manifest and staged extension identity
where platform registration is not confined to the disposable profile. Its helper
binds only the declared test endpoint/store. Never overwrite the ordinary native
host registration, install hooks into real agent homes or let an inherited Nudge
environment select a live identity/store. Record the staged bytes and any
test-only registration substitution equally for both candidate packages.

Do not assume `channel: 'chrome'` plus `--load-extension` works for branded Chrome.
[Playwright documents the removed sideload flags](https://playwright.dev/docs/chrome-extensions).
For an automation attachment use a non-default test user-data directory, as
[Chrome requires for remote debugging](https://developer.chrome.com/blog/remote-debugging-port).
Never attach to or modify the normal browsing profile to run this comparison.

An attached service-worker debugger or continuous evaluation may prevent natural
MV3 suspension. Keep worker DevTools/evaluation detached during idle/native cases,
verify actual worker termination, and use an external observer for the idle
interval. Forced worker termination is a separate case, not proof of natural
idle. Recheck the installed version's behavior against
[Chrome's lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
After resumption, distinguish an existing Playwright worker handle from observed
worker execution; do not rely only on a new serviceworker event.

## 11. Experiment protocol and statistical reporting

- Freeze a manifest of exact candidate bytes, JS lockfiles/runtime, Rust toolchain,
  Cargo.lock/build profile/features, extension/watcher/CLI, fixtures and test policy.
  A dirty exploratory tree needs a content snapshot, not just its Git HEAD.
- Record OS, architecture, CPU, power mode, storage, browser version, process
  sampling method and observable background load. Use representative Intel and
  Apple Silicon machines for architecture-specific claims; Linux CI is separate.
- Use the same storage medium and durability mode. Local temp directories are
  not automatically equivalent to the eventual installation's filesystem.
- Prepare history fixtures once from reviewed synthetic input: small (5 open,
  20 resolved), typical (10 open, 200 resolved), stress (20 open, 10,000 resolved).
  Keep retained timestamps within policy and pin image sizes/format/hash.
- Normal cadence: scheduled submissions every 2 seconds. Burst profiles: 10 sends
  over 2 seconds through one UI queue; protocol stress: 100 concurrent requests.
  Honor the supported queue capacity. Report overload as such, not a normal SLO.
- Use paired, alternating candidate blocks with a seeded randomized order, never
  parallel competitors on the same machine. Warm up separately, record cold
  cases, and reset fixtures between blocks; do not carry Rust's warmer store into
  a comparison against a cold JavaScript process.
- Qualification target for primary steady-state profile: at least five independent
  blocks of 2,000 sends per candidate (10,000 observations). Use smaller smoke
  runs during development, explicitly insufficient for a p99 qualification claim.
  Secondary profiles start at five blocks of 200 observations; raise sample size
  or report tails as inconclusive instead of extrapolating unsupported p99 values.
- Schedule offered load independently of prior request completion where the
  scenario permits. Record scheduled, dispatched, queued, confirmed and observed
  times; never hide backlog by starting a clock only after the queue drains.
- Report attempts, acceptance, uncertainty, successes, failures, timeouts,
  withdrawals, duplicates, cross-deliveries and incomplete cases. Publish p50,
  p95, p99, maximum and empirical distributions for successful deliveries alongside
  deadline success rates across all attempts. Never discard timeouts to improve
  latency. Outages and diagnostic-invalid samples keep their reasons and counts.
- Report paired per-block differences and an uncertainty interval using the block
  as the sampling unit. Preserve serial correlation; one long process run is not
  thousands of independent reliability trials. Do not claim equivalence solely
  from an insignificant difference or absence of observed failures.
- Freeze percentile convention, interval construction and comparison formulas in
  the reporter policy. Test them against small hand-worked ordered samples and
  deliberate censoring/timeouts before using them to choose a candidate.
- Run the two-hour soak before the 24-hour comparison qualification. Keep the
  browser/watcher attached only as required, use controlled traffic, schedule
  deterministic faults, record naturally occurring faults and reconcile the
  independent ledger after every recovery and at the end.
- A known host prerequisite failure may require a new run. Preserve the failed
  attempt and explanation; automatic retries never turn intermittent defects into
  an unqualified green result.

Keep execution bounded: run one small vertical slice, then the fast catalog,
then paired performance blocks, then the long soak. Do not spend a 24-hour soak
on a candidate already failing essential conformance. At the proposed 2-second
cadence, 10,000 primary samples take about 5.6 hours per candidate before other
profiles; two sequential 24-hour soaks take another 48 hours. Plan machine time
explicitly and reuse the frozen JS0 diagnostic snapshot, while qualification of
changed candidates remains fresh. This planning task does not start those runs.

## 12. Execution packages and completion evidence

Paths and command options in this table are proposed deliverables, not commands
that exist today. Introduce the smallest end-to-end slice per package.

| Package | Work and dependencies | Completion evidence |
|---|---|---|
| W0: plan | This document; inspect sources and run existing fast gate | Plan delivered; current local evidence and gaps stated |
| W1: requirements and harness | Canonical `docs/specs/bridge-delivery.md`, reviewed examples, case IDs, candidate adapter, isolated ledger/reporter, minimal Groundworks mapping | One real JS send passes; a deliberately dropped/duplicated/misrouted send fails; no Rust needed |
| W2: JS baseline | Freeze JS0; parameterize relevant existing suites; extend latency measurement to real UI; record current deviations | Exact snapshot, all selected test outputs, initial Chrome-to-watcher and runtime handoff evidence |
| W3: reliability and unit protection | Add important missing boundary/race/fault cases; implement justified JS/extension fixes as JS1; freeze target policy | Red/green regressions, coverage and seeded mutation results; JS1 fault/Chrome runs; no promise inferred from test count |
| W4: Rust vertical slice and parity | Release Rust implementation: identity + submit + persistence + replay + WS, then remaining surfaces; same store/readers first | Shared BR/case suite passes without weakening fixtures; Rust module/property tests; old clients/readers work |
| W5: full comparison | Core and packaged comparisons, complete selected catalog, real Chrome/native/OS and actual host lanes, 24-hour soak | Raw paired results, source-bound reports, migration/rollback artifacts, missing prerequisites explicit |
| W6: decision and handoff | Assess correctness, speed, recovery, cost and maintenance; independent review of assumptions/results; prepare bounded PR if commissioned | Written adopt/retain/inconclusive decision; exact CI and browser scope named; no implicit merge/release |

W1 proves the harness on current JavaScript before W4 begins. W3 and W4 must not
hide a durability-policy difference. JS1 is optional if JS0 already satisfies the
chosen policy; do not optimize JavaScript for its own sake. W6 review can be a
separate reviewer session; do not claim independent review from self-review.

Suggested project additions during implementation:

```text
docs/specs/bridge-delivery.md       canonical requirements and reviewed examples
groundworks/specs.json             bounded feature and dependency mapping
groundworks/checks.mjs             ordinary checks, including existing gates
groundworks/contracts.mjs          only justified essential obligations
groundworks/gates.json             explicit comparison/qualification consequences
test/fixtures/bridge-comparison/   reviewed inputs and independently expected state
test/support/bridge-candidate.mjs  executable adapter and exact-store ownership
test/support/delivery-ledger.mjs   independent ledger and reconciliation
test/bridge-conformance.mjs        shared black-box reference cases
test/bridge-faults.mjs             transport/storage/commit-boundary campaigns
test/chrome-delivery.mjs           real composer input and watcher/session receipt
test/bridge-compare.mjs            paired runs, raw events, report and verdict
test/unit/                        focused JS behavior/state-machine cases
bridge-rust/                      proposed Rust crate, locked deps and native tests
```

Use the existing suite names and runners where sufficient instead of creating
parallel duplicates. Add a task-specific reporter without moving product intent
into generated evidence. Groundworks evidence goes in its existing ignored
directory after adoption; until then use a task-owned temporary evidence root.
Do not claim a test command exists until its executable is committed and run.

## 13. Gates, CI and decision rule

Suggested targets after the harness exists:

| Target | Cadence and scope | Required evidence |
|---|---|---|
| Fast development | Each relevant change | Existing `npm run test:ci`, focused JS units, Rust units when present, small shared reference set |
| Candidate conformance | Each bridge/protocol/store change | Shared protocol, boundary, lifecycle, routing and fault checks against both candidates |
| Browser regression | Each extension/bridge change | Suite A first, affected suites from protocols and existing serial browser runner; explicit native-disabled fixtures |
| Comparison qualification | Explicit long run / proposed overnight target | Pinned paired performance blocks, full mapped scenarios, seeded faults, 24-hour soak, real Chrome and declared actual host evidence |
| Migration qualification | Before replacing installed bridge | Old/new clients, direct readers, native lifecycle, architecture-specific package, upgrade and rollback |

Register ordinary Rust builds/tests as command harnesses and keep all existing
required checks selected. Preserve existing serial runner barriers: current
suites reuse side ports and browser focus. Only explicitly isolated checks may
later declare parallel execution. No schedule is created by this plan.

Existing CI must continue to qualify the exact candidate; extend its matrix to
the implementations and required Rust toolchain as they become available. Put
long soaks and stable-host performance in an explicit separate lane. Shared CI
runner timing is diagnostic, not a quiet-host microbenchmark. Store logs on
failure as well as success; a timeout kills only the test-owned process group.

Adoption decision, in this order:

1. No candidate with observed accepted-work loss, duplicate stored effects,
   opt-in/source/owner leakage, false confirmations or unsafe compatibility is
   eligible. Diagnose a faulty test as such; never weaken an independent
   expectation merely to pass the candidate.
2. Both candidates must satisfy the frozen common correctness and recovery policy.
   If neither does, repair the shared design before choosing a language.
3. Rust must not materially regress normal delivery tails or recovery. Proposed
   non-inferiority margin: 10% or 20 ms, whichever is larger, for healthy latency;
   recovery margin: 10% or 250 ms, whichever is larger. Evaluate paired uncertainty;
   an interval crossing the bound yields inconclusive evidence, not equality.
4. Require a practical gain, not only a tiny numeric win. Initial decision bands:
   at least 20% and 20 ms improvement in primary p95, or 30% improvement in a
   dominant measured resource/recovery cost, or demonstrated removal of a real
   installation failure class. Declare the chosen primary benefit before RS1
   qualification; retain all competing metrics and implementation cost.
5. If JS1 meets the goals and Rust adds little benefit, retain JavaScript. If Rust
   meets the same obligations and yields a material operational benefit, prepare
   its adoption. If real Chrome/host/OS evidence or statistical precision is
   missing, report the exact narrower result and leave adoption undecided.

These decision bands are proposals for the comparison policy, not new approved
production promises. Installing Rust on the everyday bridge, publishing, merging
and changing the supported platform matrix remain outside this planning task.

## 14. Evidence report and handoff

Each report must name: candidate/build hashes and tree state; requirement and
scenario IDs; expected vs observed outcome; source/fixture/policy hashes; real
browser identity; watcher/agent wake mode and receipt boundary; command/runtime;
timestamps/durations; attempts/fault schedule/seed; stdout/stderr; timeout/signal;
process ownership/cleanup; raw latency events; resource samples; migrations; and
which local/CI/Chrome/native/host/independent/human dimensions were actually checked.

Required verdicts: passed, failed, unavailable, not-run, stale or inconclusive.
A skipped required lane is not passed. Include the sample denominator and a
reviewable reconciliation of every accepted submission. Explain any surviving
test mutant or omitted scenario. Retain historical failed attempts and source-
bound reruns without overwriting earlier results.

The first implementation deliverable is W1 plus W2: an independently checked
reference suite and a reproducible present-day JavaScript measurement from the
Chrome Send interaction to the watcher, with actual-session handoff shown as a
separate observation. That supplies the evidence against which to build Rust.
