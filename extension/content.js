// Roots Nudge content script — UI prompting, fire-and-forget.
// Pin a PROMPT onto the running UI: element picker with layer chips (pick the
// ancestor you meant) or freehand lasso, composer, send — nothing stays on the
// page (no persistent markers). Feedback: Lucide-iconed feed chips top right
// (send/queued/done/connection events), pill badge = prompts in flight on this
// route, status dot/icon = live chain state (agent listening).
// Resolve-with-proof stays invisible: on resolve the bridge asks this script to
// re-capture the prompt's region as the after-screenshot (evidence loop).
// Context per prompt: selector (@medv/finder), source hint, outerHTML, computed
// styles, console + network errors, dual screenshots, author.
;(() => {
  if (window.top !== window) return // top frame only
  const HTTP = 'http://localhost:4700'
  const WS = 'ws://localhost:4700'
  const ACCENT = '#b45a38'

  // ---------- shadow root + styles ----------
  const host = document.createElement('div')
  host.id = '__roots-nudge-host'
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
  const root = host.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(host)

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(globalThis.__nudgeCss) // styles.js, loaded before this script
  root.adoptedStyleSheets = [sheet]

  const el = (tag, cls, html) => { const d = document.createElement(tag); d.className = cls; if (html) d.innerHTML = html; root.appendChild(d); return d }
  // official Lucide glyphs: mouse-pointer + circle-dashed
  const ICON_PICK = '<svg viewBox="0 0 24 24"><path d="M12.586 12.586 19 19"/><path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/></svg>'
  const ICON_DRAW = '<svg viewBox="0 0 24 24"><path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/></svg>'
  // official Lucide grip-vertical as the drag handle — same stroke rendering
  // path as the neighbour icons (a hand-rolled 10x16 viewBox rendered blurry)
  const GRIP = '<svg viewBox="0 0 24 24"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>'
  const pill = el('div', 'pill',
    `<span class="grip" title="Move">${GRIP}</span><span class="status"></span><span class="count"></span><span class="sep"></span><button class="btn-pick">${ICON_PICK}<span>Pick</span></button><button class="btn-draw">${ICON_DRAW}<span>Freeform</span></button><span class="sep who-sep"></span><span class="who" title=""></span>`)
  const hl = el('div', 'hl', '<span class="chip"></span>')
  const draw = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  draw.setAttribute('class', 'draw')
  root.appendChild(draw)
  const composer = el('div', 'composer',
    '<div class="tip"></div><div class="inner"><div class="layers"></div><div class="meta"></div><textarea placeholder="Nudge… (⌘↩ send · Esc cancel · ⇧click add element · empty = mark only)"></textarea><div class="row"><button class="cancel">Cancel</button><button class="send">Send</button></div></div>')
  const feed = el('div', 'feed')
  // queue popover: click the pill badge -> read-only list of this route's open
  // prompts (what the count MEANS). No management UI on the page — resolving
  // stays the agent's job; this is a peek, in the composer's midnight language.
  const queue = el('div', 'queue', '<div class="q-head"></div><div class="q-list"></div>')
  const whoMenu = el('div', 'who-menu', '<div class="q-head">Connected sessions — click to hand over</div><div class="w-list"></div>')
  const dots = el('div', 'dots') // open-prompt dots: amber status per marked element

  // DIN Var, self-contained: @font-face cannot load from a shadow-root adopted
  // sheet, so declare it once at DOCUMENT level; the woff2 ships WITH the
  // extension (web_accessible_resources) — no dependency on the host page.
  if (!document.getElementById('__roots-nudge-font')) {
    const f = document.createElement('style')
    f.id = '__roots-nudge-font'
    f.textContent = `@font-face { font-family: "Roots Nudge DIN"; src: url("${chrome.runtime.getURL('fonts/din-var.woff2')}") format("woff2-variations"); font-weight: 100 900; font-display: swap; }`
    document.head.appendChild(f)
  }
  const ta = composer.querySelector('textarea')
  const btnPick = pill.querySelector('.btn-pick')
  const btnDraw = pill.querySelector('.btn-draw')
  pill.querySelector('.count').addEventListener('click', (e) => {
    e.stopPropagation()
    queue.classList.contains('on') ? hideQueue() : showQueue()
  })
  const layersRow = composer.querySelector('.layers')

  let author = ''
  chrome.storage.sync.get('nudgeAuthor', (v) => { author = v.nudgeAuthor || '' })

  // ---------- state: off | idle | picking | drawing | composing ----------
  let mode = 'off'
  let picked = null // { el, rect, selector, source, stroke?, chain? }
  let strokePts = []
  let strokePath = null

  function clearStroke() { draw.innerHTML = ''; strokePts = []; strokePath = null }
  function setMode(next) {
    mode = next
    pill.style.display = next === 'off' ? 'none' : 'flex'
    dots.style.display = next === 'off' ? 'none' : 'block'
    btnPick.classList.toggle('active', next === 'picking')
    btnDraw.classList.toggle('active', next === 'drawing')
    draw.classList.toggle('on', next === 'drawing')
    if (next !== 'picking' && next !== 'composing') hl.classList.remove('on')
    if (next !== 'composing') { composer.style.display = 'none'; picked = null; clearStroke(); clearMulti() }
    document.documentElement.style.cursor = next === 'picking' ? 'crosshair' : ''
    updatePill() // toolbar icon reflects on/off
  }
  btnPick.addEventListener('click', () => setMode(mode === 'picking' ? 'idle' : 'picking'))
  btnDraw.addEventListener('click', () => setMode(mode === 'drawing' ? 'idle' : 'drawing'))

  // ---------- movable toolbar: drag via the grip handle, position persists ----------
  const grip = pill.querySelector('.grip')
  function placePill(x, y) {
    const w = pill.offsetWidth || 200, h = pill.offsetHeight || 36
    const cx = Math.min(Math.max(4, x), window.innerWidth - w - 4)
    const cy = Math.min(Math.max(4, y), window.innerHeight - h - 4)
    Object.assign(pill.style, { left: cx + 'px', top: cy + 'px', right: 'auto', bottom: 'auto' })
  }
  chrome.storage.local.get('nudgePillPos', ({ nudgePillPos }) => {
    if (nudgePillPos) requestAnimationFrame(() => placePill(nudgePillPos.x, nudgePillPos.y))
  })
  let dragOff = null
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const r = pill.getBoundingClientRect()
    dragOff = { x: e.clientX - r.left, y: e.clientY - r.top }
    grip.classList.add('dragging')
    try { grip.setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
  })
  grip.addEventListener('pointermove', (e) => {
    if (!dragOff) return
    placePill(e.clientX - dragOff.x, e.clientY - dragOff.y)
  })
  grip.addEventListener('pointerup', () => {
    if (!dragOff) return
    dragOff = null
    grip.classList.remove('dragging')
    const r = pill.getBoundingClientRect()
    chrome.storage.local.set({ nudgePillPos: { x: r.left, y: r.top } })
  })
  addEventListener('resize', () => { // keep the pill inside the viewport
    const r = pill.getBoundingClientRect()
    if (pill.style.left) placePill(r.left, r.top)
  }, { passive: true })

  // ---------- shared: selector, source hint, styles ----------
  const inOverlay = (e) => e.composedPath().includes(host)
  function sourceHint(target) {
    const carrier = target.closest('[data-astro-source-file],[data-insp-path]')
    if (!carrier) return null
    if (carrier.dataset.astroSourceFile)
      return carrier.dataset.astroSourceFile + (carrier.dataset.astroSourceLoc ? ':' + carrier.dataset.astroSourceLoc : '')
    return carrier.dataset.inspPath || null
  }
  // cheap structural path — no uniqueness search. Used for the HOVER chip (runs
  // per mousemove) and as the fallback when the finder fails.
  function fastPath(node) {
    if (node.id) return '#' + CSS.escape(node.id)
    const parts = []
    let cur = node
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break }
      let part = cur.tagName.toLowerCase()
      const cls = [...cur.classList].slice(0, 2)
      if (cls.length) part += '.' + cls.map(CSS.escape).join('.')
      const same = cur.parentElement ? [...cur.parentElement.children].filter(s => s.tagName === cur.tagName) : []
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`
      parts.unshift(part)
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }
  // shortest UNIQUE selector via vendored @medv/finder (up to 300ms search) —
  // only at commit points (click/retarget/lasso), never in the mousemove path
  function cssPath(node) {
    try { return window.__nudgeFinder(node, { timeoutMs: 300 }) } catch { return fastPath(node) }
  }
  // computed styles, categorized (stagewise pattern) — the agent reads
  // "typography vs box vs surface" faster than a flat list
  const STYLE_KEYS = {
    typography: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign'],
    box: ['display', 'padding', 'margin', 'width', 'height', 'gap', 'borderRadius'],
    surface: ['backgroundColor', 'border', 'boxShadow', 'opacity'],
  }
  function pickStyles(node) {
    const cs = getComputedStyle(node)
    const out = {}
    for (const [group, keys] of Object.entries(STYLE_KEYS)) {
      const g = {}
      for (const k of keys) {
        const v = cs[k]
        if (v && v !== 'normal' && v !== 'auto' && v !== 'none' && v !== '0px none rgb(0, 0, 0)' && v !== '1') g[k] = v
      }
      if (Object.keys(g).length) out[group] = g
    }
    return out
  }
  // robust second locator (stagewise pattern): CSS selectors break when classes
  // change; a structural xpath survives styling refactors
  function xpathOf(node) {
    const parts = []
    let cur = node
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 12) {
      let i = 1
      for (let s = cur.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === cur.tagName) i++
      parts.unshift(`${cur.tagName.toLowerCase()}[${i}]`)
      cur = cur.parentElement
    }
    return '/html/' + parts.join('/')
  }
  const textOf = (node) => (node?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300)
  const elAt = (x, y) => document.elementsFromPoint(x, y).find(n => n !== host && !host.contains(n) && n.nodeType === 1)
  const shortLabel = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : (n.classList[0] ? '.' + n.classList[0] : ''))

  // ---------- element picking ----------
  function onMove(e) {
    if (mode !== 'picking' || inOverlay(e)) { if (mode === 'picking') hl.classList.remove('on'); return }
    const t = e.target
    if (!(t instanceof Element)) return
    // hover chip = cheap label only; the unique finder selector is computed on click
    highlight(t.getBoundingClientRect(), sourceHint(t) || fastPath(t))
  }
  function highlight(r, label) {
    // one persistent node, only inline geometry changes -> the CSS transition
    // makes the box GLIDE between elements instead of jumping (frontman pattern)
    hl.classList.add('on')
    hl.classList.toggle('flip', r.top < 30) // no room above -> chip flips below
    Object.assign(hl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    hl.querySelector('.chip').textContent = label ?? ''
  }
  // ---------- multi-selection (Shift+Klick, stagewise pattern) ----------
  // Shift collects elements into ONE mark/prompt ("tausche diese beiden");
  // a plain click resets to single mode. Outlines are transient — they exist
  // only while composing (fire-and-forget: nothing survives the send/Esc).
  let multi = [] // [{ el, selector, source, outline }]
  function multiOutlineFor(el) {
    const o = document.createElement('div')
    o.className = 'hl-multi'
    root.appendChild(o)
    return o
  }
  function repositionMulti() {
    for (const m of multi) {
      const r = m.el.getBoundingClientRect()
      Object.assign(m.outline.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    }
  }
  function clearMulti() {
    for (const m of multi) m.outline.remove()
    multi = []
    removeEventListener('scroll', repositionMulti, true)
    removeEventListener('resize', repositionMulti)
  }
  function addToMulti(el) {
    const i = multi.findIndex(m => m.el === el)
    if (i >= 0) { multi[i].outline.remove(); multi.splice(i, 1) } // shift on selected = toggle off
    else {
      if (multi.length === 0) { addEventListener('scroll', repositionMulti, true); addEventListener('resize', repositionMulti) }
      multi.push({ el, selector: cssPath(el), source: sourceHint(el), outline: multiOutlineFor(el) })
    }
    repositionMulti()
  }
  function multiMeta() {
    composer.querySelector('.meta').textContent =
      `${multi.length} element${multi.length === 1 ? '' : 's'} · ` + multi.map(m => m.selector).join(' · ').slice(0, 90)
    layersRow.style.display = 'none' // layer chips are a single-pick affordance
  }

  // PICK fires on POINTERDOWN, not click (DevTools-inspector pattern): on live
  // pages a mousedown can trigger re-renders (RTC comment rail, editor focus
  // dances) that destroy the target before mouseup — the click event then never
  // arrives (bit Gerald 2026-07-05 on the v2 editor's comment rail, whose
  // ProseMirror layer additionally overlays the rail area). preventDefault on
  // pointerdown also suppresses the whole downstream mouse cascade — pick mode
  // takes the interaction over completely.
  function onClick(e) {
    if (mode !== 'picking' || inOverlay(e) || !e.isPrimary) return
    e.preventDefault(); e.stopPropagation()
    const t = e.target
    if (!(t instanceof Element)) return
    // The PICK is the mark — no send needed, and for ELEMENTS no screenshot:
    // selector + xpath + innerText + outerHTML + styles fully identify a DOM
    // node. Screenshots are exclusive to the Freeform (lasso) tool.
    if (e.shiftKey) {
      // Shift starts/extends a multi-selection (Finder/Figma convention:
      // plain click = ONE fresh element, only Shift collects — 0.10.0 aligned
      // code with the documented behaviour)
      addToMulti(t)
      if (!multi.length) { setMode('idle'); return } // toggled the last one away
      picked = { el: multi[0].el, rect: multi[0].el.getBoundingClientRect(), selector: multi[0].selector, source: multi[0].source }
      postSelection(null, { keepShot: false })
      if (composer.style.display !== 'block') openComposer(picked.rect)
      multiMeta()
      mode = 'picking' // keep collecting despite the open composer
      return
    }
    clearMulti() // plain click resets any active multi-selection to a single pick
    // single pick: ancestor chain for the layer chips
    const chain = [t]
    let cur = t.parentElement
    while (cur && cur !== document.body && chain.length < 5) { chain.push(cur); cur = cur.parentElement }
    retarget(t, chain)
    postSelection(null, { keepShot: false }) // drops any stale screenshot for this mark
    openComposer(picked.rect)
  }
  function retarget(node, chain) {
    const fromChip = !!picked && !chain
    picked = {
      el: node, chain: chain || picked?.chain,
      rect: node.getBoundingClientRect(), selector: cssPath(node), source: sourceHint(node),
    }
    highlight(picked.rect)
    composer.querySelector('.meta').textContent = picked.source || picked.selector
    renderLayerChips()
    // chip switch = the mark changed; update the selection (no new screenshot —
    // the pick-time crop with padding covers the ancestor region well enough)
    if (fromChip) postSelection(null)
  }
  // publish "what is marked right now" to the bridge (latest-wins, fire-and-forget).
  // keepShot: false marks prior screenshots stale (fresh pick, new shot incoming);
  // true (default) lets the bridge keep them (chip retarget, same region).
  // full DOM context for one element (shared by selection, pins, multi targets)
  function elementContext(el, selector, source) {
    return {
      selector, source: source ?? sourceHint(el),
      xpath: xpathOf(el),
      innerText: textOf(el),
      outerHTML: el.outerHTML.slice(0, 1200),
      styles: pickStyles(el),
    }
  }
  const multiTargets = () => multi.length > 1 ? multi.map(m => elementContext(m.el, m.selector, m.source)) : undefined

  function postSelection(shot, { keepShot = true } = {}) {
    const t = picked
    if (!t) return
    const r = t.rect
    void fetch(HTTP + '/selection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: location.href, title: document.title,
        selector: t.selector, source: t.source,
        xpath: t.el ? xpathOf(t.el) : null,
        innerText: textOf(t.el),
        outerHTML: t.el?.outerHTML?.slice(0, 1200) || '',
        styles: t.el ? pickStyles(t.el) : null,
        targets: multiTargets(),
        rect: { x: r.left, y: r.top, w: r.width || (r.right - r.left), h: r.height || (r.bottom - r.top) },
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        screenshot: shot?.dataUrl || undefined,
        screenshotFull: shot?.fullDataUrl || undefined,
        keepShot,
      }),
    }).catch(() => { /* bridge down — icon shows it */ })
  }
  function renderLayerChips() {
    if (!picked?.chain || picked.chain.length < 2) { layersRow.style.display = 'none'; return }
    layersRow.style.display = 'flex'
    layersRow.innerHTML = ''
    for (const node of picked.chain) {
      const b = document.createElement('button')
      b.textContent = shortLabel(node)
      b.classList.toggle('active', node === picked.el)
      b.addEventListener('click', () => retarget(node))
      layersRow.appendChild(b)
    }
  }

  // ---------- freehand lasso (Cursor-Design-Mode-style circling) ----------
  let drawPointerId = null
  draw.addEventListener('pointerdown', (e) => {
    if (mode !== 'drawing' || !e.isPrimary) return
    e.preventDefault()
    drawPointerId = e.pointerId
    strokePts = [[e.clientX, e.clientY]]
    strokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    draw.innerHTML = ''
    draw.appendChild(strokePath)
    // capture is best-effort: the svg covers the viewport anyway, and synthetic
    // pointer events (tests) can make setPointerCapture throw
    try { draw.setPointerCapture(e.pointerId) } catch { /* keep drawing */ }
  })
  draw.addEventListener('pointermove', (e) => {
    // accept only the pointer that started the stroke, with the button still held -
    // stray hover events from other sources must not pollute the polyline
    if (mode !== 'drawing' || !strokePath || e.pointerId !== drawPointerId || !(e.buttons & 1)) return
    const [lx, ly] = strokePts[strokePts.length - 1]
    if (Math.hypot(e.clientX - lx, e.clientY - ly) < 4) return // thin the polyline
    strokePts.push([e.clientX, e.clientY])
    strokePath.setAttribute('d', 'M' + strokePts.map(p => p.join(' ')).join(' L '))
  })
  draw.addEventListener('pointerup', (e) => {
    if (e.pointerId !== drawPointerId) return
    drawPointerId = null
    if (mode !== 'drawing' || strokePts.length < 3) { clearStroke(); return }
    strokePath.setAttribute('d', strokePath.getAttribute('d') + ' Z') // close the lasso
    const xs = strokePts.map(p => p[0]), ys = strokePts.map(p => p[1])
    const bbox = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
    bbox.width = bbox.right - bbox.left; bbox.height = bbox.bottom - bbox.top
    // context: topmost real element at the lasso centroid
    const cx = bbox.left + bbox.width / 2, cy = bbox.top + bbox.height / 2
    const centerEl = elAt(cx, cy) || document.body
    picked = {
      el: centerEl, rect: bbox, selector: cssPath(centerEl), source: sourceHint(centerEl),
      stroke: strokePts.map(([x, y]) => [Math.round(x), Math.round(y)]),
    }
    // the circled region is the mark, send stays optional (same as element picks)
    postSelection(null, { keepShot: false })
    void (async () => {
      const shot = await captureRegion(bbox)
      openComposer(bbox)
      if (shot) postSelection(shot)
    })()
  })

  // ---------- composer ----------
  function openComposer(anchorRect) {
    mode = 'composing'
    document.documentElement.style.cursor = ''
    btnPick.classList.remove('active'); btnDraw.classList.remove('active')
    draw.classList.remove('on')
    composer.querySelector('.meta').textContent = (picked.stroke ? 'Region · ' : '') + (picked.source || picked.selector)
    if (picked.stroke) layersRow.style.display = 'none'
    else renderLayerChips()
    // place BESIDE the mark, tip pointing back at it (right side preferred)
    const W = 340, GAP = 14
    const fitsRight = anchorRect.right + GAP + W <= window.innerWidth - 8
    const left = fitsRight ? anchorRect.right + GAP : Math.max(8, anchorRect.left - W - GAP)
    const top = Math.min(Math.max(8, anchorRect.top), window.innerHeight - 240)
    composer.classList.toggle('tip-left', fitsRight)  // composer right of mark -> tip on its left edge
    composer.classList.toggle('tip-right', !fitsRight)
    const h = anchorRect.height ?? (anchorRect.bottom - anchorRect.top)
    const tipY = Math.min(Math.max(16, anchorRect.top + h / 2 - top - 6), 150)
    composer.style.setProperty('--tip-y', `${tipY}px`)
    Object.assign(composer.style, { display: 'block', left: left + 'px', top: top + 'px' })
    ta.value = ''
    ta.focus()
  }
  composer.querySelector('.cancel').addEventListener('click', () => setMode('idle'))
  composer.querySelector('.send').addEventListener('click', send)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
    e.stopPropagation()
  })

  // ---------- console + network excerpt from the MAIN-world hook ----------
  function getConsole() {
    return new Promise((res) => {
      const done = (e) => { removeEventListener('roots-nudge-console-res', done); clearTimeout(t); res(JSON.parse(e.detail || '[]')) }
      const t = setTimeout(() => { removeEventListener('roots-nudge-console-res', done); res([]) }, 300)
      addEventListener('roots-nudge-console-res', done)
      dispatchEvent(new CustomEvent('roots-nudge-console-req'))
    })
  }

  // ---------- capture helpers ----------
  const nextFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  async function captureRegion(rect, { withHighlight = false } = {}) {
    const PAD = 24
    const crop = {
      x: Math.max(0, rect.left - PAD),
      y: Math.max(0, rect.top - PAD),
      w: Math.min(window.innerWidth, rect.width + 2 * PAD),
      h: Math.min(window.innerHeight, rect.height + 2 * PAD),
    }
    composer.style.display = 'none'
    const pillWas = pill.style.display
    pill.style.display = 'none'
    const dotsWas = dots.style.display
    dots.style.display = 'none' // status dots don't belong in evidence shots
    hl.classList.add('instant') // transitions off: the box must be fully painted in the shot
    if (withHighlight) { highlight(rect); hl.querySelector('.chip').textContent = '' }
    else hl.classList.remove('on')
    await nextFrames()
    let out = null
    try {
      const res = await chrome.runtime.sendMessage({ type: 'nudge-capture', rect: crop, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio })
      if (res?.ok) out = res
      else console.warn('[roots-nudge] capture failed:', res?.error)
    } catch (err) { console.warn('[roots-nudge] capture failed:', err) }
    hl.classList.remove('on')
    hl.classList.remove('instant')
    pill.style.display = pillWas
    dots.style.display = dotsWas
    return out
  }

  // ---------- send (with offline queue) ----------
  async function postPin(payload) {
    const resp = await fetch(HTTP + '/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    return (await resp.json()).id
  }
  function enqueue(payload) {
    if (!alive()) return // orphan window — the fresh script owns the queue
    chrome.storage.local.get({ nudgeQueue: [] }, ({ nudgeQueue }) => {
      nudgeQueue.push(payload)
      if (nudgeQueue.length > 25) {
        nudgeQueue.splice(0, nudgeQueue.length - 25)
        notify('alert', 'Queue full — oldest dropped')
      }
      chrome.storage.local.set({ nudgeQueue })
    })
  }
  // the 5s orphan check leaves a WINDOW: an event can fire on a freshly
  // invalidated context before `dead` flips (bit Gerald 2026-07-05:
  // "Uncaught: Extension context invalidated at flushQueue/onVisibility")
  const alive = () => { try { chrome.runtime.getURL(''); return true } catch { return false } }
  function flushQueue() {
    // only the VISIBLE tab flushes — two open tabs racing the same
    // chrome.storage queue would double-send every queued pin
    if (dead || document.hidden || !alive()) return
    chrome.storage.local.get({ nudgeQueue: [] }, async ({ nudgeQueue }) => {
      if (!nudgeQueue.length) return
      let sent = 0
      for (const p of [...nudgeQueue]) {
        try { await postPin(p); nudgeQueue.shift(); sent++ } catch { break }
      }
      chrome.storage.local.set({ nudgeQueue })
      if (sent) notify('check', `${sent} queued nudge${sent > 1 ? 's' : ''} sent`)
    })
  }

  async function send() {
    if (!picked) return
    // Empty send = pure MARK, no pin (P1, 0.10.0): the selection channel already
    // carries it (element picks publish instantly, the lasso publishes region +
    // screenshot on pointerup). A text-less pin would sit in the queue forever —
    // marks must not age as prompts.
    if (!ta.value.trim()) {
      notify('check', 'Marked — no nudge')
      setMode('idle')
      return
    }
    const btn = composer.querySelector('.send')
    btn.disabled = true
    const target = picked
    let r
    if (target.stroke) {
      r = target.rect // lasso bbox is viewport-stable
    } else {
      // Re-read the rect (page may have scrolled) - but editors like ProseMirror
      // re-render nodes, leaving the picked element detached (rect = 0/0/0/0).
      // Fallback chain: live element -> re-resolved selector -> pick-time rect.
      r = target.el.getBoundingClientRect()
      if (r.width < 2 && r.height < 2) {
        try {
          const fresh = document.querySelector(target.selector)
          if (fresh) { target.el = fresh; r = fresh.getBoundingClientRect() }
        } catch { /* invalid selector - keep fallback */ }
      }
      if (r.width < 2 && r.height < 2) r = target.rect
    }
    const rect = { left: r.left, top: r.top, width: r.width || (r.right - r.left), height: r.height || (r.bottom - r.top) }
    // Screenshot ONLY for the Freeform (lasso) tool (region = pixels). Element pins
    // ship DOM context only — faster, lighter, no overlay flicker.
    const res = target.stroke ? await captureRegion(rect, { withHighlight: false }) : null
    const payload = {
      text: ta.value.trim(),
      author,
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      ua: navigator.userAgent, // browser/OS for the report (industry-standard context)
      target: {
        ...elementContext(target.el, target.selector, target.source),
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      },
      targets: multiTargets() || null, // Shift-collected co-targets of ONE prompt
      annotations: target.stroke ? [{ type: 'lasso', points: target.stroke }] : null,
      console: await getConsole(),
      screenshot: res?.dataUrl || null,
      screenshotFull: res?.fullDataUrl || null,
    }
    try {
      const id = await postPin(payload)
      // the moment of truth: tell Gerald whether an agent is LIVE on this prompt
      if (agentLive) notify('send', `${id} — agent working`)
      else notify('clock', `${id} saved — no agent`)
      // team rollout: anonymous pins are useless in a shared store — hint ONCE
      if (!author) {
        chrome.storage.local.get('nudgeAuthorHinted', (v) => {
          if (v.nudgeAuthorHinted) return
          chrome.storage.local.set({ nudgeAuthorHinted: true })
          notify('clock', 'Tip: set your name in Options — nudges are anonymous')
        })
      }
    } catch {
      enqueue(payload)
      notify('alert', 'Bridge offline — queued')
    }
    btn.disabled = false
    setMode('idle')
  }

  // feedback feed: small chips top right, Lucide icons, fade out on their own.
  // Kinds: sent (send), done (check), queued (clock), warn (triangle-alert).
  const FEED_ICONS = { // official Lucide path geometry, 24x24 viewBox
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  }
  function notify(kind, text) {
    const item = document.createElement('div')
    item.className = `item ${kind === 'alert' || kind === 'clock' ? 'warn' : 'ok'}`
    item.innerHTML = `<svg viewBox="0 0 24 24">${FEED_ICONS[kind] || FEED_ICONS.check}</svg><span></span>`
    item.querySelector('span').textContent = text
    feed.appendChild(item)
    while (feed.children.length > 4) feed.firstChild.remove() // unobtrusive: short list
    requestAnimationFrame(() => item.classList.add('show'))
    setTimeout(() => { item.classList.add('bye'); setTimeout(() => item.remove(), 300) }, 4500)
  }

  // ---------- resolve-with-proof: after-screenshot on request ----------
  const afterAttempted = new Set()
  async function captureAfter(pin) {
    if (afterAttempted.has(pin.id) || !samePage(pin.url)) return
    afterAttempted.add(pin.id)
    let rect = null
    try { const n = document.querySelector(pin.target?.selector || ''); if (n) { n.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 250)); rect = n.getBoundingClientRect() } } catch { /* bad selector */ }
    if ((!rect || (rect.width < 2 && rect.height < 2)) && pin.target?.rect)
      rect = { left: pin.target.rect.x, top: pin.target.rect.y, width: pin.target.rect.w, height: pin.target.rect.h }
    if (!rect || (rect.width < 2 && rect.height < 2)) return
    const res = await captureRegion(rect)
    if (!res?.dataUrl) return
    try {
      await fetch(`${HTTP}/comments/${pin.id}/after`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshot: res.dataUrl }),
      })
    } catch { /* bridge gone mid-flight */ }
  }

  // ---------- prompt tracking ----------
  // Product change 2026-07-05 (Gerald): open prompts SHOULD stay subtly visible —
  // one small amber status dot per marked element while the prompt is open
  // (disappears on resolve/discard). Still no popovers/threads on the page;
  // the queue popover is the management surface (labels + discard ×). Evidence
  // capture stays: on resolve the same region is re-shot invisibly.
  let pagePins = [] // open nudges on THIS route (badge count + dots)
  let pageDone = [] // resolved nudges on THIS route — history in the queue popover
  let allPins = [] // last full list from the bridge — refiltered on SPA navigation
  const samePage = (u) => {
    try { const a = new URL(u), b = new URL(location.href); return a.origin === b.origin && a.pathname === b.pathname && a.hash === b.hash } catch { return false }
  }
  // resolve feedback: when the agent finishes a prompt, close the loop right here
  // in the page — Gerald must not have to switch to Zed to know it's done
  const knownStatus = new Map()
  let statusSeeded = false
  function acceptPins(all) {
    allPins = all
    pagePins = all.filter(p => samePage(p.url) && p.status === 'open')
    pageDone = all.filter(p => samePage(p.url) && p.status === 'resolved').slice(-8).reverse()
    updatePill()
    renderDots()
    for (const p of all) {
      if (statusSeeded && knownStatus.get(p.id) === 'open' && p.status === 'resolved' && samePage(p.url))
        notify('check', `${p.id} done`)
      knownStatus.set(p.id, p.status)
      // evidence backlog: resolved KREIS prompts on this page that still lack
      // their after-shot (elements are DOM-only — no before, no after)
      if (p.status === 'resolved' && p.screenshot && !p.screenshotAfter && samePage(p.url)) captureAfter(p)
    }
    statusSeeded = true
  }
  // SPA navigation (estimate routes via location.hash): refilter the badge count
  addEventListener('hashchange', () => acceptPins(allPins))
  addEventListener('popstate', () => acceptPins(allPins))

  // ---------- session dropdown (who owns the wake channel) ----------
  const sinceAge = (t) => {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000))
    return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`
  }
  function renderWhoMenu() {
    const list = whoMenu.querySelector('.w-list')
    list.innerHTML = ''
    for (const a of agents) {
      const row = document.createElement('div')
      row.className = 'w-row' + (a.owner ? ' is-owner' : '')
      const l2 = [a.project, a.branch ? `@ ${a.branch}` : null, a.host, `seit ${sinceAge(a.since)}`].filter(Boolean).join(' · ')
      row.innerHTML = '<div class="w-line1"></div><div class="w-line2"></div><div class="w-line3"></div>'
      row.querySelector('.w-line1').textContent = (a.owner ? '● ' : '') + a.label
      row.querySelector('.w-line2').textContent = l2
      const l3 = row.querySelector('.w-line3')
      if (a.firstMsg) l3.textContent = `„${a.firstMsg}…“`
      else l3.remove()
      row.addEventListener('click', async () => {
        try {
          await fetch(`${HTTP}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: a.pid }) })
          notify('check', `Owner: ${a.label}`)
        } catch { notify('alert', 'Bridge offline') }
        whoMenu.classList.remove('on')
      })
      list.appendChild(row)
    }
  }
  pill.querySelector('.who').addEventListener('click', (e) => {
    e.stopPropagation()
    if (whoMenu.classList.contains('on')) { whoMenu.classList.remove('on'); return }
    renderWhoMenu()
    const r = pill.getBoundingClientRect()
    Object.assign(whoMenu.style, { top: r.bottom + 8 + 'px', right: Math.max(8, window.innerWidth - r.right) + 'px' })
    whoMenu.classList.add('on')
  })

  // ---------- bridge connection (status dot + live pins) ----------
  let wsOk = false
  let agentLive = false
  let agentLabel = null // which session owns the wake channel (bridge arbiter)
  let agents = [] // full roster incl. standby sessions (toolbar dropdown) // a watcher heartbeats the bridge -> prompts get acted on NOW
  // ---------- queue popover (badge click) ----------
  const Q_CLOCK = '<span class="q-dot q-wait"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><g class="q-hand"><path d="M12 6v6l4 2"/></g></svg></span>'
  const ageOf = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
    return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
  }
  // speaking label for text-less prompts: WHAT is marked, not just "a mark"
  function markLabel(p) {
    if (p.targets?.length) return `Mark: ${p.targets.length} elements`
    const t = (p.target?.innerText || '').trim()
    if (t) return `Mark: “${t.length > 48 ? t.slice(0, 48) + '…' : t}”`
    return p.target?.selector ? `Mark: ${p.target.selector}` : 'Mark without element'
  }
  const Q_CHECK = '<span class="q-dot q-done"><svg viewBox="0 0 24 24" class="q-ok"><path d="M20 6 9 17l-5-5"/></svg></span>'
  const qExpanded = new Set() // accordion: which rows show their full text
  const qAccordion = (row, id) => {
    row.classList.toggle('open', qExpanded.has(id))
    row.addEventListener('click', () => {
      qExpanded.has(id) ? qExpanded.delete(id) : qExpanded.add(id)
      row.classList.toggle('open', qExpanded.has(id))
    })
  }
  function renderQueue() {
    const open = pagePins
    queue.querySelector('.q-head').textContent = open.length
      ? `${open.length} open nudge${open.length === 1 ? '' : 's'} on this page${agentLive && agentLabel ? ` · ${agentLabel}` : ''}`
      : `No open nudges on this page${agentLive && agentLabel ? ` · ${agentLabel}` : ''}`
    const list = queue.querySelector('.q-list')
    list.innerHTML = ''
    for (const p of open) {
      const row = document.createElement('div')
      row.className = 'q-row' + (wsOk && agentLive ? ' live' : '')
      row.innerHTML = `${Q_CLOCK}<span class="q-id"></span><span class="q-text"></span><span class="q-age"></span><button class="q-x" title="Dismiss nudge">×</button>`
      row.querySelector('.q-id').textContent = p.id
      row.querySelector('.q-text').textContent = p.text || markLabel(p)
      row.querySelector('.q-age').textContent = ageOf(p.createdAt)
      qAccordion(row, p.id)
      row.querySelector('.q-x').addEventListener('click', async (e) => {
        e.stopPropagation()
        try {
          const r = await fetch(`${HTTP}/comments/${p.id}`, { method: 'DELETE' })
          if (r.ok) notify('check', `${p.id} dismissed`) // list refresh comes via WS
          else notify('alert', `${p.id} not found`)
        } catch { notify('alert', 'Bridge offline — not dismissed') }
      })
      list.appendChild(row)
    }
    // history: this route's resolved nudges, newest first — completion feedback
    // lives HERE (the page dot disappears on resolve, by design)
    if (pageDone.length) {
      const div = document.createElement('div')
      div.className = 'q-div'
      div.textContent = 'Done'
      list.appendChild(div)
      for (const p of pageDone) {
        const row = document.createElement('div')
        row.className = 'q-row done'
        row.innerHTML = `${Q_CHECK}<span class="q-id"></span><span class="q-text"></span><span class="q-age"></span>`
        row.querySelector('.q-id').textContent = p.id
        row.querySelector('.q-text').textContent = p.text || markLabel(p)
        row.querySelector('.q-age').textContent = ageOf(p.resolvedAt || p.createdAt)
        qAccordion(row, p.id)
        list.appendChild(row)
      }
    }
  }

  // ---------- open-nudge dots (subtle DOM presence of the queue) ----------
  const dotTargets = (p) => (p.targets?.length ? p.targets.map(t => t.selector) : [p.target?.selector]).filter(Boolean)
  function renderDots() {
    dots.innerHTML = ''
    for (const p of pagePins) {
      for (const sel of dotTargets(p)) {
        const d = document.createElement('div')
        d.className = 'dot' + (wsOk && agentLive ? ' live' : '')
        // same badge language as the queue rows: ring + Lucide clock, the hand
        // sweeps while an agent is live (a plain green dot read like a stuck
        // status LED — a running clock reads as work, Gerald 2026-07-05)
        d.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><g class="d-hand"><path d="M12 6v6l4 2"/></g></svg>'
        d.title = `${p.id} · ${p.text || markLabel(p)}`
        d.__sel = sel
        d.addEventListener('click', (e) => { e.stopPropagation(); showQueue() })
        dots.appendChild(d)
      }
    }
    positionDots()
  }
  function positionDots() {
    for (const d of dots.children) {
      let r = null
      try { const n = document.querySelector(d.__sel); if (n) r = n.getBoundingClientRect() } catch { /* bad selector */ }
      if (!r || (r.width < 2 && r.height < 2) || r.bottom < 0 || r.top > window.innerHeight) { d.style.display = 'none'; continue }
      d.style.display = 'flex' // inline display must not kill the badge's flex centring
      d.style.left = Math.min(window.innerWidth - 20, r.right - 8) + 'px'
      d.style.top = Math.max(2, r.top - 8) + 'px'
    }
  }
  let dotRaf = 0
  const scheduleDots = () => { if (!dotRaf) dotRaf = requestAnimationFrame(() => { dotRaf = 0; positionDots() }) }
  addEventListener('scroll', scheduleDots, { capture: true, passive: true })
  addEventListener('resize', scheduleDots, { passive: true })
  setInterval(() => { if (dots.children.length) positionDots() }, 1500) // SPA re-renders move anchors without scroll
  function showQueue() {
    renderQueue()
    const r = pill.getBoundingClientRect()
    Object.assign(queue.style, { top: r.bottom + 8 + 'px', right: Math.max(8, window.innerWidth - r.right) + 'px' })
    queue.classList.add('on')
  }
  function hideQueue() { queue.classList.remove('on') }
  const onDocPointerDown = (e) => {
    if (!queue.classList.contains('on')) return
    const path = e.composedPath()
    if (!path.includes(queue) && !path.includes(pill.querySelector('.count'))) hideQueue()
    if (whoMenu.classList.contains('on') && !path.includes(whoMenu) && !path.includes(pill.querySelector('.who'))) whoMenu.classList.remove('on')
  }
  document.addEventListener('pointerdown', onDocPointerDown, true)

  function updatePill() {
    const dot = pill.querySelector('.status')
    dot.classList.toggle('ok', wsOk && agentLive)
    dot.classList.toggle('half', wsOk && !agentLive)
    dot.title = !wsOk ? 'Bridge unreachable' : (agentLive ? `Agent live — ${agentLabel || '?'}` : 'Bridge up — no agent (nudges are stored)')
    // session label IN the toolbar (Gerald: always know which Zed agent reacts)
    const who = pill.querySelector('.who')
    const showWho = wsOk && (agentLive && !!agentLabel || agents.length > 0)
    who.textContent = agentLive && agentLabel ? agentLabel : (agents.length ? `${agents.length} sessions` : '')
    who.title = showWho ? 'Connected sessions — click to choose the owner' : ''
    who.style.display = showWho ? 'inline-block' : 'none'
    pill.querySelector('.who-sep').style.display = showWho ? 'inline-block' : 'none'
    const openCount = pagePins.filter(p => p.status === 'open').length
    const count = pill.querySelector('.count')
    count.textContent = String(openCount)
    count.classList.toggle('show', openCount > 0)
    count.title = `${openCount} open — click for list + history`
    if (openCount === 0) hideQueue()
    else if (queue.classList.contains('on')) renderQueue() // live refresh while open
    // mirror ALL states into the toolbar icon: grey (overlay off) / red (no
    // bridge) / amber (bridge, no agent listening) / green (agent live)
    try { chrome.runtime.sendMessage({ type: 'nudge-state', active: mode !== 'off', bridgeOk: wsOk, agentLive, open: openCount }) } catch { /* extension reloading */ }
  }
  let sock, retryTimer, retryDelay = 3000, hadOutage = false
  let dead = false // set by the orphan cleanup: NOTHING may reconnect afterwards
  function connect() {
    if (dead) return
    clearTimeout(retryTimer)
    try { sock = new WebSocket(WS) } catch { return scheduleRetry() }
    sock.onopen = () => {
      try { sock.send(JSON.stringify({ type: 'hello', url: location.href })) } catch { /* racing close */ }
      if (hadOutage) { notify('check', 'Bridge reconnected'); hadOutage = false }
      wsOk = true; retryDelay = 3000; updatePill(); flushQueue()
    }
    sock.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'pins') {
          agentLive = !!msg.agentLive
          if (agentLive && msg.agentLabel && msg.agentLabel !== agentLabel) notify('check', `Agent: ${msg.agentLabel}`)
          agentLabel = agentLive ? msg.agentLabel || null : null
          agents = msg.agents || []
          if (whoMenu.classList.contains('on')) renderWhoMenu() // live refresh
          acceptPins(msg.pins)
        }
        if (msg.type === 'capture-after') captureAfter(msg.pin)
        if (msg.type === 'reload') chrome.runtime.sendMessage({ type: 'nudge-dev-reload' })
      } catch { /* ignore malformed frames */ }
    }
    sock.onclose = () => {
      if (wsOk && !hadOutage) { notify('alert', 'Bridge disconnected'); hadOutage = true }
      wsOk = false; agentLive = false; updatePill(); scheduleRetry()
      // ask the SW to (re)start the bridge via the native host — Chrome heals itself
      try { chrome.runtime.sendMessage({ type: 'nudge-bridge-down' }) } catch { /* orphan */ }
    }
    sock.onerror = () => { try { sock.close() } catch { /* already closed */ } }
  }
  // exponential backoff, capped LOW (browser-tools-mcp reconnects at a fixed 5s —
  // a tab must not be blind for half a minute after a bridge restart), plus an
  // immediate retry when Gerald returns to the tab
  function scheduleRetry() {
    if (dead) return
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, retryDelay)
    retryDelay = Math.min(8000, retryDelay * 1.5)
  }
  const onVisibility = () => {
    if (dead || document.hidden) return
    if (!wsOk) { retryDelay = 3000; connect() }
    else flushQueue() // hidden tabs skip the flush - catch up now
  }
  document.addEventListener('visibilitychange', onVisibility)

  // ---------- global listeners ----------
  const onDocKeyDown = (e) => {
    if (e.key === 'Escape' && whoMenu.classList.contains('on')) { whoMenu.classList.remove('on'); return }
    if (e.key === 'Escape' && queue.classList.contains('on')) { hideQueue(); return }
    if (e.key === 'Escape' && mode !== 'off') { setMode('idle') }
  }
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('pointerdown', onClick, true)
  document.addEventListener('keydown', onDocKeyDown, true)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'nudge-toggle') setMode(mode === 'off' ? 'idle' : 'off')
  })

  // Orphan self-cleanup: after chrome.runtime.reload() (dev auto-reload), content
  // scripts in tabs that did not refresh keep running with an INVALIDATED extension
  // context — the overlay looks alive but chrome.* calls throw and buttons half-work
  // (bit Gerald 2026-07-04: "Abbrechen tut nichts"). Detect invalidation and remove
  // the whole overlay; the refreshed tab gets a fresh, working script. Crucially,
  // tear down the GLOBAL capture-phase listeners too: a removed host still left
  // onClick/onMove on document, so a dead overlay kept swallowing clicks
  // (preventDefault/stopPropagation) and ran openComposer on a detached composer —
  // pinning silently died with NO popover until a manual refresh (bit Gerald
  // 2026-07-05 during the port: "das Popover erscheint nicht").
  // Additionally (bit Gerald 2026-07-05 after the Nudge rename): closing the
  // socket fires onclose -> scheduleRetry -> the reconnect loop SURVIVED the
  // cleanup and spammed "WebSocket connection failed" forever; the
  // visibilitychange flush threw on the dead context too. `dead` gates all of
  // it, and the handlers are detached before the socket is closed.
  const orphanCheck = setInterval(() => {
    try { chrome.runtime.getURL('') } catch {
      clearInterval(orphanCheck)
      dead = true
      clearTimeout(retryTimer)
      try { if (sock) { sock.onclose = null; sock.onerror = null; sock.close() } } catch { /* already dead */ }
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('pointerdown', onClick, true)
      document.removeEventListener('keydown', onDocKeyDown, true)
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      host.remove()
    }
  }, 5000)

  setMode('idle') // PoC: overlay visible by default on localhost; Alt+C / toolbar icon toggles
  connect()
})()
