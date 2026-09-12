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
