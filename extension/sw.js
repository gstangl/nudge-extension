// Nudge service worker: one viewport capture -> dpr-correct crop (PNG) +
// downscaled full-viewport overview (JPEG). The content script does the posting.

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
  chrome.tabs.query({ url: ['http://localhost/*', 'http://127.0.0.1/*'] }, async (tabs) => {
    await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id).catch(() => {})))
    chrome.runtime.reload()
  })
})

// ---------- toolbar icon as status display ----------
// Lucide "circle" (24x24 viewBox, cx/cy 12, r 10), filled so it reads as a
// status dot at 16px. Colour semantics (2026-07-04):
//   grey  = overlay off
//   red   = overlay active but bridge NOT reachable
//   amber = bridge reachable but NO agent listening (prompt is stored, not acted on)
//   green = agent live — a prompt gets acted on NOW
// Badge = open prompt count (only while active).
function drawPinIcon(size, color) {
  const c = new OffscreenCanvas(size, size)
  const ctx = c.getContext('2d')
  ctx.scale(size / 24, size / 24)
  const circle = new Path2D('M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0') // Lucide circle
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.fill(circle)
  ctx.stroke(circle)
  return ctx.getImageData(0, 0, size, size)
}
function iconImages(color) { return { 16: drawPinIcon(16, color), 32: drawPinIcon(32, color), 48: drawPinIcon(48, color) } }
const GREEN = '#3fa34d', AMBER = '#d9a441', RED = '#d0342c', GREY = '#9a948b' // green/amber match the pill's dot
chrome.action.setIcon({ imageData: iconImages(GREY) }) // global default: grey (SW start)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'nudge-state' || !sender.tab?.id) return
  const tabId = sender.tab.id
  const color = !msg.active ? GREY : !msg.bridgeOk ? RED : !msg.agentLive ? AMBER : GREEN
  chrome.action.setIcon({ tabId, imageData: iconImages(color) })
  chrome.action.setBadgeBackgroundColor({ tabId, color })
  chrome.action.setBadgeText({ tabId, text: msg.active && msg.open > 0 ? String(msg.open) : '' })
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
  if (!info.url && info.status !== 'complete') return // title, favicon and audio updates are none of our business
  if (!LOCAL_TAB.test(tab?.url || '')) return
  chrome.tabs.sendMessage(tabId, { type: 'nudge-state-req' }).catch(() => { /* no content script (yet) */ })
})

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
    const port = chrome.runtime.connectNative('energy.roots.nudge')
    port.onMessage.addListener(() => port.disconnect()) // launcher answered — done
    port.onDisconnect.addListener(() => { /* host exits, bridge lives on */ })
  } catch { /* native host not installed */ }
}
ensureBridge() // SW start (browser start, extension reload, SW wake)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'nudge-bridge-down') ensureBridge()
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
