# Safari port: build and verification guide

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
app. Xcode, an enabled Safari extension, signing and a clean-install machine are
external acceptance prerequisites. See the evidence ledger for the current
candidate-specific state.

## Temporary Safari installation (developer testing)

This is the only supported installation path until the packaged macOS app has
its own acceptance evidence. It is for a developer's own local test only; Safari
removes the extension after 24 hours or when Safari quits.

1. Install the bridge dependencies once: `cd bridge && npm ci`.
2. Stage a separate test resource directory and start a separately scoped
   bridge/store:

   ```sh
   node scripts/package-safari.mjs --mode test --bridge-port 4820 --out artifacts/safari/temporary-extension
   NUDGE_PORT=4820 NUDGE_STORE="$PWD/artifacts/safari/temporary-store" node bridge/bridge.mjs
   ```

3. In Safari, open **Safari > Settings > Developer**. Enable unsigned extensions
   if Safari asks, click **Add Temporary Extension…**, and select
   `artifacts/safari/temporary-extension`.
4. Open **Safari > Settings > Extensions**, select Groundworks Nudge, enable
   it, and grant it **Website Access: All Websites** for developer testing. A
   toolbar entry alone does not prove that Safari may inject the page UI.
5. When the staged directory changes, reload Groundworks Nudge from that pane
   if Safari offers a reload control; otherwise remove and add the same
   temporary-extension directory again. Reload the test tab afterwards.
6. Open `http://localhost:4820/demo`. Test Pick, Freeform, a sent prompt and a
   resolve/after-image cycle. The test resource's worker does not launch a
   native host; the separately started bridge is expected.

Safari may require the Developer tab to be enabled first in its settings. Do
not tell end users to use this path: it is intentionally temporary and does not
provide native lifecycle, signed updates or distribution.

## Intended user installation

Do not publish user-facing Safari installation instructions until there is a
signed containing app and the acceptance ledger records native startup,
update/uninstall and clean-machine evidence. The future instructions should be:

1. Download and move the signed Groundworks Nudge app to Applications.
2. Open it once; the app reports extension/setup state truthfully.
3. Enable Groundworks Nudge in Safari Settings > Extensions and grant access to
   the local development sites the person uses.
4. Start or verify the bridge from the app, then use `/groundworks-nudge` in
   the chosen agent session.

Until those gates pass, say plainly: **Safari developer preview, not a supported
end-user installation.**

## Validation levels

| Level | Current evidence |
|---|---|
| Resource staging | Tested by `node test/safari-e2e.mjs --smoke` |
| Safari extension behavior | Toolbar entry observed; page injection and functional behavior remain unverified |
| Native app/helper lifecycle | Not implemented or tested |
| Signed distribution | Not prepared or tested |
