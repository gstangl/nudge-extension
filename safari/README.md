# Safari native packaging boundary

`scripts/package-safari.mjs` creates the deterministic `Resources` directory
that a Safari Web Extension packager consumes. It is deliberately not an Xcode
project: the containing app and helper must be generated and built with the
currently installed Apple packager, then reviewed for its actual entitlements.

The shared JavaScript contract is ready for that integration:

- Safari resources omit Chrome `nativeMessaging`; their background worker never
  calls it.
- The bridge identity endpoint and store writer lease are the lifecycle boundary
  for a helper. A helper may implement only start, status and configuration; it
  must not arm an agent or run arbitrary commands.
- The durable bridge/store/CLI installation is outside an app bundle. Removing
  the app must not remove the shared runtime, store or Chrome setup.

This checkout has only Command Line Tools, not Xcode or the Safari Web Extension
packager. Therefore this directory is packaging input, not evidence of a native
app, native handler, signing, sandbox access, sleep/wake recovery or distribution.

## Required native experiment

On a Mac with full Xcode, stage release resources and invoke the installed
packager discovered through `xcrun`. Build the generated containing app with a
local development signature, enable it in Safari, and prove a cold bridge start
and `/.identity` status from a Finder launch. Capture the selected service API,
entitlements, Node discovery result and crash/restart behaviour in the evidence
ledger before adding an app project to source control.

Current Apple documentation calls the tool `safari-web-extension-packager`
(formerly `safari-web-extension-converter`). Both `xcrun --find` checks fail in
the audited Command Line Tools environment. The documented `--copy-resources`
option is important: generated projects otherwise reference the input files.
Do not let an Xcode experiment edit the shared Chrome resources.
See [Apple packaging](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

`SMAppService` is a candidate for an app-owned helper, not a selected/tested
architecture: Apple documents registration subject to user approval for helpers
inside the application bundle. It does not itself establish the durable shared
runtime/uninstall contract. The helper may disappear with Safari; shared CLI,
store and Chrome support may not. See [Apple service API](https://developer.apple.com/documentation/servicemanagement/smappservice).

`scripts/package-runtime.mjs` now stages the independently relocatable Node
runtime, CLI, canonical Skill/setup assets, production dependency and licenses.
Its isolated relocation proof does not register an app helper or test Finder's
environment. See [the build guide](../docs/SAFARI.md).
