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
  // Bridge endpoints. TEST SUITES may re-point them via
  // chrome.storage.local.nudgePort (set through the extension's service worker
  // BEFORE pages load) — real Chrome never sets it and stays on 4700. Root
  // cause: suites used to STEAL port 4700 from the live bridge, and Gerald's
  // real toolbar briefly showed the suite's test agent („Agent: suite-e",
  // 2026-07-05). Tests never touch the live port again.
  let HTTP = 'http://localhost:4700'
  let WS = 'ws://localhost:4700'
  const ACCENT = '#b45a38'

  // ---------- shadow root + styles ----------
  const host = document.createElement('div')
  host.id = '__roots-nudge-host'
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
  const root = host.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(host)

  // Nudge chrome must be INERT for the page: clicks on the pill/queue/composer
  // bubble (composed) to document and count as outside-clicks — they dismissed
  // page popovers before one could pick them (bit Gerald 2026-07-05,
  // „Finale Version freigeben?"). Inner handlers run first (host is last in
  // the bubble path), then we stop everything here.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'focusin']) {
    host.addEventListener(type, (e) => e.stopPropagation())
  }

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
    `<span class="grip" title="Move">${GRIP}</span><span class="status"></span><span class="count"></span><span class="sep"></span><button class="btn-pick" title="Pick element (P)">${ICON_PICK}<span>Pick</span></button><button class="btn-draw" title="Freeform region (F)">${ICON_DRAW}<span>Freeform</span></button><span class="sep who-sep"></span><span class="who" title=""><span class="who-kind"></span><span class="who-label"></span><span class="who-id"></span><span class="who-wake"></span><span class="who-host"></span></span>`)
  const hl = el('div', 'hl', '<span class="chip"></span>')
  const draw = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  draw.setAttribute('class', 'draw')
  root.appendChild(draw)
  const composer = el('div', 'composer',
    '<div class="tip"></div><div class="inner"><div class="layers"></div><div class="meta"></div><textarea placeholder="Nudge… (↩ send · ⇧↩ newline · Esc cancel · ⇧click add element · empty ↩ = numbered mark)"></textarea><div class="row"><button class="cancel">Cancel</button><button class="send">Send</button></div></div>')
  const feed = el('div', 'feed')
  // queue popover: click the pill badge -> read-only list of this route's open
  // prompts (what the count MEANS). No management UI on the page — resolving
  // stays the agent's job; this is a peek, in the composer's midnight language.
  const queue = el('div', 'queue', '<div class="q-head"></div><div class="q-list"></div>')
  const whoMenu = el('div', 'who-menu', '<div class="q-head">Switch session</div><div class="w-list"></div>')
  // status hint: a click on the (otherwise mute) status dot explains the CURRENT
  // state and what to do — „kein Agent → tippe /nudge", „Bridge weg", „Pull: weiter"
  const statusMenu = el('div', 'status-menu', '<div class="q-head"></div><div class="sm-body"></div>')
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
    // everything that hangs off the toolbar follows it while it moves
    placeFeed()
    if (queue.classList.contains('on')) trackPopover(queue)
    if (whoMenu.classList.contains('on')) trackPopover(whoMenu)
    if (statusMenu.classList.contains('on')) trackPopover(statusMenu)
  }
  // the feedback chips live directly under the toolbar and track it (the pill
  // moves) — left-aligned to the pill, capped to its width so they sit tidily
  // under it instead of floating in the screen corner
  function placeFeed() {
    const r = pill.getBoundingClientRect()
    Object.assign(feed.style, { top: (r.bottom + 8) + 'px', left: r.left + 'px', right: 'auto', maxWidth: Math.max(220, r.width) + 'px' })
  }
  // OPEN: position the popover under the pill, caret pointing at its anchor
  // (badge / session label), clamped to the viewport — and REMEMBER the offset
  // to the pill so a later drag translates the whole thing RIGIDLY.
  function anchorPopover(popover, anchorEl, W) {
    const pillR = pill.getBoundingClientRect()
    const a = anchorEl.getBoundingClientRect()
    const caretX = a.left + a.width / 2
    const left = Math.max(8, Math.min(caretX - 32, window.innerWidth - W - 8))
    const caret = Math.max(16, Math.min(caretX - left, W - 16))
    Object.assign(popover.style, { top: pillR.bottom + 10 + 'px', left: left + 'px', right: 'auto' })
    popover.style.setProperty('--caret-x', caret + 'px')
    popover._dx = left - pillR.left // offset from the pill; keep it constant on drag
    popover._w = W
  }
  // DRAG: move the OPEN popover by the SAME delta as the pill — window + caret
  // travel together as one unit (the popover belongs to the toolbar). No caret
  // recompute → it never slides while the window stays put (Gerald 2026-07-06).
  function trackPopover(popover) {
    const pillR = pill.getBoundingClientRect()
    const left = Math.max(8, Math.min(pillR.left + (popover._dx || 0), window.innerWidth - (popover._w || 340) - 8))
    Object.assign(popover.style, { top: pillR.bottom + 10 + 'px', left: left + 'px' })
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
    else placeFeed() // pill at its default (right-anchored) spot — feed still tracks it
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
  // Prefer a REAL id (DevTools convention): unique in the document and not
  // machine-looking. finder's wordLike heuristic rejects legit ids with short
  // segments (#g-modal-title, #dz-card — any segment ≤2 chars) and degrades to
  // brittle class paths that break on the next re-render (Suite F fixture
  // finding, 2026-07-05). Machine-looking = framework-generated (:r5:, hex
  // hashes, long digit runs) — those stay with finder's heuristics.
  const MACHINE_ID = /[:]|\d{3,}|[0-9a-f]{8,}/i
  function cssPath(node) {
    const id = node.id
    if (id && !MACHINE_ID.test(id)) {
      try { if (document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) return `#${CSS.escape(id)}` } catch { /* invalid selector */ }
    }
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
  // The pick acts on POINTERDOWN — but canceling pointerdown does NOT cancel
  // the trailing CLICK (only the compatibility mouse events). An anchor under
  // the pick would still navigate (hash links re-route SPAs, real links unload
  // the page mid-composer — Suite F fixture finding, 2026-07-05). Swallow EXACTLY
  // the one trailing click of the pick gesture — not a time window, which would
  // also kill the user's next deliberate click (that broke the file dialog in
  // Suite E). A short deadline clears the flag if the click never arrives (the
  // picked node got detached before click, so the sequence never completes).
  let eatNextClick = 0 // timestamp deadline; 0 = nothing pending
  function onClickSuppress(e) {
    if (inOverlay(e)) return
    if (mode === 'picking') { e.preventDefault(); e.stopPropagation(); return }
    if (eatNextClick && Date.now() < eatNextClick) { eatNextClick = 0; e.preventDefault(); e.stopPropagation() }
  }
  function onClick(e) {
    // Shift extends a selection that started as a PLAIN pick, too. The composer
    // is open and mode is 'composing' by then, which used to bail out one line
    // below — so "⇧click add element" (the composer's own placeholder) only ever
    // held when Shift was already down on the very FIRST click (bit Gerald
    // 2026-07-29: "geht nicht zuverlässig" — it worked or not depending on how
    // the selection happened to start). Element picks only: a lasso region has
    // no element to collect with.
    const extending = mode === 'composing' && e.shiftKey && !!picked && !picked.stroke
    if ((mode !== 'picking' && !extending) || inOverlay(e) || !e.isPrimary) return
    e.preventDefault(); e.stopPropagation()
    eatNextClick = Date.now() + 700 // consume the trailing click, or lapse
    const t = e.target
    if (!(t instanceof Element)) return
    // The PICK is the mark — no send needed, and for ELEMENTS no screenshot:
    // selector + xpath + innerText + outerHTML + styles fully identify a DOM
    // node. Screenshots are exclusive to the Freeform (lasso) tool.
    if (e.shiftKey) {
      // Shift starts/extends a multi-selection (Finder/Figma convention:
      // plain click = ONE fresh element, only Shift collects — 0.10.0 aligned
      // code with the documented behaviour)
      // Seed the set with what is ALREADY marked, so the first Shift+click ADDS
      // to the single pick instead of starting over from nothing.
      if (!multi.length && picked?.el && !picked.stroke) addToMulti(picked.el)
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
    ta.style.height = 'auto' // reset any grown height from a previous compose
    ta.focus()
  }
  composer.querySelector('.cancel').addEventListener('click', () => setMode('idle'))
  composer.querySelector('.send').addEventListener('click', send)
  // grow the textarea with its content up to the CSS max-height (then it scrolls),
  // so a longer nudge is fully visible while typing instead of a fixed peephole
  const autoGrow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
  ta.addEventListener('input', autoGrow)
  ta.addEventListener('keydown', (e) => {
    // Enter sends (empty = numbered mark), Shift+Enter inserts a newline —
    // same convention as the History amend input
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
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
    // Empty send = NUMBERED MARK (0.20.0, reverses the 0.10.0 pure-mark rule):
    // the pin's number is the referent for chat — Gerald marks fast in the
    // browser, then prompts in Zed („Nudge 123 macht das"). The watcher wake
    // line flags it as reference-only, the skill does not work it unprompted.
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
      // the moment of truth: tell Gerald what actually happens to this prompt.
      // A pull owner (CLI) is live but won't START on its own — say so, or the
      // green icon's „agent working" would be a lie (Gerald: Nudges „kommen nicht an").
      if (!payload.text) notify('check', `${id} marked`)
      else if (agentLive && agentWake === 'pull') notify('clock', `${id} erfasst · im Terminal „weiter"`)
      else if (agentLive) notify('send', `${id} — agent working`)
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
  const FEED_ICONS = { // official Lucide path geometry, 24x24 viewBox (current set, matching the toolbar glyphs)
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  }
  function notify(kind, text, host) {
    const item = document.createElement('div')
    item.className = `item ${kind === 'alert' || kind === 'clock' ? 'warn' : 'ok'}`
    item.innerHTML = `<svg viewBox="0 0 24 24">${FEED_ICONS[kind] || FEED_ICONS.check}</svg><span class="feed-text"></span><span class="feed-host"></span>`
    item.querySelector('.feed-text').textContent = text
    const fh = item.querySelector('.feed-host') // localhost as a clean pill, never inline text
    if (host) fh.textContent = host; else fh.remove()
    placeFeed() // anchor under the toolbar at its CURRENT position before showing
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
  // Gerald names each worktree's session with its localhost port ("Estimate
  // Templates :5175"). Split that suffix off so the name renders clean and the
  // port becomes its own right-aligned tag.
  function splitLabel(label) {
    const m = /^(.*?)\s*:(\d{2,5})\s*$/.exec(label || '')
    return m ? { name: m[1], port: m[2] } : { name: label || '', port: '' }
  }
  function renderWhoMenu() {
    const list = whoMenu.querySelector('.w-list')
    list.innerHTML = ''
    for (const a of agents) {
      const row = document.createElement('div')
      row.className = 'w-row' + (a.owner ? ' is-owner' : '')
      // a.session (id8) is the un-collidable key: the /nudge arm-report in the
      // chat prints the same id, so Gerald matches chat ↔ dropdown 1:1 even when
      // two sessions share a label
      // wake mode per row: „Auto" (push/Zed, starts on its own) vs „Pull" (CLI,
      // comes on the next terminal prompt) — Gerald picks the owner knowing which
      const wakeTag = a.wake === 'pull' ? 'Pull' : a.wake === 'push' ? 'Auto' : null
      const l2 = [a.project, a.branch ? `@ ${a.branch}` : null, a.host, wakeTag, `seit ${sinceAge(a.since)}`, a.session || null].filter(Boolean).join(' · ')
      row.innerHTML = '<div class="w-line1"><span class="w-name"></span><span class="w-host"></span></div><div class="w-line2"></div><div class="w-line3"></div>'
      const parts = splitLabel(a.label)
      row.querySelector('.w-name').textContent = (a.owner ? '● ' : '') + parts.name
      // localhost as a subtle right-aligned tag on each session row (Gerald 2026-07-07)
      const wh = row.querySelector('.w-host')
      if (parts.port) wh.textContent = `localhost:${parts.port}`; else wh.remove()
      row.querySelector('.w-line2').textContent = l2
      const l3 = row.querySelector('.w-line3')
      if (a.firstMsg) l3.textContent = `„${a.firstMsg}…“`
      else l3.remove()
      row.addEventListener('click', async () => {
        try {
          // route THIS localhost (location.host) to the chosen agent — parallel
          // dev servers each get their own agent (session id is stable across re-arms)
          const r = await fetch(`${HTTP}/agent/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: a.pid, session: a.session, host: location.host }) })
          const s = splitLabel(a.label)
          if (r.ok) notify('check', `→ ${s.name}`, s.port ? `localhost:${s.port}` : '')
          else notify('alert', `${s.name} nicht mehr aktiv`) // gone since the list was drawn — never claim success
        } catch { notify('alert', 'Bridge offline') }
        whoMenu.classList.remove('on')
      })
      list.appendChild(row)
    }
  }
  pill.querySelector('.who').addEventListener('click', (e) => {
    e.stopPropagation()
    if (whoMenu.classList.contains('on')) { whoMenu.classList.remove('on'); return }
    hideQueue(); statusMenu.classList.remove('on') // only one popover open at a time
    renderWhoMenu()
    anchorPopover(whoMenu, pill.querySelector('.who'), 460) // 460 = .who-menu width in styles.js
    whoMenu.classList.add('on')
  })

  // ---------- status hint (click on the status dot) ----------
  // The dot is honest but mute: a click turns it into a one-line guide for the
  // CURRENT state. It NEVER arms/wakes from the browser (that's the opt-in fence);
  // it only tells Gerald what the state means and what to do next.
  function renderStatusMenu() {
    const head = statusMenu.querySelector('.q-head')
    const body = statusMenu.querySelector('.sm-body')
    const name = agentLabel ? splitLabel(agentLabel).name : '?'
    if (!wsOk) {
      head.textContent = 'Bridge nicht erreichbar'
      body.innerHTML = 'Keine Verbindung zur Bridge. Fokussiere Chrome oder tippe <b>/nudge</b> in einer Zed-Session — beides startet die Bridge.'
    } else if (!agentLive) {
      head.textContent = 'Kein Agent aktiv'
      body.innerHTML = 'Nudges werden gespeichert (die Nummern-Pille ist der Beweis), aber niemand reagiert automatisch. Tippe <b>/nudge</b> in der Zed-Session, die reagieren soll.'
    } else if (agentWake === 'pull') {
      head.textContent = `Agent aktiv: ${name} · Pull`
      body.innerHTML = 'Gespeichert — der Nudge kommt beim nächsten <b>„weiter"</b> im Terminal, nicht von selbst (CLI-Session).'
    } else {
      head.textContent = `Agent aktiv: ${name}`
      body.innerHTML = 'Läuft: neue Nudges starten den Agenten automatisch.'
    }
  }
  pill.querySelector('.status').addEventListener('click', (e) => {
    e.stopPropagation()
    if (statusMenu.classList.contains('on')) { statusMenu.classList.remove('on'); return }
    hideQueue(); whoMenu.classList.remove('on') // only one popover open at a time
    renderStatusMenu()
    anchorPopover(statusMenu, pill.querySelector('.status'), 300) // 300 = .status-menu width in styles.js
    statusMenu.classList.add('on')
  })

  // ---------- bridge connection (status dot + live pins) ----------
  let wsOk = false
  let agentLive = false
  let agentLabel = null // which session owns the wake channel (bridge arbiter)
  let agentWake = null // 'push' = owner auto-wakes (Zed) · 'pull' = surfaces on next prompt (CLI)
  let agents = [] // full roster incl. standby sessions (toolbar dropdown) // a watcher heartbeats the bridge -> prompts get acted on NOW
  // ---------- queue popover (badge click) ----------
  const Q_CLOCK = '<span class="q-dot q-wait"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><g class="q-hand"><path d="M12 6v6l4 2"/></g></svg></span>'
  const ageOf = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
    return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
  }
  // The number Gerald reads and says: the bridge's bounded LABEL (wraps at 999,
  // see store.mjs), not the ever-growing id. Both are shown wherever there is
  // room — the id is what commits and inbox files cite. Fallback keeps an older
  // bridge's payload (no `label`) rendering something sane instead of blank.
  const numOf = (p) => (p.label ?? p.id.replace(/^(?:pin|nudge)_/, ''))
  // speaking label for text-less prompts: WHAT is marked, not just "a mark"
  function markLabel(p) {
    if (p.targets?.length) return `Mark: ${p.targets.length} elements`
    const t = (p.target?.innerText || '').trim()
    if (t) return `Mark: “${t.length > 48 ? t.slice(0, 48) + '…' : t}”`
    return p.target?.selector ? `Mark: ${p.target.selector}` : 'Mark without element'
  }
  const Q_CHECK = '<span class="q-dot q-done"><svg viewBox="0 0 24 24" class="q-ok"><path d="M20 6 9 17l-5-5"/></svg></span>'
  const qExpanded = new Set() // accordion: which rows show their full text
  const qAmendDraft = new Map() // id -> in-progress follow-up text, survives WS re-renders
  const qAccordion = (row, id) => {
    row.classList.toggle('open', qExpanded.has(id))
    row.addEventListener('click', () => {
      qExpanded.has(id) ? qExpanded.delete(id) : qExpanded.add(id)
      row.classList.toggle('open', qExpanded.has(id))
    })
  }
  function renderQueue() {
    const open = pagePins
    const head = queue.querySelector('.q-head')
    const sh = agentLive && agentLabel ? splitLabel(agentLabel) : null // the whole History is one host → its localhost as a single header pill
    const base = open.length ? `${open.length} open nudge${open.length === 1 ? '' : 's'} on this page` : 'No open nudges on this page'
    head.innerHTML = '<span class="q-head-text"></span><span class="q-head-host"></span>'
    head.querySelector('.q-head-text').textContent = sh ? `${base} · ${sh.name}` : base
    const hh = head.querySelector('.q-head-host')
    if (sh?.port) hh.textContent = `localhost:${sh.port}`; else hh.remove()
    const list = queue.querySelector('.q-list')
    list.innerHTML = ''
    for (const p of open) {
      const row = document.createElement('div')
      row.className = 'q-row' + (wsOk && agentLive ? ' live' : '')
      row.innerHTML = `${Q_CLOCK}<span class="q-num"></span><span class="q-id"></span><span class="q-text"></span><span class="q-amc"></span><span class="q-who"></span><span class="q-age"></span><button class="q-add" title="Nachtrag ergänzen">+</button><button class="q-x" title="Dismiss nudge">×</button>`
      // BOTH numbers, and this is the only surface that shows them side by side:
      // #47 is the pill on the element (how Gerald finds this row and what he
      // says), nudge_1046 the identity behind it (files, commits). Seeing them
      // together here is what keeps the two from ever reading as a contradiction.
      row.querySelector('.q-num').textContent = `#${numOf(p)}`
      row.querySelector('.q-id').textContent = p.id
      row.querySelector('.q-text').textContent = p.text || markLabel(p)
      const amc = row.querySelector('.q-amc') // "+N" badge when this nudge carries follow-ups
      if (p.amendments?.length) amc.textContent = `+${p.amendments.length}`; else amc.remove()
      row.querySelector('.q-who').textContent = p.owner ? splitLabel(p.owner.label).name : '' // which session owns this nudge (stamped at arrival, immutable); host is implied by the route
      row.querySelector('.q-age').textContent = ageOf(p.createdAt)
      // existing follow-ups — a READABLE block under the row (shows when the row
      // is expanded or being amended), so Gerald can re-read what he appended
      if (p.amendments?.length) {
        const amlist = document.createElement('div')
        amlist.className = 'q-amend-list'
        for (const a of p.amendments) { const d = document.createElement('div'); d.className = 'q-amend-item'; d.textContent = a.text; amlist.appendChild(d) }
        row.appendChild(amlist)
      }
      // input (with a send button) to append one more (append-only) — only while amending
      const panel = document.createElement('div')
      panel.className = 'q-amend'
      panel.innerHTML = `<div class="q-amend-row"><textarea class="q-amend-input" rows="1" placeholder="Nachtrag zu ${p.id} … (↩ senden, ⇧↩ Zeile)"></textarea><button class="q-amend-send" title="Nachtrag senden (↩)"><svg viewBox="0 0 24 24">${FEED_ICONS.send}</svg></button></div>`
      row.appendChild(panel)
      panel.addEventListener('click', (e) => e.stopPropagation()) // typing must not toggle the accordion
      const input = panel.querySelector('.q-amend-input')
      input.addEventListener('input', () => qAmendDraft.set(p.id, input.value))
      const closeAmend = () => { qAmendDraft.delete(p.id); input.value = ''; row.classList.remove('amending') }
      let amSending = false
      const submitAmend = async () => {
        const text = input.value.trim()
        if (!text || amSending) return
        amSending = true
        // Clear the draft + close BEFORE the network round-trip. The bridge's WS
        // 'amended' push can re-render this row while the fetch is still in flight;
        // if the draft were still present the fresh row would restore the field
        // WITH the just-sent text (bit Gerald 2026-07-07: "steht noch drin"). On
        // failure we put the text back.
        closeAmend()
        let ok = false
        try {
          const r = await fetch(`${HTTP}/comments/${p.id}/amend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, author }) })
          if (r.ok) { notify('check', `${p.id} ergänzt`); ok = true }
          else if (r.status === 409) { notify('alert', `${p.id} schon erledigt`); ok = true } // resolved: don't reopen, the amend is moot
          else notify('alert', `${p.id} nicht ergänzt`)
        } catch { notify('alert', 'Bridge offline — nicht ergänzt') }
        if (!ok) { qAmendDraft.set(p.id, text); input.value = text; row.classList.add('amending', 'open'); input.focus() } // give the text back
        amSending = false
      }
      panel.querySelector('.q-amend-send').addEventListener('click', (e) => { e.stopPropagation(); submitAmend() })
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { closeAmend(); return }
        // Enter (or ⌘/Ctrl+Enter) sends; Shift+Enter inserts a newline
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAmend() }
      })
      qAccordion(row, p.id)
      row.querySelector('.q-add').addEventListener('click', (e) => {
        e.stopPropagation()
        const on = row.classList.toggle('amending')
        if (on) { qExpanded.add(p.id); row.classList.add('open'); input.focus() } else closeAmend()
      })
      // restore an in-progress draft across WS re-renders (don't lose a half-typed thought)
      if (qAmendDraft.has(p.id)) { row.classList.add('amending', 'open'); input.value = qAmendDraft.get(p.id); requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }) }
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
        row.innerHTML = `${Q_CHECK}<span class="q-num"></span><span class="q-id"></span><span class="q-text"></span><span class="q-who"></span><span class="q-age"></span>`
        row.querySelector('.q-num').textContent = `#${numOf(p)}`
        row.querySelector('.q-id').textContent = p.id
        row.querySelector('.q-text').textContent = p.text || markLabel(p)
        row.querySelector('.q-who').textContent = p.owner ? splitLabel(p.owner.label).name : ''
        row.querySelector('.q-age').textContent = ageOf(p.resolvedAt || p.createdAt)
        qAccordion(row, p.id)
        list.appendChild(row)
      }
    }
  }

  // ---------- open-nudge pills (subtle DOM presence of the queue) ----------
  // Each open nudge shows its NUMBER at the marked element — the number is the
  // referent for chat („Nudge 123 macht das"), so it must be readable, not a dot.
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
        d.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><g class="d-hand"><path d="M12 6v6l4 2"/></g></svg><span class="d-num"></span>'
        d.querySelector('.d-num').textContent = numOf(p)
        d.title = `#${numOf(p)} · ${p.id} · ${p.text || markLabel(p)}`
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
      // pill width varies with the number — measure after display is set
      d.style.left = Math.min(window.innerWidth - d.offsetWidth - 4, r.right - 10) + 'px'
      d.style.top = Math.max(2, r.top - 9) + 'px'
    }
  }
  let dotRaf = 0
  const scheduleDots = () => { if (!dotRaf) dotRaf = requestAnimationFrame(() => { dotRaf = 0; positionDots() }) }
  addEventListener('scroll', scheduleDots, { capture: true, passive: true })
  addEventListener('resize', scheduleDots, { passive: true })
  setInterval(() => { if (dots.children.length) positionDots() }, 1500) // SPA re-renders move anchors without scroll
  function showQueue() {
    whoMenu.classList.remove('on'); statusMenu.classList.remove('on') // only one popover open at a time
    renderQueue()
    anchorPopover(queue, pill.querySelector('.count'), 420) // 420 = .queue width in styles.js
    queue.classList.add('on')
  }
  function hideQueue() { queue.classList.remove('on') }
  const onDocPointerDown = (e) => {
    const path = e.composedPath()
    // status hint closes on any outside click (independent of the other popovers)
    if (statusMenu.classList.contains('on') && !path.includes(statusMenu) && !path.includes(pill.querySelector('.status'))) statusMenu.classList.remove('on')
    if (!queue.classList.contains('on')) return
    if (!path.includes(queue) && !path.includes(pill.querySelector('.count'))) hideQueue()
    if (whoMenu.classList.contains('on') && !path.includes(whoMenu) && !path.includes(pill.querySelector('.who'))) whoMenu.classList.remove('on')
  }
  document.addEventListener('pointerdown', onDocPointerDown, true)

  function updatePill() {
    const dot = pill.querySelector('.status')
    // A pull owner (CLI) IS live (heartbeating) but does NOT auto-start on a new
    // nudge — the icon stays green (honest: an agent owns this host), the TEXT
    // tells the truth about whether it comes automatically.
    const pull = agentLive && agentWake === 'pull'
    dot.classList.toggle('ok', wsOk && agentLive)
    dot.classList.toggle('half', wsOk && !agentLive)
    dot.title = !wsOk ? 'Bridge unreachable'
      : !agentLive ? 'Bridge up — no agent (nudges are stored)'
      : pull ? `Erfasst — ${agentLabel ? splitLabel(agentLabel).name : '?'} (CLI): im Terminal „weiter" tippen, dann kommt der Nudge`
      : `Agent live — ${agentLabel ? splitLabel(agentLabel).name : '?'} (kommt automatisch)`
    // session label + this tab's localhost IN the toolbar (Gerald: always know
    // which agent reacts AND which localhost this is)
    const who = pill.querySelector('.who')
    const showWho = wsOk && (agentLive && !!agentLabel || agents.length > 0)
    const owner = agentLive && agentLabel ? splitLabel(agentLabel) : null
    // "Agent:" in the Pick/Freeform typeface names what the line behind it IS
    who.querySelector('.who-kind').textContent = owner ? 'Agent:' : ''
    who.querySelector('.who-label').textContent = owner ? owner.name : (agents.length ? `${agents.length} sessions` : '')
    // the owner's session id8, visible WITHOUT any click — the un-collidable key
    // the /nudge arm-report prints, so Gerald matches chat ↔ toolbar at a glance
    const ownerAgent = agents.find(a => a.owner)
    who.querySelector('.who-id').textContent = owner && ownerAgent?.session ? ownerAgent.session : ''
    // honest wake mode right in the toolbar: „Pull" (amber, needs your action)
    // for a CLI owner, nothing for an auto-waking Zed owner — green must not imply
    // „kommt automatisch" when it doesn't (Gerald: Nudges „kommen nicht an" im CLI)
    const wakeTag = who.querySelector('.who-wake')
    wakeTag.textContent = pull ? 'Pull' : ''
    wakeTag.title = pull ? 'CLI-Session: Nudge ist gespeichert, kommt beim nächsten „weiter" im Terminal' : ''
    wakeTag.style.display = pull ? 'inline-block' : 'none'
    // the localhost as a clean pill (from the label's :PORT suffix), never inline in the name
    who.querySelector('.who-host').textContent = owner?.port ? `localhost:${owner.port}` : ''
    who.title = showWho ? 'Switch session — pick which agent gets your nudges' : ''
    who.style.display = showWho ? 'inline-flex' : 'none'
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
          if (agentLive && msg.agentLabel && msg.agentLabel !== agentLabel) { const s = splitLabel(msg.agentLabel); notify('check', `Agent: ${s.name}`, s.port ? `localhost:${s.port}` : '') }
          agentLabel = agentLive ? msg.agentLabel || null : null
          agentWake = agentLive ? (msg.agentWake || null) : null
          agents = msg.agents || []
          if (whoMenu.classList.contains('on')) renderWhoMenu() // live refresh
          if (statusMenu.classList.contains('on')) renderStatusMenu() // live refresh: arm/disarm reflects at once
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
  const isEditable = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  const onWinKeyDown = (e) => {
    if (e.key === 'Escape' && statusMenu.classList.contains('on')) { statusMenu.classList.remove('on'); return }
    if (e.key === 'Escape' && whoMenu.classList.contains('on')) { whoMenu.classList.remove('on'); return }
    if (e.key === 'Escape' && queue.classList.contains('on')) { hideQueue(); return }
    if (e.key === 'Escape' && mode !== 'off') { setMode('idle'); return }
    // single-key tool switch (Figma/Cursor-design-mode convention), tightly
    // gated so it never fights the page: only when the overlay is active but not
    // composing, no modifier, focus not in any editable field, no popover open.
    if (mode === 'off' || mode === 'composing') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditable(e.target) || isEditable(document.activeElement)) return
    if (whoMenu.classList.contains('on') || queue.classList.contains('on') || statusMenu.classList.contains('on')) return
    const k = e.key.toLowerCase()
    if (k === 'p') { e.preventDefault(); e.stopPropagation(); setMode(mode === 'picking' ? 'idle' : 'picking') }
    else if (k === 'f') { e.preventDefault(); e.stopPropagation(); setMode(mode === 'drawing' ? 'idle' : 'drawing') }
  }
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('pointerdown', onClick, true)
  document.addEventListener('click', onClickSuppress, true)
  // WINDOW capture, the first hop — not document (bit Gerald 2026-07-29: "die
  // Markierungen verschwinden nicht"). Dialog/dropdown libraries (Radix, Headless
  // UI, @roots/ui) handle Escape on window capture and stopPropagation() it while
  // their layer is open; a document-capture listener downstream then never runs,
  // so Esc silently stopped clearing the pick — and P/F stopped switching tools —
  // on exactly the real apps Nudge is for. Same lesson as the moat below. (A page
  // listener on the SAME node can't suppress us: stopImmediatePropagation does not
  // cross into the content script's isolated world — only halting propagation one
  // node earlier does. Suite O pins both directions.)
  window.addEventListener('keydown', onWinKeyDown, true)

  // ---------- moat: reaching for the toolbar must not dismiss page state ----------
  // A page modal often uses a full-screen backdrop that hides on any click
  // outside it (roots' own RequestPopover: overlay-click → hide). The Nudge host
  // is full-screen but pointer-events:none, so a click that just MISSES the
  // toolbar falls THROUGH and dismisses the page's modal — reaching for the
  // toolbar shouldn't touch the page (bit Gerald 2026-07-07). Absorb near-miss
  // clicks in a thin moat around visible Nudge chrome. Only idle/composing —
  // picking/drawing genuinely need page clicks — and only the immediate margin,
  // so real page clicks farther away dismiss the modal as the page intends.
  const MOAT = 12
  const nearChrome = (x, y) => {
    const widgets = [pill]
    if (mode === 'composing') widgets.push(composer)
    if (queue.classList.contains('on')) widgets.push(queue)
    if (whoMenu.classList.contains('on')) widgets.push(whoMenu)
    if (statusMenu.classList.contains('on')) widgets.push(statusMenu)
    for (const w of widgets) {
      const r = w.getBoundingClientRect()
      if (r.width && x >= r.left - MOAT && x <= r.right + MOAT && y >= r.top - MOAT && y <= r.bottom + MOAT) return true
    }
    return false
  }
  const swallowMoat = (e) => {
    if (mode === 'off' || mode === 'picking' || mode === 'drawing') return
    // ...and never a Shift+click that extends the selection: the composer opens
    // BESIDE the mark, so the next element Gerald wants is often exactly in the
    // moat — the second half of "Shift geht nicht zuverlässig" (2026-07-29).
    // Nobody reaches for the toolbar with Shift held, so the moat's premise
    // (an ACCIDENTAL near-miss) simply doesn't apply to this gesture.
    if (e.shiftKey && mode === 'composing' && picked && !picked.stroke) return
    if (inOverlay(e)) return // a real widget hit — its own handlers run
    // caught at WINDOW capture, the first hop: stopping here blocks the page's
    // backdrop-click AND any capture-phase outside-click dismisser downstream
    if (nearChrome(e.clientX, e.clientY)) { e.preventDefault(); e.stopImmediatePropagation() }
  }
  const MOAT_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
  for (const t of MOAT_EVENTS) window.addEventListener(t, swallowMoat, true)

  // Page menus/dropdowns often detect outside-clicks with a document CAPTURE-phase
  // pointerdown listener (roots' own @roots/ui actionMenu: addEventListener(
  // 'pointerdown', onOutside, true)). A click on Nudge chrome retargets to our
  // host — "outside" their menu — so the menu closes the instant Gerald reaches
  // for the toolbar (bit Gerald 2026-07-07 on the estimate sort dropdown). The
  // host bubble-stop is too late (capture fires first). Swallow the pointerdown/
  // mousedown of a genuine Nudge-widget hit at WINDOW capture, the first hop, so
  // no page outside-detector — capture or bubble — ever sees it. Our controls act
  // on `click` (a separate event, still fires); the grip needs its own
  // pointerdown for dragging, so leave it through.
  const swallowChromePointer = (e) => {
    if (!inOverlay(e)) return
    // widgets that genuinely need their OWN pointerdown: the grip (drag), the
    // draw layer (lasso), and any text field (caret placement / focus — the
    // composer textarea, the History amend input). Everything else in the chrome
    // acts on `click`, so swallowing its pointerdown blocks the page's
    // outside-detector without any loss.
    const path = e.composedPath()
    if (path.includes(grip) || path.includes(draw)) return
    const t = path[0]
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    e.stopImmediatePropagation()
  }
  const CHROME_POINTER_EVENTS = ['pointerdown', 'mousedown']
  for (const t of CHROME_POINTER_EVENTS) window.addEventListener(t, swallowChromePointer, true)

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
      document.removeEventListener('click', onClickSuppress, true)
      window.removeEventListener('keydown', onWinKeyDown, true)
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      for (const t of MOAT_EVENTS) window.removeEventListener(t, swallowMoat, true)
      for (const t of CHROME_POINTER_EVENTS) window.removeEventListener(t, swallowChromePointer, true)
      host.remove()
      showReloadHint() // don't vanish silently — tell Gerald the one keystroke that heals the tab
    }
  }, 5000)

  // The overlay used to disappear WITHOUT A WORD when the extension reloaded
  // (dev auto-reload, update): the tab looked like "Nudge kaputt" until a manual
  // page reload (bit Gerald 2026-07-08). Plain-DOM banner — no chrome.* (the
  // context is dead), no shadow styles (the host is gone): one pill in the brand
  // midnight, dismiss on click, gone with the reload it asks for.
  function showReloadHint() {
    if (document.getElementById('__roots-nudge-reload-hint')) return
    const n = document.createElement('div')
    n.id = '__roots-nudge-reload-hint'
    n.textContent = 'Nudge aktualisiert — ⌘R lädt die Toolbar neu'
    n.title = 'Klicken zum Ausblenden'
    n.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#1A1F26;color:#F2EFEA;font:500 12px/1.4 -apple-system,"Helvetica Neue",sans-serif;letter-spacing:.01em;padding:8px 14px;border-radius:999px;border:1px solid #3A4250;box-shadow:0 1px 2px rgba(0,0,0,.3),0 4px 12px rgba(14,19,24,.35);cursor:pointer;'
    n.addEventListener('click', () => n.remove())
    document.documentElement.appendChild(n)
  }

  setMode('idle') // PoC: overlay visible by default on localhost; Alt+C / toolbar icon toggles
  // resolve the (test-only) port override, THEN open the connection
  try {
    chrome.storage.local.get('nudgePort')
      .then(({ nudgePort }) => {
        if (nudgePort) { HTTP = `http://localhost:${nudgePort}`; WS = `ws://localhost:${nudgePort}` }
        connect()
      })
      .catch(() => connect())
  } catch { connect() }
})()
