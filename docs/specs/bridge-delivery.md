# Bridge delivery comparison

The comparison preserves [product behavior](../PRODUCT.md) and the
[repository test obligations](../../CONTRIBUTING.md). Rust is experimental until
it meets the same independently expected behavior as JavaScript and demonstrates
an operational benefit. There is no installation or release decision here.

## Observable obligations

| ID | Obligation |
|---|---|
| BR-01 | Confirmed acceptance survives bridge-process restart on a functioning filesystem. |
| BR-02 | A stable submission identity has one stored effect through the supported retry horizon. |
| BR-03 | Conflicting content under that identity is explicitly refused without replacing original work. |
| BR-04 | Browser-accepted work remains recoverable in durable acceptance order within one installation. |
| BR-05 | Preserve opt-in, host routing and immutable committed ownership. |
| BR-06 | Distinguish reachable bridge, fresh watcher and actual push capability truthfully. |
| BR-07 | Eligible participants automatically recover transient transport/process interruptions using original identities. |
| BR-08 | Malformed and slow peers cannot crash or indefinitely starve healthy clients. |
| BR-09 | Selection and evidence remain bound to their browser, tab, document, route and mark generation. |
| BR-10 | Preserve wire/file compatibility and direct CLI/hook/watcher readers; refuse unsafe changes before mutation. |
| BR-11 | Measure named boundaries with independent expectations and every attempt retained. |
| BR-12 | Start/stop/upgrade affect only positively identified owned instances. |

The [reference examples](../../test/fixtures/bridge-comparison/reference-cases.json)
are reviewed independent event timelines. They are not expected-result functions
imported from either candidate. RC01–RC12 remain bounded by their explicit policy
dependencies. In particular, a stored effect is distinct from a watcher wake and
from an actual agent input. Exact-once model execution is not promised.

## Experiment boundaries

The [frozen experiment policy](../../test/fixtures/bridge-comparison/policy.json)
is an engineering comparison policy, not a new product service-level promise.
Its hash must be retained before Rust qualification. Process-crash recovery is
the common durability class; no fsync/power-loss claim follows from a successful
rename. OS/power-loss durability remains outside this experiment.

Owner selection at server acceptance and later ownership immutability retain
current behavior. Pre-commit ownership switches and ambiguous offline selection
remain unqualified rather than acquiring a new rule through these tests. Corrupt
original files must be preserved; complete recovery from irrecoverable bytes is
not claimed. The initial compatibility subject is the reviewed handoff snapshot;
a broader historical/platform support matrix is not implied.

T0 is the harness timestamp immediately before a ready Send button receives real
pointer input. Geometry/actionability preparation is outside T0; dispatch and
watcher pipe observation costs remain inside. TW is exact watcher stdout matched
to browser request identity and independent expected payload/owner. TA observes
HTTP response headers; UI disappearance is only an upper bound for queue UI
acknowledgement, not an instrumented storage-acknowledgement timestamp TQ.
TS requires supported input-boundary evidence from an actual opted-in host. A
synthetic watcher and an eventual model answer cannot establish TS. Pull waiting
and model scheduling must remain separate from transport latency.

All tests use private stores, side ports, profiles and synthetic identities. Test
extension native autostart is disabled before loading. Google Chrome uses an
isolated debugging pipe and `Extensions.loadUnpacked`; this is an automated
unpacked lane, not native lifecycle or distribution acceptance. Compare the same
extension/watcher bytes, data, deadlines and durability class. Keep all failed
setup attempts, timeouts and negative controls. Never run long qualification on
a candidate failing essential conformance.
