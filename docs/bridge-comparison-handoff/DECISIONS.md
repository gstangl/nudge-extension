> Historical decision inventory. The current frozen engineering policy is [policy.json](../../test/fixtures/bridge-comparison/policy.json); current execution limits are in [EXECUTION.md](EXECUTION.md).

# Policy and decision record

This record distinguishes settled owner intent from the planner's proposed
measurement policy. It does not fabricate approval or create another approval
workflow. The implementing agent should record real decisions in the eventual
canonical specification/policy and retain their provenance.

## Settled scope

| Topic | Direction | Authority / consequence |
|---|---|---|
| Deliverable of this handoff | Plan, protocols and independently usable context; coding is delegated to another session | Owner's current request |
| Primary priorities | Chrome-to-agent speed, connection recovery/robustness, strong unit testing | Owner's planning request |
| Comparison | A common independent test system for JavaScript and Rust; no presumed winner | Owner's accepted comparison direction |
| Workflow principles | Observable intent before code, independent expectations, effective counterexamples, honest source-bound proof | Owner's Groundworks direction; sources linked in the canonical plan |
| Opt-in and scope | Preserve existing session fence, shared core and local boundary | Existing AGENTS.md and Vision |
| Compatibility | Preserve supported wire/store readers before language/storage redesign | Existing repository contribution rules |
| Packaging | Local ignored task package plus a portable export; preserve dirty source separately | Existing docs/plans convention and owner handoff request |

## Proposed experiment policy, not approved production promises

The canonical plan owns the numeric target table and adoption decision bands.
Do not keep an independently edited copy here. They include percentile latency,
fault detection/recovery, coverage floors, sample size and practical-gain margins.
The implementing agent should validate measurement feasibility with JavaScript,
then freeze the policy version/hash before qualifying Rust. Changing a target
after seeing the competing result invalidates that comparison.

Low-risk measurement details may be settled by the implementing agent under the
commission and recorded with their reasoning. New product promises require an
actual decision source; a measured implementation limit is not owner consent.

## Resolve before the indicated dependent claim

| ID | Decision / uncertainty | Work that can proceed now | Dependent work or claim |
|---|---|---|---|
| D01 | Does a storage acknowledgement promise process-crash survival only, or OS/power-loss durability too? | Process-kill cases, ledger, fault hooks and current behavior measurements | Matched storage policy/performance and power-loss acceptance |
| D02 | Can each selected real agent host expose an observable receipt boundary? | Browser-to-watcher measurement and synthetic integration sink | Actual-session latency/automatic-wake claim for that host |
| D03 | Which precise owner-selection rule governs browser-queued work before bridge commit, especially during owner switch/offline time? | Existing immutable owner and stable online routing cases | Concurrent ownership-change examples; do not silently invent a stricter policy |
| D04 | Are the proposed healthy latency and five-second recovery targets feasible and the right experiment targets? | JS0 exploratory measurement and instrumentation calibration | Predeclared comparison eligibility policy |
| D05 | Which exact client/store version range and OS/architecture matrix is supported for this release? | Source inventory and fixtures for currently documented support | Universal backward-compatibility/platform acceptance claim |
| D06 | Which exact restore behavior is required for irrecoverably corrupt disk contents? | Preserve corrupt originals, report current behavior, prevent false confirmations | Stronger recovery promises beyond preserved readable/acknowledged state |
| D07 | Can actual Chrome/native/OS lanes and long-run machines be provisioned without touching everyday state? | Chromium automation and isolated protocol tests | Real Chrome native self-heal, sleep and 24-hour qualification evidence |

Existing authoritative answers may settle these without another owner question.
Record the source instead of treating this table as a mandatory questionnaire.
If facts or intent remain unresolved, keep the relevant claim unavailable or
draft. Do not block unrelated implementation or silently count missing proof as
passed. A retained JavaScript result is a legitimate outcome of the experiment.

## Receipt of subsequent decisions

For each changed item record: ID; actual decision and source; date; affected
requirement/scenario IDs; policy/specification version/hash; invalidated results;
and the next check. Do not populate a decision on another person's behalf.
