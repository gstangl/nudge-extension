// Nudge service worker: one viewport capture -> dpr-correct crop (PNG) +
// downscaled full-viewport overview (JPEG). The content script does the posting.
importScripts('platform.js')
const NUDGE_PLATFORM = globalThis.__nudgePlatform
importScripts('queue.js')
NudgeQueue.install(chrome, NUDGE_PLATFORM)
const randomToken = () => crypto.randomUUID().replaceAll('-', '')
// Session storage survives worker suspension, not browser restart. Without that
// API use memory only: lost continuity is safer than reusing persistent tab IDs.
const sourceStore = chrome.storage.session
let identity = null
let identityTail = Promise.resolve()
const tabEpochs = new Map()
const windowEpochs = new Map()
let focusEpoch = 0
const tokenOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value)
const routeOf = value => { const u = new URL(value); return u.origin + u.pathname + u.hash }
const serializedIdentity = work => {
  const operation = identityTail.then(work)
  identityTail = operation.catch(() => {})
  return operation
}
async function readIdentity() {
  if (identity) return identity
  const stored = sourceStore ? (await sourceStore.get('nudgeBrowserIdentity')).nudgeBrowserIdentity : null
  identity = stored?.version === 1 && tokenOK(stored.session) && stored.tabs && typeof stored.tabs === 'object'
    ? stored : { version: 1, session: randomToken(), tabs: {} }
  return identity
}
async function saveIdentity(next) {
  if (sourceStore) await sourceStore.set({ nudgeBrowserIdentity: next })
  identity = next
}
function validateSender(sender, documentToken) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.tab?.windowId) || sender.frameId > 0 || !tokenOK(documentToken)) throw new Error('missing or invalid tab/document identity')
  if (sender.documentLifecycle && sender.documentLifecycle !== 'active') throw new Error('source document is not active')
  const url = new URL(sender.url || sender.tab.url)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('source is not a local top-level document')
}
async function proveCurrentDocument(sender, documentToken) {
  // `loading` also occurs for same-document SPA/hash navigation. Probe the
  // current top-level content script rather than mistaking that event for proof
  // that its document died. Do not target the claimed documentId here: that
  // could ask a stale document to vouch for itself instead of the current frame.
  let timer
  try {
    const current = await Promise.race([
      chrome.tabs.sendMessage(sender.tab.id, { type: 'nudge-document-current' }, { frameId: 0 }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('current document probe timed out')), 1500) }),
    ])
    if (current?.document !== documentToken || routeOf(current.url) !== routeOf(sender.url || sender.tab.url)) throw new Error('source is not the current top-level document')
  } finally { clearTimeout(timer) }
}
function sourceFor(sender, documentToken, register = false) {
  validateSender(sender, documentToken)
  const epoch = captureEpoch(sender)
  return serializedIdentity(async () => {
    const current = await readIdentity()
    let record = current.tabs[sender.tab.id]
    if (register) {
      if (record?.document && !record.navigationPending && (record.document !== documentToken || (record.runtimeDocument && record.runtimeDocument !== sender.documentId))) throw new Error('source successor requires a navigation boundary')
      await proveCurrentDocument(sender, documentToken)
      if (epoch !== captureEpoch(sender)) throw new Error('source changed during document registration')
      record = { tab: record?.tab || randomToken(), document: documentToken, runtimeDocument: sender.documentId || null, navigationPending: false }
      await saveIdentity({ ...current, tabs: { ...current.tabs, [sender.tab.id]: record } })
    }
    if (!record || record.document !== documentToken || (record.runtimeDocument && record.runtimeDocument !== sender.documentId)) throw new Error('capture source document is no longer registered')
    if (!register) {
      await proveCurrentDocument(sender, documentToken)
      if (epoch !== captureEpoch(sender)) throw new Error('source changed during document verification')
      if (record.navigationPending) await saveIdentity({ ...current, tabs: { ...current.tabs, [sender.tab.id]: { ...record, navigationPending: false } } })
    }
    if (epoch !== captureEpoch(sender)) throw new Error('source changed while persisting document identity')
    return { browser: NUDGE_PLATFORM.browser, session: current.session, tab: record.tab, document: record.document }
  })
}
chrome.tabs.onActivated.addListener(({ windowId }) => windowEpochs.set(windowId, (windowEpochs.get(windowId) || 0) + 1))
chrome.windows?.onFocusChanged?.addListener(() => { focusEpoch++ })
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url && change.status !== 'loading') return
  tabEpochs.set(tabId, (tabEpochs.get(tabId) || 0) + 1)
  serializedIdentity(async () => {
    const current = await readIdentity()
    if (!current.tabs[tabId]) return
    await saveIdentity({ ...current, tabs: { ...current.tabs, [tabId]: { ...current.tabs[tabId], navigationPending: true } } })
  }).catch(error => console.warn('[groundworks-nudge] could not invalidate document identity', error))
})
chrome.tabs.onRemoved.addListener(tabId => {
  tabEpochs.set(tabId, (tabEpochs.get(tabId) || 0) + 1)
  serializedIdentity(async () => {
    const current = await readIdentity()
    const tabs = { ...current.tabs }
    const closed = tabs[tabId]
    delete tabs[tabId]
    await saveIdentity({ ...current, tabs })
    if (closed) await chrome.storage.local?.remove?.(`nudgeDraftRetry-${closed.tab}`)
  }).catch(error => console.warn('[groundworks-nudge] could not remove tab identity', error))
})
// Private retry payloads are per-tab, not an unbounded second offline queue.
// Queue entries survive independently. Retain same-session ambiguous retries;
// collect prior-browser-session leftovers and entries beyond the retry horizon.
if (chrome.storage.local?.get && chrome.storage.local?.remove) serializedIdentity(async () => {
  const current = await readIdentity()
  const stored = await chrome.storage.local.get(null)
  const keys = Object.keys(stored).filter(key => {
    if (!key.startsWith('nudgeDraftRetry-')) return false
    const payload = stored[key]?.payload
    const at = Date.parse(payload?.submissionCreatedAt || '')
    return payload?.browserSource?.session !== current.session || (Number.isFinite(at) && Date.now() > at + 7 * 24 * 3600e3 + 5 * 60_000)
  })
  if (keys.length) await chrome.storage.local.remove(keys)
}).catch(error => console.warn('[groundworks-nudge] retry cleanup deferred', error))
const captureEpoch = sender => `${tabEpochs.get(sender.tab.id) || 0}:${windowEpochs.get(sender.tab.windowId) || 0}:${focusEpoch}`
async function captureContext(sender, expected) {
  const epoch = captureEpoch(sender)
  const source = await sourceFor(sender, expected?.document)
  if (['session', 'tab', 'document'].some(key => source[key] !== expected?.[key])) throw new Error('capture source identity changed')
  const [active] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId })
  if (!active || active.id !== sender.tab.id) throw new Error('capture deferred: source tab is inactive')
  if (chrome.windows?.get && !(await chrome.windows.get(sender.tab.windowId)).focused) throw new Error('capture deferred: source window is unfocused')
  const route = routeOf(sender.url || sender.tab.url)
  if (routeOf(active.url) !== route) throw new Error('capture rejected: source route changed')
  if (epoch !== captureEpoch(sender)) throw new Error('capture deferred: source changed during eligibility check')
  return { epoch, route, source }
}
async function validateCapture(sender, expected, before) {
  const after = await captureContext(sender, expected)
  if (before.epoch !== after.epoch || before.route !== after.route) throw new Error('capture rejected: navigation, activation or focus changed during capture')
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'nudge-source-register') return
  Promise.resolve().then(() => sourceFor(sender, msg.document, true))
    .then(source => sendResponse({ ok: true, source }))
    .catch(error => sendResponse({ ok: false, error: String(error) }))
  return true
})
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'nudge-capture-ready') return
  ;(async () => {
    try {
      await captureContext(sender, msg.browserSource)
      sendResponse({ ok: true })
    } catch (error) { sendResponse({ ok: false, error: String(error) }) }
  })()
  return true
})

const toDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(r.result)
  r.onerror = () => rej(r.error)
  r.readAsDataURL(blob)
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'nudge-capture') return
  ;(async () => {
    try {
      const before = await captureContext(sender, msg.browserSource)
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
      // The pixels are in hand — the page may show its chrome again RIGHT NOW.
      // Everything below (decode, crop, scale, encode) is the slow part and does
      // not need the toolbar hidden. Without this signal the overlay stayed
      // hidden for the whole round-trip, and for a capture that never settles
      // (debugger attached) it stayed hidden forever (2026-07-29).
      // echo the caller's token: captures can overlap (the bridge-triggered
      // after-shot can land inside a lasso capture), and one grab must not clear
      // the other's overlay bookkeeping
      chrome.tabs.sendMessage(sender.tab.id, { type: 'nudge-grabbed', token: msg.token }).catch(() => { /* tab navigated away */ })
      await validateCapture(sender, msg.browserSource, before)
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob())
      // Don't trust the page's devicePixelRatio: emulation/zoom can make the captured
      // bitmap scale differ. Derive the real scale from bitmap vs viewport size.
      const scaleX = msg.vw ? bmp.width / msg.vw : (msg.dpr || 1)
      const scaleY = msg.vh ? bmp.height / msg.vh : scaleX
      const sx = Math.max(0, Math.round(msg.rect.x * scaleX))
      const sy = Math.max(0, Math.round(msg.rect.y * scaleY))
      const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(msg.rect.w * scaleX)))
      const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(msg.rect.h * scaleY)))
      const cropCanvas = new OffscreenCanvas(sw, sh)
      cropCanvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
      const crop = await toDataUrl(await cropCanvas.convertToBlob({ type: 'image/png' }))
      // full-viewport overview, downscaled - spatial context for the model
      const fScale = Math.min(1, 1200 / bmp.width)
      const fullCanvas = new OffscreenCanvas(Math.round(bmp.width * fScale), Math.round(bmp.height * fScale))
      fullCanvas.getContext('2d').drawImage(bmp, 0, 0, fullCanvas.width, fullCanvas.height)
      const full = await toDataUrl(await fullCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 }))
      await validateCapture(sender, msg.browserSource, before)
      sendResponse({ ok: true, dataUrl: crop, fullDataUrl: full })
    } catch (e) {
      sendResponse({ ok: false, error: String(e) })
    }
  })()
  return true // keep the message channel open for the async response
})

// Dev auto-reload: the bridge watches the extension dir and signals over WS ->
// content script forwards here -> extension reloads itself, then refreshes the
// localhost tabs so the new content script is active. Zero manual clicks.
// crx-hotreload pattern: refresh the tabs FIRST, then reload the extension.
// AWAIT the tab reloads before chrome.runtime.reload(): firing them and tearing
// the extension down in the same tick raced — the reload often won out, the tab
// never navigated, and its content script was left orphaned (dead overlay that
// swallows clicks, no popover). Awaiting lets each tab's navigation commit
// first; the reloaded tab then injects a fresh content script under the new
// extension. (Defence in depth: an orphaned script now also self-detaches.)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'nudge-dev-reload') return
  if (!NUDGE_PLATFORM.developmentReload) return
  chrome.tabs.query({ url: ['http://localhost/*', 'http://127.0.0.1/*'] }, async (tabs) => {
    await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id).catch(() => {})))
    chrome.runtime.reload()
  })
})

// ---------- toolbar icon as status display ----------
// Lucide "crosshair" (24x24 viewBox). It gives Nudge a recognisable visual
// identity while its colour still communicates connection state:
//   grey  = overlay off
//   red   = overlay active but bridge NOT reachable
//   amber = bridge reachable but NO agent listening (prompt is stored, not acted on)
//   green = agent live — a prompt gets acted on NOW
// Badge = open prompt count (only while active).
function drawCrosshairIcon(size, color) {
  const c = new OffscreenCanvas(size, size)
  const ctx = c.getContext('2d')
  ctx.scale(size / 24, size / 24)
  const centre = new Path2D('M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0')
  const arms = new Path2D('M3 12h3m12 0h3M12 3v3m0 12v3')
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke(centre)
  ctx.stroke(arms)
  return ctx.getImageData(0, 0, size, size)
}
// Roster updates can report the same visible state hundreds of times. Keep the
// four color variants and skip identical per-tab action writes, so status work
// cannot starve the worker's submission/capture messages.
const iconCache = new Map()
function iconImages(color) {
  if (!iconCache.has(color)) iconCache.set(color, { 16: drawCrosshairIcon(16, color), 32: drawCrosshairIcon(32, color), 48: drawCrosshairIcon(48, color) })
  return iconCache.get(color)
}
const tabActionStates = new Map()
const GREEN = '#3fa34d', AMBER = '#d9a441', RED = '#d0342c', GREY = '#9a948b' // green/amber match the pill's dot
chrome.action.setIcon({ imageData: iconImages(GREY) }).catch(() => {}) // global default: grey (SW start)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'nudge-state' || !sender.tab?.id) return
  const tabId = sender.tab.id
  const color = !msg.active ? GREY : !msg.bridgeOk ? RED : !msg.agentLive ? AMBER : GREEN
  const text = msg.active && msg.open > 0 ? String(msg.open) : ''
  const previous = tabActionStates.get(tabId)
  if (previous?.color === color && previous.text === text) return
  const state = { color, text }
  tabActionStates.set(tabId, state)
  const retry = () => {
    // A late rejection from an older update must not invalidate a newer one.
    if (tabActionStates.get(tabId) === state) tabActionStates.delete(tabId)
  }
  try {
    Promise.all([
      chrome.action.setIcon({ tabId, imageData: iconImages(color) }),
      chrome.action.setBadgeBackgroundColor({ tabId, color }),
      chrome.action.setBadgeText({ tabId, text }),
    ]).catch(retry)
  } catch { retry() }
})
// Chrome resets a tab's icon AND badge to the default on EVERY navigation —
// and the default is grey, i.e. "not active". That includes the pure history
// navigation of an SPA router (history.pushState: no reload, no hashchange, the
// content script notices nothing and reports nothing). The icon then sat on
// grey while the toolbar kept running top right — two displays contradicting
// each other (2026-08-05, estimate/#/ersteinschaetzung).
// So re-fetch the state after every navigation; the tab knows it.
const LOCAL_TAB = /^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'loading' || info.status === 'complete') tabActionStates.delete(tabId)
  if (!info.url && info.status !== 'complete') return // title, favicon and audio updates are none of our business
  if (!LOCAL_TAB.test(tab?.url || '')) return
  chrome.tabs.sendMessage(tabId, { type: 'nudge-state-req' }).catch(() => { /* no content script (yet) */ })
})
chrome.tabs.onRemoved.addListener(tabId => tabActionStates.delete(tabId))

// ---------- bridge lifecycle via native messaging ----------
// Chrome spawns the registered native host (a thin launcher) which starts the
// bridge DETACHED if it is not running. Called on SW startup and whenever a
// content script reports the bridge unreachable — the extension heals the
// bridge itself, no agent session or terminal needed. If no host is registered
// (setup not run yet), this fails silently and the classic paths still work.
let lastEnsure = 0
function ensureBridge() {
  const now = Date.now()
  if (now - lastEnsure < 5000) return // don't hammer while a tab retries
  lastEnsure = now
  try {
    const port = chrome.runtime.connectNative('dev.groundworks.nudge')
    port.onMessage.addListener(() => port.disconnect()) // launcher answered — done
    port.onDisconnect.addListener(() => { /* host exits, bridge lives on */ })
  } catch { /* native host not installed */ }
}
if (NUDGE_PLATFORM.nativeAutostart) ensureBridge() // never reaches a Safari test/release package
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'nudge-bridge-down' && NUDGE_PLATFORM.nativeAutostart) ensureBridge()
})

async function toggle(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'nudge-toggle' }) } catch { /* no content script on this tab */ }
}
chrome.action.onClicked.addListener((tab) => tab?.id && toggle(tab.id))
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-nudge') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) toggle(tab.id)
})
