// Shared capability surface. Packaging may set __nudgePlatform before this file
// runs; an unpacked Chromium extension uses these conservative defaults.
;(() => {
  const preset = globalThis.__nudgePlatform || {}
  globalThis.__nudgePlatform = Object.freeze({
    browser: preset.browser || 'chromium',
    nativeAutostart: preset.nativeAutostart !== false,
    developmentReload: preset.developmentReload !== false,
    bridgePort: Number.isInteger(preset.bridgePort) ? preset.bridgePort : null,
    sourceBoundEvidence: preset.sourceBoundEvidence === true,
  })
  // Safari exposes WebExtension APIs as `browser` on supported releases. Keep
  // existing Chromium code plain JavaScript while using the same API object.
  if (!globalThis.chrome && globalThis.browser) globalThis.chrome = globalThis.browser
})()
