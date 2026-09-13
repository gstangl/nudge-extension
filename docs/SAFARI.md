# Safari developer preview: install and verify

This GitHub source-install profile uses a temporary Safari Web Extension plus
the same local Node bridge as Chrome. A native containing app, signed installer,
notarization and App Store publication are deferred, not launch requirements
for this developer preview. Full current-candidate Safari feature parity is
still unverified; do not advertise this as an accepted stable Safari release.

## Install from GitHub

Requirements: macOS with Safari 26+, Node.js 22+, Git and a local coding agent.
You do not need Chrome, full Xcode or an Apple Developer account for this path.

```sh
git clone https://github.com/gstangl/nudge-extension.git
cd nudge-extension
(cd bridge && npm ci)
./agent/setup-agent.sh
node agent/groundworks-nudge.mjs ensure-bridge
node agent/groundworks-nudge.mjs status
node scripts/package-safari.mjs --mode release --out artifacts/safari/project-extension
```

1. In Safari **Settings > Advanced**, enable **Show features for web developers**
   if the Developer settings are not visible.
2. In **Settings > Developer**, click **Add Temporary Extension…** and select
   `artifacts/safari/project-extension`. Allow unsigned extensions if requested.
3. In **Settings > Extensions**, enable Groundworks Nudge. Open your localhost
   app (or `http://localhost:4700/demo`), click Nudge's Safari toolbar icon and
   grant access to **this website**. Grant `127.0.0.1` separately if needed.
   Do not disable origin/file security restrictions or grant every website.
4. In the agent chat for the **project you want to change**, invoke
   `/groundworks-nudge`. Choose that armed session in Nudge's **Switch session**
   menu. A green `Pull` status still requires a message in that chat.
5. Drag the six-dot handle, try Pick and Cancel, then submit a small prompt.
   Confirm receipt in the intended agent chat, not just a green browser dot.

The CLI is installed in `~/.local/bin`; see [PATH setup](../INSTALL.md#4-set-up-the-agent-side)
if `groundworks-nudge` is not found. The `node agent/groundworks-nudge.mjs`
commands above work directly from the checkout as well.

**Temporary means temporary:** Safari removes this installation after 24 hours
or when Safari quits. Add the same resource folder again. Keep the repository
in place. Source packaging uses `--mode release` to select the shared port 4700;
the word "release" does not mean signed or permanent installation.
[Apple documents the temporary lifetime](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

Safari does not start Chrome's native host. Run `groundworks-nudge ensure-bridge`
after login if no bridge is running; agent session hooks also attempt startup.
Do not depend on Chrome being open. Both browsers may run simultaneously with
one bridge/store; their agent selection is currently shared per website.

## Updates and removal

**Option+C shows or hides the toolbar; it does not lock its position.** Whenever
the toolbar is visible, its six-dot handle remains draggable, including while
Pick or Freeform is selected. Safari may show a second, unassigned shortcut row
for its native toolbar button; it invokes the same show/hide action.

Follow the shared [update/restart instructions](../INSTALL.md#updating), rerun
the packaging command into the same `project-extension` folder, then use
**Settings > Extensions > Groundworks Nudge > Reload**. Preserve unsent drafts
before reloading the local page too: an extension reload alone can leave an
old controller in the tab. Do not enable a project package and an isolated test
package on the same page.

Remove the temporary extension in Safari Settings when finished. Its removal
does not remove Chrome, the CLI or the shared prompt store. Browser-local
offline prompts are not in the bridge store until delivered: send or review
them before removing an installation. See [shared uninstall](../INSTALL.md#uninstall)
for the remaining components; retain the store unless you deliberately want to
erase prompt history/evidence.

## Build and verification resources

The Safari resources are staged from the shared extension; they are not copied
back into `extension/`.

```sh
node scripts/package-safari.mjs --mode test --bridge-port 4820 --out artifacts/safari/test-extension
node test/safari-e2e.mjs --smoke
node scripts/package-safari.mjs --mode release --out artifacts/safari/release-extension
```

Test resources remove `nativeMessaging` and configure their bridge endpoint
before any extension worker runs. Release resources reject a test port and
disable native autostart and development reload. Both generate `RESOURCE-SHA256`.

## Native packaging

Use the Safari Web Extension packager supplied by the selected full Xcode; do
not assume a command name or path from this document. The packager's generated
app is the starting point for a separate local-development experiment. The app
must use the bridge identity/lifecycle contract and keep shared runtime and
store data outside the removable app bundle.

This repository does not currently contain a built, signed or notarized Safari
app. Full Xcode, signing and clean-machine lifecycle evidence belong to that
future distribution profile, not the GitHub temporary installation above.

## Temporary Safari installation (developer testing)

This is the GitHub developer-preview installation path, not a permanent app.

### Use with your actual project and agent

Complete the bridge and agent setup [above](#install-from-github), then use the
shared bridge and release-configured resources (no Chrome setup is required):

```sh
groundworks-nudge ensure-bridge
groundworks-nudge status
node scripts/package-safari.mjs --mode release --out artifacts/safari/project-extension
```

Add `artifacts/safari/project-extension` in Safari's Developer settings, enable
Groundworks Nudge under Extensions, and grant access to your local project
website. Invoke `/groundworks-nudge` in the agent session working on that
project. Safari and the CLI must use the same bridge (normally port 4700).
The toolbar should show that session; green with `Pull` still requires a chat
message to wake the agent.

If upgrading an already loaded temporary directory, stage into that **same**
directory, use **Extensions > Groundworks Nudge > Reload**, then reload the
project tab after preserving any unsent work. Reloading the extension alone can
leave old in-page controllers behind. Do not keep both the project and isolated
test installations enabled on the same page.

If the CLI lists your agent but Safari is amber with no session, check the
staged `platform.js`: a fixed test port such as 4820 connects to a different
bridge/inbox. Restage that installation in release mode and reload both the
extension and tab. Keep the test store; switching endpoints does not migrate
its prompts into the shared inbox.

### Isolated compatibility testing

The following setup deliberately does **not** connect to your normal agent.

1. From the repository root, install bridge dependencies once: `(cd bridge && npm ci)`.
2. Stage a separate test resource directory and start a separately scoped
   bridge/store:

   ```sh
   node scripts/package-safari.mjs --mode test --bridge-port 4820 --out artifacts/safari/temporary-extension
   NUDGE_PORT=4820 NUDGE_STORE="$PWD/artifacts/safari/temporary-store" node bridge/bridge.mjs
   ```

3. In Safari, open **Safari > Settings > Developer**. Enable unsigned extensions
   if Safari asks, click **Add Temporary Extension…**, and select
   `artifacts/safari/temporary-extension`.
4. Open **Safari > Settings > Extensions**, select Groundworks Nudge and enable
   it. On the local test page, click Nudge's Safari toolbar icon and grant access
   to **this website**. Repeat for `localhost` and `127.0.0.1` if you use both.
   Do not grant all websites or disable origin/file security restrictions.
   A toolbar entry alone does not prove that Safari may inject the page UI.
5. When the staged directory changes, reload Groundworks Nudge from that pane
   if Safari offers a reload control; otherwise remove and add the same
   temporary-extension directory again. Reload the test tab afterwards.
6. Open `http://localhost:4820/demo`. Test Pick, Freeform, a sent prompt and a
   resolve/after-image cycle. The test resource's worker does not launch a
   native host; the separately started bridge is expected.

The isolated port/store above is a test environment. It does not arm your normal
agent session or use its production inbox. An amber status means the bridge is
reachable but no agent is listening; it is not evidence of broken installation.
For real project work, use the normal shared bridge installed by [INSTALL.md](../INSTALL.md)
and release resources (port 4700, no native autostart), then invoke the Skill in
the project session. That temporary Safari path still requires the bridge to be
running; automatic native startup is not implemented.

The icon is Lucide **Crosshair**. Grey means off, red means bridge unreachable,
amber means no active agent, and green means an active agent. The badge is the
open-prompt count. `Pull` means the agent receives the prompt with your next chat
message; it does not start a new turn by itself. Drag the six-dot handle in the
page toolbar, not the Safari address-bar icon.

The developer path is intentionally temporary and provides neither native app
lifecycle nor signed updates. Those limits must accompany GitHub instructions.

## Deferred permanent installation

Do not publish permanent-app instructions until there is a signed containing
app and native startup/update/uninstall/clean-machine evidence. A future path
may look like this; it is not the current GitHub installation:

1. Download and move the signed Groundworks Nudge app to Applications.
2. Open it once; the app reports extension/setup state truthfully.
3. Enable Groundworks Nudge in Safari Settings > Extensions and grant access to
   the local development sites the person uses.
4. Start or verify the bridge from the app, then use `/groundworks-nudge` in
   the chosen agent session.

For the current profile, say plainly: **Safari developer preview, temporary
source installation; full Safari parity not yet accepted.**

## Validation levels

| Level | Current evidence |
|---|---|
| Resource staging | Tested by `node test/safari-e2e.mjs --smoke` |
| Shared browser implementation | Chromium regression and real-input contract; not Safari acceptance |
| Safari extension behavior | Temporary installation and some transport/UI observed; full current-candidate parity remains unverified |
| Native app/helper lifecycle | Not implemented or tested |
| Signed distribution | Not prepared or tested |

PNG evidence is validated with bounded decoding and CRC checks (noninterlaced,
up to 64 MiB decoded data). Unsupported/oversized modern images are rejected,
not silently removed from an acknowledged prompt. JPEG overview admission checks
structure, not entropy-decoded pixels; the real browser pixel test separately
decodes the generated overview. Missing Safari quota/zoom/permission-revocation
and background-suspension tests remain acceptance gaps even if the core runner
passes. Same-route two-profile Chromium tests are not simultaneous Safari/Chrome
proof. The joint runner is implemented, but its current-candidate Safari runtime
acceptance remains unverified while the GUI prerequisites are unavailable.

## Reproducible implementation checks

```sh
(cd test && npm run test:ci)
node test/safari-e2e.mjs --smoke
node test/browser-protocol.mjs
node test/bridge-lifecycle.mjs
node test/run-browser-regression.mjs --headless
node test/browser-parity.mjs --chromium --headless
node test/browser-coexistence.mjs --chromium-only --headless
```

`--headless` explicitly means Chromium implementation verification, not a visible
Safari session. Resource hashes and per-run reports live under `artifacts/safari/`.
The resource smoke compares repeated release output and rejects test settings in
release packages; it does not invoke an Apple packager.

Run `node test/safari-e2e.mjs` for the real Safari contract. It requires Safari
26+, Remote Automation enabled, an unlocked GUI session, and Peekaboo with Screen
Recording/Accessibility permission for the website-access prompt. It installs
its own temporary resources and uses separate local ports/store. Permission
automation remains a candidate-specific test requirement, not a guarantee that
all Safari permission dialogs are automated. A locked screen or unavailable
permission fails the run; it is never counted as a pass. Do not manually operate
Safari's automation window during a run; Safari may pause it behind a modal.
An existing enabled Nudge overlay blocks the isolated core lane; it will not
switch off a user's other installation browser-wide. Use an isolated test
account/session, or preserve pending work before deliberately turning it off.

Run `node test/browser-coexistence.mjs` for the simultaneous Safari/Chromium
contract. It checks four same-route tabs, shared history/ownership and actual
source-bound before/after pixels in both directions. It owns its temporary
Safari extension identifier, automation session, Chromium profile and isolated
bridge/store. Existing Safari Nudge installations are not globally toggled;
turn a conflicting enabled overlay off before this isolated run. Only this
website is granted access. Cleanup targets the owned resources, and cleanup
failure cannot produce a passing report. A locked GUI is detected before any
browser launch and produces a blocked, nonzero result. `--headless` is rejected
for this joint lane; use `--chromium-only --headless` for the separate subset.
Both runners record final installed resource hashes and accurate `safari-test`
or `chromium-test` provenance; a test package never invokes native autostart.

The manually triggered Safari CI workflow requires a deliberately provisioned
`nudge-safari` self-hosted macOS GUI runner. Such a runner has not been verified
for this candidate. An unprovisioned/queued workflow provides no release evidence.

## Durable runtime packaging input

```sh
node scripts/package-runtime.mjs --out artifacts/safari/shared-runtime
```

Use a fresh output directory; existing output is preserved and rejected. The
script stages an explicit dependency/setup inventory, installs locked production
dependencies without lifecycle scripts, includes licenses and writes hashes.
It does not run setup or install a service. `--dependencies locked` produces
source/lock input only and explicitly does not claim a runnable installation.
Portable CLI relocation has an isolated implementation test; it is not proof of
native app uninstall, Finder launch, existing Chrome registration or signed
distribution. No Xcode scheme/archive command is claimed until an actual full
Xcode build has succeeded.

Apple references: [temporary extension installation](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
and [Safari 26 WebDriver extension automation](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
