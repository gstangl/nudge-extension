# Changelog — Nudge (formerly Pin)

All notable changes to Nudge (extension + bridge + agent wiring). Format follows
[Keep a Changelog](https://keepachangelog.com); the **extension version is the
product version**, bridge versions noted where they moved. Rule: every version
bump lands here in the same change — no silent releases.

The changelog is English throughout.

## Unreleased

- Add a pinned, project-local Archify installation and reproducible, source-linked
  architecture map of the shared Chrome/Safari core and local bridge.
- Synchronize the toolbar test with label and viewport updates before grabbing
  the handle; assert a real drag and bottom-edge drop before checking the menu.
  Keep all menu-flip, scrolling and containment assertions unchanged.
- Wait for fitted, stable toolbar geometry in the shared browser parity runner
  before sampling drag coordinates after wake-tag and font changes.
- Experimental Rust bridge candidate 0.1.1 (not installed, no product version
  change): elect the last-joined session among equal `since` values like the
  JavaScript roster; make version-2 receipt signatures byte-compatible with the
  JavaScript bridge (ECMAScript numbers, UTF-16 key order and truncation,
  `|| null` truthiness), so JS↔Rust retries replay instead of conflicting; read
  JavaScript stores holding an unpaired surrogate instead of treating them as
  corrupt, and accept request bodies with the unpaired surrogate escape the
  extension's own UTF-16 truncation can send (signed from the exact request
  units); answer clients that half-close after their request. Independent
  owner-tie, cross-implementation retry and half-close checks run for both
  candidates in the comparison recorder.
- Wait for the fixture gauntlet's static server before the first navigation.

## 0.35.2 · Bridge 0.20.1 — 2026-10-27 (Isolated bridge comparison)

### Fixed
- Retire replaced browser sockets so late open/message/close/error callbacks
  cannot clear readiness, replace current pins or close the successor. This
  shared extension fix is part of JS1 for both bridge candidates.
- Commit a content-free withdrawal journal with deletion and reconstruct atomic
  fallback markers after a process crash, retaining original recipients and
  deleting leftover prompt mirrors/images. Existing direct readers keep their
  marker format; the JSON field is additive.

### Added
- Independent delivery ledger, wrong-candidate controls, semantic crash barriers,
  source/build-bound Google Chrome Send measurements and paired diagnostics.
- An experimental Rust bridge using the existing JSON store and public protocol,
  with the same external conformance, evidence and regression expectations.
- Current-snapshot rollback/direct-reader checks and explicit scenario coverage.
  Native lifecycle, actual agent receipts and long-run qualification remain
  separately required; the JavaScript bridge remains the installed default.

## 0.35.1 · Bridge 0.20.0 — 2026-10-13 (Restore the session-name input)

### Fixed
- Restore the Skill's trigger and optional session-label argument hint. Skill
  invocation surfaces can offer the custom name again; supplied names continue
  to reach the watcher unchanged. Removing runtime-specific frontmatter to fit
  a generic validator had removed that invocation affordance.

### Verification
- The isolated installer checks that each installed runtime adapter retains
  the invocation metadata; runtime integration verifies the supplied label in
  the live bridge roster. Native editor UI acceptance is separate.

## 0.35.0 · Bridge 0.20.0 — 2026-10-13 (Bind Nudge to verified worktree previews)

### Added
- `previews --project` verifies Portless routes against the serving process's
  real directory and the exact Git worktree. Report public browser URLs and
  internal server ports separately; sibling worktrees are excluded.
- `watch --project` refreshes its verified host claims on each heartbeat,
  including previews started after the Skill. `watch --url` binds a direct
  local preview explicitly. Hosts are additive heartbeat metadata; unscoped
  older runtimes retain their existing fallback behavior.
- An older opted-in watcher can acquire verified worktree hosts without
  replacing its wake process. Discovery runs outside the bridge event loop.
- `status --check --url`, `context --url` and `list --url` scope to the full
  browser hostname and port. Native context hooks use the same ownership
  resolution and exclude sibling-worktree selections and ownerless work.

### Changed
- The Skill verifies and binds worktree previews, distinguishes server ports
  from proxy ports, and requires visible browser proof before claiming a
  usable connection. Standard name/description discovery replaces legacy
  nonstandard frontmatter fields; the command remains `/groundworks-nudge`.

### Verification
- `portless-worktrees.mjs` creates two real Git worktrees, an isolated real
  Portless proxy and dev servers, project-scoped CLI watchers and a real
  Chromium extension. It checks late startup, automatic ownership, browser
  submissions, no cross-wake, URL scope, native hook isolation and reload.
- Unit discovery and readiness regressions accompany the portable runtime,
  HTTP/WS protocol and existing browser suites. Safari acceptance is separate.

## 0.34.13 · Bridge 0.19.3 — 2026-10-13 (Named local worktree addresses)

### Fixed
- Activate Nudge on HTTP `.localhost` subdomains used by Portless, including
  nested worktree/app names. Source registration, queued submission, icon
  refresh, development reload and readiness checks recognize these addresses.
- Admit named local page origins on the bridge's HTTP and WebSocket surfaces
  while retaining the direct-loopback Host fence and rejecting foreign names.
- Keep ownership scoped to the complete hostname and port, so worktrees sharing
  a proxy port retain separate agent routing. Pick the owner once per hostname
  in Switch session, as for existing localhost ports.

### Verification
- Unit regressions cover named source capture, queue transport, icon refresh,
  readiness and origin admission; Suite A can run with `NUDGE_APP_HOST` set to
  a nested `.localhost` name. Suite K7 checks separate real watcher delivery
  for two named hosts sharing one proxy port. The bridge boundary matrix covers
  named origins over HTTP and WebSocket. Safari acceptance remains separate.

## 0.34.12 · Bridge 0.19.2 — 2026-10-03 (Send without a responsive worker)

### Fixed
- When the background queue owner does not answer a submission within 5 s,
  post the same payload directly to the bridge from the page. The bridge
  deduplicates by submission ID, so a late queue delivery replays the same
  receipt instead of creating a second nudge. Older bridges without that
  capability keep the previous "retry safely" behaviour.
- Log the actual reason for an unacknowledged delivery in the page console.

### Verification
- Live evidence: the draft's private retry payload was stored, but the worker
  never wrote the queue entry and the healthy bridge never received it.
- Suite A15 makes the submit RPC never answer; the prompt arrives exactly once.
  Fast gate and Suite A pass. In one Suite A run the real worker exceeded 5 s
  while a screenshot capture hung; the underlying worker stall is not resolved.

## 0.34.11 · Bridge 0.19.2 — 2026-10-03 (Keep the prompt arrow aligned)

### Fixed
- Position the prompt arrow after fitting the window into the viewport, using
  its actual height. Growing drafts near the bottom edge keep pointing at the
  marked element instead of leaving the arrow above it.
- Suite Q17 measures arrow alignment for growing and shrinking drafts with the
  prompt on either side of a short marked element. Headless Chromium measured
  100px vertical error before the fix and 0px afterward for the long draft.

## 0.34.10 · Bridge 0.19.2 — 2026-10-03 (Restore retry state after restart)

### Fixed
- Re-read private retry state when Send is pressed instead of permanently caching
  a failed startup read. A transient restoration failure can recover on retry.
- Resolve an exact private retry reference across changed browser tab identities,
  requiring the saved text and route to match and replaying the original payload.
- Keep prior-session retry payloads until their retry horizon expires; a browser
  or extension restart must not remove data a restored draft still references.
  Missing or mismatched payloads remain blocked rather than minting duplicates.

### Verification
- 216 unit tests plus runtime integration and isolated installation pass.
- Chromium Suite Q16 exercises changed privileged identity and a failed first
  storage read, then verifies byte-equivalent replay with one queued submission.
- Chromium Suites A, L, Q and Y pass. Healthy screenshot legs wait for pick-time
  capture readiness; stalled-capture legs continue to submit while capture waits.
- Existing lost retry payloads cannot be recreated automatically. Re-marking and
  restoring the user's unchanged text successfully delivered the affected draft
  once. The updated extension still requires activation for live acceptance.

## 0.34.9 · Bridge 0.19.2 — 2026-10-03 (Move the prompt window)

### Fixed
- Drag the prompt window by its context header to recover a clipped draft or
  move it out of the way. The window stays within the viewport and retains its
  dropped position through scrolling and reloads for that draft. New prompts
  start beside their mark as before.
- Fit the window to its actual height as text grows; keep its header reachable
  in small windows. Hide the anchor tip after manual placement.

### Verification
- Suite Q15 covers real header drags for regions and elements, repeated drags,
  release, scrolling, reload, narrow viewport containment and Send/Cancel.
  Safari runtime acceptance remains unverified.

## 0.34.8 · Bridge 0.19.2 — 2026-10-03 (Freeform follows its content)

### Fixed
- Anchor freeform strokes and their composer to the content beneath the region
  during page and nested scrolling. Persist the translated stroke and capture
  rectangle together; restore the region without replacing it with its centroid
  element's bounds.
- Freeze annotation coordinates alongside the capture rectangle before awaiting
  a screenshot, so subsequent scrolling cannot alter an in-flight submission.

### Verification
- Suite Q exercises real wheel scrolling and draft persistence for freeform
  regions. Current-version user Chrome delivery and Safari remain unverified.

## 0.34.7 · Bridge 0.19.2 — 2026-10-03 (Prompt acceptance during slow delivery)

### Fixed
- Separate durable queue mutations from serialized HTTP delivery. A slow earlier
  request no longer prevents accepting or inspecting another queued prompt.
- After durable storage succeeds, allow one second for immediate delivery, then
  confirm "Saved in queue — delivery in progress" and release the composer.
  This acknowledges local storage, not agent receipt; delivery keeps its original
  idempotency token and FIFO order. Storage failure still preserves the draft.
- Follow a queued acknowledgement with a numbered delivery notification in the
  originating document once the bridge receipt has been validated.
- Remove delivered entries against the latest stored queue so concurrent prompt
  acceptance cannot be overwritten. Keep discard ordered after ongoing delivery.

### Verification
- A failing baseline unit regression reproduces acceptance blocked by an older
  stalled transport. Queue tests cover prompt acceptance, write failure, ordering,
  replay and refreshing withdrawn receipts.
- Headless Chromium Suite A delays real content-script HTTP delivery: two prompts
  are durably accepted before server commit and later arrive exactly once in
  order. Suite Q covers reload, quota failure and lost acknowledgements.
- The exact cause of every observed live messaging timeout is not established;
  current-version user Chrome and Safari acceptance remain unverified.

## 0.34.6 · Bridge 0.19.2 — 2026-10-03 (Composer follows its element)

### Fixed
- Keep the single-element highlight and composer attached to their live target
  during page scrolling, nested scrolling and viewport resizing. Refresh geometry
  once per animation frame without resetting draft text, caret, focus or Send state.
- Hide a stale highlight when its element is removed; retain the draft and report
  the missing element. Freeform regions retain their viewport-based geometry.

### Verification
- Chromium Suite Q reproduces the previous 120 px highlight offset and stationary
  composer after a 120 px page scroll. The fix leaves 0 px offset and moves the
  composer by 120 px; nested scrolling, resizing and removed-target checks pass.
- Fast gate: 210 unit tests, runtime integration and isolated setup pass.
  Headless Chromium Suites A, L, P, Q and Y pass.
- Safari runtime acceptance and the separate delivery-timeout issue remain open.

## 0.34.5 · Bridge 0.19.2 — 2026-09-17 (Registration timeout diagnostics)

### Changed
- Return the active identity-operation stage when registration exceeds its
  response deadline. Preserve serialization of unfinished storage operations
  and ignore late replies. This adds diagnosis for the observed live timeout;
  it does not claim to resolve its still-unidentified underlying cause.

### Verification
- Fast gate: 210 unit checks plus runtime and setup pass. Headless Chromium
  Suites A and Y (5 checks) pass.
- A stalled startup-storage regression returns the active stage before the
  content-script deadline and permits registration after storage recovers.
- The affected live tab still requires extension reload and a fresh send to
  identify the underlying timeout; live recovery is not yet verified.

## 0.34.4 · Bridge 0.19.2 — 2026-09-17 (Tab registration recovery)

### Fixed
- Recover tab registration when a worker restart missed navigation: accept a
  changed browser-issued document ID only after the current top-level receiver
  proves the matching document and route. Retain the tab identity and reject
  stale documents, same-document token replacement and unproven successors.
- Log the actual registration failure in the page's extension console so a
  generic toolbar notice does not hide the diagnostic cause.

### Verification
- The missed-navigation worker-restart regression fails before the change and
  passes afterward, alongside same-document and missing-document-ID guards.
- Fast gate: 209 unit checks plus runtime and setup pass. Headless Chromium
  Suites A, Q (10 checks) and Y (5 checks) pass.
- The affected live Chrome tab was still executing the previous content script
  after a page reload. Activation of this patch requires an extension reload;
  the original live registration failure is not yet confirmed resolved.

## 0.34.3 · Bridge 0.19.2 — 2026-09-17 (Send recovery)

### Fixed
- Always release Send after preparation errors. Bound tab registration, retry
  storage, restoration and delivery acknowledgements so a missing extension
  reply cannot disable the composer indefinitely. Ambiguous delivery retains
  the original submission identity for safe retry.
- Treat malformed page-console responses as unavailable context instead of
  leaving the send operation permanently pending.

### Verification
- Fast gate: 206 unit checks, runtime integration and isolated setup pass.
- Headless Chromium Suites A, Q (10 checks) and Y (5 checks) pass. Fault tests
  cover missing storage/registration/queue replies, late acknowledgements,
  preparation errors and malformed page-console responses.

## 0.34.2 · Bridge 0.19.2 — 2026-09-17 (Readable expanded prompts)

### Fixed

- Expand queue prompts below their stable metadata row using the full available
  width, preserved paragraphs and comfortable line spacing. Opening and closing
  animate gently and respect reduced motion; follow-ups stay below the prompt.

## 0.34.1 · Bridge 0.19.2 — 2026-09-17 (Draft retry recovery)

### Fixed
- Keep a failed retry-storage write from leaving a dangling draft reference
  that blocks sending after a page reload. Persist retry references only after
  their private payload has been stored successfully.
- Retry failed tab registration when sending instead of requiring a page reload.
- Preserve unresolved delivery references during restoration so subsequent
  reloads cannot silently bypass duplicate-delivery protection.

### Verification
- Fast gate: 200 unit checks, runtime integration and isolated setup pass.
- Headless Chromium Suite A and Suite Q (9 checks) pass, including actual
  retry-storage quota failure and ambiguous queue acknowledgement across reload.
- The additional browser-parity run stops at the toolbar corner-menu check
  (`Timeout: visible .count`); full parity and Safari acceptance remain unverified.

## 0.34.0 · Bridge 0.19.2 — 2026-09-14 (Optional guided setup)

### Added
- Extend `groundworks-nudge status --check` with read-only, versioned checks for
  local prerequisites, the installed Skill, bridge identity, the chosen browser
  and the current session's page ownership. A missing browser connection never
  asserts a missing browser installation; connection checks do not prove wake.
- Provide one guided setup procedure for the Nudge Skill and optional external
  entry points, using the public GitHub repository and one chosen browser.

### Changed
- Describe Nudge as an independent optional companion to Groundworks. Keep its
  Skill, CLI, installation and updates in this repository.
- Check readiness before arming; reuse installation consent and existing setup,
  preserve changed Skills, and keep pending browser activation distinct from
  the current session's permission to connect. `status` remains compatible.
- Include the diagnostic and its installation guide in portable runtime payloads.

### Removed
- Remove the undocumented `doctor` alias. Setup uses the existing `status`
  command instead of introducing a separate diagnostic concept or entry point.

### Verification
- `cd test && npm run test:ci`: 194 unit checks, the real bridge/watcher CLI
  integration and isolated installation for Claude Code, Codex and Grok pass.
- Suite A's real-extension status check passes in visible Chromium. The earlier
  optional-entry candidate passed the full visible suite, including region
  before/after evidence and page ownership. Its private test package uses
  the actual Chromium identity while retaining disabled native autostart. A
  subsequent selection uses exposed card padding, with a hit-test precondition,
  instead of a center covered by existing feedback; all assertions remain.
- Two current visible runs failed the screenshot assertion after the source
  window lost focus. An attempted focus precondition did not resolve that and
  was not retained. The full current browser run is not passing.
- Two headless macOS attempts failed the existing region-screenshot assertion
  when capture arrived after the overlay restoration window. The assertion and
  production timing remain unchanged. This is not a headless or Safari pass;
  automatic model wake and a fresh-machine browser installation remain unverified.

## 0.33.4 · Bridge 0.19.2 — 2026-09-13 (Toolbar activation and active-tool dragging)

### Fixed
- Keep the toolbar above the Freeform drawing surface so its handle and tool
  buttons remain usable while drawing mode is active, in both browser packages.
- Register native action/shortcut handlers before secondary worker setup and
  contain startup icon failures so decorative rendering cannot disable controls.

### Changed
- Label the shortcut as show/hide, not an unspecified toggle. Document Option+C
  on macOS and that visibility never switches the handle into a locked mode.

### Added
- Shared real-input coverage for dragging in Pick/Freeform mode, preserving the
  selected tool, releasing the grip and cancelling through the active button.
- Worker startup regressions for unavailable icon rendering and callback-style
  icon APIs, plus a distinct native icon/shortcut acceptance row.

Native-app/distribution and full independent Safari acceptance remain separate.

## 0.33.3 · Bridge 0.19.2 — 2026-09-13 (Toolbar status load fix)

### Fixed
- Cache the four toolbar icon colors and skip identical per-tab action updates.
  Repeated roster changes no longer trigger redundant bitmap work that delays
  new submissions in the background worker. Changed counts and connection
  states still render immediately; navigation and closed tabs invalidate the
  per-tab cache, and failed action writes remain retryable.

### Added
- Worker action regressions for status storms, changed counts/colors, tab
  isolation, navigation resets and synchronous/asynchronous API failures.

Real Safari behavior and final independent acceptance remain separate gates.

## 0.33.2 · Bridge 0.19.2 — 2026-09-13 (Follow-up quality assurance)

### Changed
- Present Nudge as a Chrome extension and temporary Safari developer preview
  throughout the GitHub introduction, install/support guides, issue template,
  agent setup output and Skill. Clarify shared per-website agent choice,
  browser-local state and CLI-based bridge startup without Chrome. Re-run
  agent setup to install the updated Skill guidance; no protocol change.
- Clarify temporary Safari installation for actual project work: use the shared
  bridge and release-configured resources; preserve isolated test stores and
  unsent work when reloading an existing installation.

### Fixed
- Contain malformed WebSocket frames at the client connection instead of
  crashing the shared bridge; bound inbound hello/identity messages to 64 KiB.
- Broadcast live roster capability and metadata changes, including push/pull
  transitions, without broadcasting freshness-only heartbeats.
- Refresh an already open status menu when the bridge disconnects, so it cannot
  keep claiming an active agent while the toolbar reports an offline bridge.
- Scope CLI prompts and withdrawals by the parsed URL port, not a substring
  that also matches a longer port or text in the query string.
- Correct the install guide: Escape clears marks; resolution does not guarantee
  captured after-evidence. Align the product installation/lifecycle description
  with the temporary Safari developer profile and redact public diagnostics.
- Document native-disabled resource staging for individual browser suites and
  identity-checked bridge restarts in the contributor guide.
- Verify agent wiring against a real disposable installation, not the user's
  global Skill copies. Missing files now fail on clean CI; stale Skills are
  replaced and every Skill/hook copy must match the checkout byte for byte.
- Give the early-watcher resilience test its own identity instead of inheriting
  an agent session from the developer's shell. Check LAN bind isolation through
  portable network-interface discovery; an unavailable interface blocks that
  check instead of producing a passing skip on Linux.

### Added
- Isolated real-socket crash/size-limit and live-roster regressions, included in
  the portable gate. Healthy clients must stay connected after invalid frames.
- Shared real-input live wake-status checks, an open-menu disconnect regression,
  and exact/default-port CLI integration cases.

These are implementation QA fixes; real Safari and fresh independent acceptance
remain separate gates. No native-app or signed-distribution completion is claimed.

## 0.33.1 · Bridge 0.19.1 — 2026-09-13 (Developer-preview review fixes)

### Fixed
- Reject malformed or oversized annotation arrays before allocating a prompt;
  retain readable historical prompts whose annotations have an invalid shape.
- Validate local Host and Origin independently on HTTP and WebSocket requests,
  and reject absolute/proxy request targets before routing.
- Decode bounded HTTP request bytes once, preserving umlauts and emoji across
  network chunk boundaries; reject malformed UTF-8 rather than corrupting text.
- Acknowledge withdrawals against the immutable original session and its actual
  wake mode. Offline or ownerless work no longer names a replacement recipient.
- Flip toolbar menus above the bottom edge, constrain their width/height, scroll
  long contents and follow resizing/content growth; keep feedback chips visible.
- Isolated Safari tests no longer toggle an existing installation browser-wide;
  missing isolation is a blocked result and cleanup failures cannot pass.

### Added
- Real HTTP/WS boundary/restart regressions and all-byte-split Unicode units.
- Real-input menu checks at every corner in the shared Safari/Chromium runner;
  growing, scrolling and narrow-viewport queue regression in Suite L.
- GitHub instructions for temporary Safari source installation without Chrome,
  full Xcode or signing, with explicit lifetime and shared-bridge limits.
- Serial portable, Chromium interaction/parity and multi-profile gates in CI,
  with retained evidence; the separate manual Safari lane also runs coexistence.
- Bidirectional agent-selection checks in the multi-profile and real joint
  browser lanes; existing per-website selection remains shared between browsers.

Native app/notarization/App Store work is deferred for the GitHub developer
profile, not completed. Chromium verification and workflow definitions do not
establish Safari parity, a successful remote CI run or independent acceptance.

## 0.33.0 · Bridge 0.19.0 — 2026-09-13 (Safari parity hardening)

### Fixed
- Prevent duplicate content controllers and console hooks on repeated injection;
  end toolbar drags on cancellation, window blur and context cleanup.
- Serialize browser-local queue mutations in the background. Preserve drafts on
  quota/full-queue errors, retain stable retries, and expose ambiguous legacy or
  expired queued prompts for review/discard. Keep HTTP in the local content
  world rather than weakening the bridge's Origin admission.
- Persist each nudge and idempotency receipt atomically; changed image/context
  payloads now conflict instead of being treated as identical retries.
- Preserve legacy receipt replay, invalidate uncommitted cache state after disk
  errors, and reject malformed modern image submissions before allocation.
- Recognize identical historical after-image retries without rewriting legacy
  records or retroactively assigning browser provenance.
- Keep ambiguous retry payloads in extension-owned storage, never page storage;
  collect acknowledged/closed-tab/expired leftovers without deleting the queue.
- Bind captures to session/tab/document and activation/navigation/focus epochs.
  Route-matched successor documents can provide after-evidence; retired or
  closed sources cannot. Missing evidence has an explicit pending reason.
- Keep platform/native configuration out of the page's MAIN world and restrict
  generated resource replacement to non-symlinked Safari artifact directories.
- Exclude the entire overlay, including lasso tint, from evidence pixels; retry
  transient capture throttling within the original source-bound request.
- Preserve source identity on same-document navigation and prevent P/F shortcuts
  from consuming text while Shift-collecting inside the shadow-DOM composer.
- Bind selection images to a mark generation; reject late or foreign images.
- Verify bridge identity before startup and serialize store-lease recovery;
  native-host failures now return framed errors instead of claiming success.

### Added
- Explicit Safari/Chrome toolbar interaction gate: two-axis repeated grip drag,
  release stability, viewport corners, resize recovery and post-drag controls.
- Shared real-input SafariDriver/Chromium parity runner with candidate resource
  hashes and isolated stores. Failed or missing browser checks fail explicitly.
- Queue, capture-identity and expanded source-protocol regression tests.
- Bounded PNG decoding/CRC validation for evidence, structural JPEG overview
  validation, and runtime/resource dependency inventories with bundled licenses.

Safari browser acceptance is still in progress. These changes do not claim a
tested native app, signed distribution, or full Chrome/Safari parity.

## 0.32.3 — 2026-09-13 (Safari toolbar drag)

### Fixed
- Track an active toolbar drag at window scope instead of relying exclusively on
  pointer capture from the small grip. This keeps the toolbar movable in Safari
  when pointer capture is unavailable for the shadow-DOM handle.
- Preserve the initial WebSocket snapshot for existing clients; Suite W checks
  wake-mode propagation through both the initial and host-scoped snapshots.
- Allow an isolated protocol-test port and avoid waiting for an already exited
  bridge during cleanup. Toolbar and toggle suites accept staged test resources.

## 0.32.2 — 2026-09-13 (Astra wake compatibility clarification)

### Changed
- Clarified that the current Codex integration remains pull when using GPT-6
  Astra. Distinguished bridge delivery, context hooks and runtime turn-start
  support, with explicit limits on the automated tests and live Astra evidence.
- Added a prominent README callout recommending Claude Code with Monitor for
  automatic wake and explaining the extra chat message required by pull runtimes.

## 0.32.1 — 2026-09-13 (Crosshair toolbar icon)

### Changed
- Replaced the generic status dot and thumbtack identity with the Lucide
  Crosshair icon. Its grey, red, amber and green states retain their existing
  connection-status meanings.

## 0.32.0 · Bridge 0.18.0 — 2026-09-12 (Safari port foundations)

### Added
- Deterministic Safari resource staging with separate test and release modes,
  manifest overlays and resource digests.
- Additive source-bound evidence and idempotent submission contracts, with
  focused browser-protocol and bridge-lifecycle test runners.
- A store writer lease and bridge identity capability check for native/helper
  lifecycle integration.

### Changed
- Suite A now stages an isolated test extension before its background worker
  starts, so it cannot invoke the user's native Chrome host.

### Not yet released
- Real Safari extension behavior, containing-app/helper lifecycle, signing,
  notarization and distribution remain unverified external gates.

## 0.31.1 — 2026-09-12 (Docs for coding agents)

### Changed
- `AGENTS.md` is command-first and points at one docs file per task.
  `CLAUDE.md` is a pointer so Claude Code and Grok do not load a second
  constitution. `docs/README.md` says when to open Vision, Product, or
  Decisions.

## 0.31.0 · Bridge 0.17.0 — 2026-09-12 (Groundworks Nudge)

### Changed
- The product name is **Groundworks Nudge** (Chrome card, native host,
  bridge identity). This is the first public release of a Groundworks
  Framework piece. Re-run `./bridge/install-native-host.sh` so Chrome
  talks to `dev.groundworks.nudge` instead of `energy.roots.nudge`.

## 0.30.1 — 2026-09-12 (Zed named as a tested surface)

### Changed
- Install and onboarding name **Zed** next to the terminal and T3 Code. All
  three are tested. Invoke `/groundworks-nudge` in Zed’s agent panel on the
  project you want to change; Claude Code in Zed arms as push.

## 0.30.0 · Bridge 0.16.0 — 2026-09-12 (Open-source packaging)

### Added
- Community files so the repository can take pull requests: MIT license, code
  of conduct, contributing guide, security policy, GitHub issue and pull-request
  templates.
- [AGENTS.md](AGENTS.md) — start file for coding agents working on this
  repository, as opposed to using Nudge in another project. The Skill
  `/groundworks-nudge` is the trigger in every runtime.
- [SUPPORT.md](SUPPORT.md) — where to get help.
- Agent setup also copies the Skill into `~/.grok/skills`, so Grok Build (CLI
  or via T3 Code) finds `/groundworks-nudge` without a separate plugin.
- Dependabot for `bridge/` and `test/` npm deps and for GitHub Actions.

### Changed
- User-facing documentation is English. Product, vision and decision docs live
  under `docs/`.
- Historical changelog entries are English and no longer name private testers.
- The native messaging host wrapper is generated per machine and is no longer
  tracked.
- `./agent/setup-agent.sh` prints the next step: invoke the Skill in the
  project you want to change, then wait for the green status dot.

## 0.29.1 — 2026-08-31 (Claude Code arms as push again)

### Fixed
- **The Skill named the wake capability only in the abstract.** After the
  runtime-neutral rewrite it said only “push only when this runtime can
  surface watcher output as a new turn” — without naming the tool that does
  that. Claude Code sessions then started a background shell and armed as
  pull, even though the persistent Monitor tool was available; the toolbar
  showed “Pull” where it used to wake by itself. The Skill now maps the
  capability concretely: Monitor is the push channel, a background shell is
  not. What decides this is the tool that starts the watcher, never the
  editor around it.

## 0.29.0 · Bridge 0.15.0 — 2026-08-28 (One Nudge channel for every agent)

### Added
- **`groundworks-nudge` is the shared agent interface.** The command arms the
  watcher, shows status, the current mark and the queue, resolves pill
  numbers, and resolves only after proof. Claude Code, Codex and other local
  agents use the same commands.
- **Native Skill install for Claude Code and Codex.** Setup installs
  `/groundworks-nudge` in both skill homes and wires the optional hooks of
  both runtimes. The old `/nudge` alias is removed so only the canonical name
  appears in the command menu.
- **A CI test for the runtime-neutral path.** It starts the bridge and a
  Codex watcher with separate ids, posts a real Nudge, and checks store,
  owner, hook context, pill resolution and resolve.

### Changed
- **Agent identity instead of a Claude session.** `NUDGE_AGENT_ID` is the
  neutral entry. Codex thread, Codex session and Claude Code session are
  runtime adapters only. Runtime, surface and wake capability are separate
  fields.
- **Missing wake capability is always pull.** Zed or another editor field
  must never claim push on its own.
- **One store for every runtime.** The bridge reports the authoritative path.
  Existing installs keep their current store. New installs start under
  `~/.nudge`; two separate stores abort instead of silently splitting data.
- **Browser copy names the agent session.** Status, the Pull hint and the
  session picker no longer assume a particular runtime or surface.

### Fixed
- **Codex used to read a different store from the bridge.** The manual Skill
  copy pointed at a path the running bridge did not use.
- **Codex watchers had no stable session id.** Owner assignment and parallel
  localhost routes were not reliable. The normalised agent key now lasts
  until resolve.

## Earlier history

Entries below are a condensed English record of what shipped before the
runtime-neutral CLI. Behaviour described here is still in the product unless
a later version replaced it.

### 0.28.0 — 2026-08-14
Plex Mono for selectors, ids and host chips, shipped as “Groundworks Nudge Mono”.

### 0.27.0 — 2026-08-14
IBM Plex Sans becomes the toolbar face, shipped as “Groundworks Nudge Sans” (OFL
rename required; Reserved Font Name “Plex”).

### 0.26.0 — 2026-08-14
Licensed DIN Var removed from the repository and replaced with an OFL face,
so the project can be published without redistributing a paid font.

### 0.25.0 — 2026-08-05
Off means off: `Alt+C` / the toolbar icon hides the overlay browser-wide and
keeps it off across tabs, reloads and browser restarts. The Chrome icon
tracks that state.

### 0.24.2 — 2026-07-31
Toolbar stays fully inside the viewport when DevTools docks or the bar grows.

### 0.24.1 — 2026-07-29
A stalled screenshot capture no longer hides the toolbar. Region prompts
still send if `captureVisibleTab` hangs (for example with a debugger attached).

### 0.24.0 — 2026-07-29
Queue **×** withdraws a Nudge as a message, not a silent delete. The owning
agent is told to stop. Suite X covers the chain.

### 0.23.0 — 2026-07-29
A page reload keeps the working state (draft, marks, toolbar, history). The
live DOM node may be gone; frozen context is kept. Suite Q.

### 0.22.0 — 2026-07-29
`/groundworks-nudge <Name>` (then `/nudge <Name>`) sets the toolbar label
when the session is armed.

### 0.21.6 — 2026-07-29
Shift+click multi-select works from both entry paths. Pill numbers wrap at
999; durable ids keep counting. Reference resolution prefers what is open
on screen.

### 0.21.4 — 2026-07-29
Escape clears the current mark, including on pages that own the keyboard,
without stealing the key from the page’s own dialog. Suite O.

### 0.21.3 — 2026-07-21
Clicking the status dot shows a one-line explanation of the current state.

### 0.21.2 / 0.21.1 / 0.21.0 — 2026-07-09 to 2026-07-21
Visible push vs pull. CLI / terminal sessions arm as pull. A wake does not
interrupt work already in flight. Claude Code CLI integration.

### 0.20.0 — 2026-07-09
Enter sends. Empty send is a numbered mark only. The agent can refer to
“Nudge 12”.

### 0.19.0 — 2026-07-07 · Bridge 0.13.0
Append-only **+ amend** on an open Nudge. Follow-up UI, send control and
empty-after-send races through 0.19.8.

### 0.18.x / 0.17.x — 2026-07-07
Hotkeys, reduced-motion, autogrow, localhost shown as a pill never inlined
in the session name, one popover at a time, toolbar grip does not dismiss
page UI (the “moat”). Suites L and M.

### 0.16.x — 2026-07-05 to 2026-07-06
Switch-session dropdown, per-Nudge owner stamp, opt-in fence (a session
sees Nudge only after the Skill), fixture gauntlet, tests never touch the
live port 4700.

### Bridge 0.11.x / 0.10.x — 2026-07-05
Adversarial bridge suite, provenance, kidnap battletest, inactive sessions
leave the roster, Skill invocation is the only way onto the channel.

### 0.15.x – 0.12.0 — 2026-07-05
English UI strings. Pick / Freeform labels. Status model (grey / red /
amber / green). Number pills instead of persistent page markers.

### 0.11.0 — 2026-07-05
Renamed Pin → Nudge. Ids `nudge_N` (legacy `pin_N` still addressable).
Native host name `dev.groundworks.nudge`.

### 0.10.0 — 2026-07-05
CORS restricted to localhost origins. Empty send no longer creates a prompt.

### 0.9.0 – 0.6.0 — 2026-07-05
Standalone repo (extracted from a private monorepo). Queue popover,
movable toolbar, evidence loop, design tokens with no runtime dependency
on that monorepo.

### 0.5.x — 2026-07-05
Native messaging host: Chrome owns the bridge lifecycle. Feedback chips.
MCP surface removed. Event-driven Node watcher.

### 0.4.x / 0.3.x — 2026-07-04
Richer element context (xpath, innerText, computed styles). Gliding
highlight. Pick publishes a mark without sending. Two-phase publish
(element first, screenshot later).

### 0.2.x — 2026-07-04
Fire-and-forget: Nudge is UI prompting, not an annotation tool. Persistent
markers removed. Empty send = mark only.

### 0.1.x / 0.0.x — 2026-07-03 to 2026-07-04
Honest status chain. First spike: picker, layer chips, lasso, screenshots,
console/network hook, offline queue, WebSocket sync.
