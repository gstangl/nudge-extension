// Pin overlay styles — injected into the shadow root by content.js via
// adoptedStyleSheets (a manifest "css" entry would land in the page, not the
// shadow DOM). Loaded before content.js; shared via globalThis like finder.js.
//
// DESIGN CONTRACT: the values below are MIRRORED from @roots/design tokens.css
// (self-contained by design — Pin must work without the repo; keep in sync by
// hand). Language: monochrome midnight — paper-on-midnight contrast everywhere;
// COLOUR ONLY FOR STATUS (green live / amber degraded / red dead) and for the
// on-page marking accent (highlight/lasso, brand terracotta). Type: DIN Var
// (shipped with the extension as "Roots Nudge DIN"), mono only for selectors.
;(() => {
  // — mirrored Roots tokens —
  const MID = '#1A1F26'        // --midnight        structural set
  const MID_DEEP = '#0E1318'   // --midnight-deep   deepest bands
  const MID_2 = '#2A3038'      // --midnight-2      hairlines on midnight
  const MID_3 = '#3A4250'      // --midnight-3      rules / borders on midnight
  const PAPER = '#F2EFEA'      // --paper-2         text + primary button on midnight
  const ACCENT = '#b45a38'     // brand terracotta — ON-PAGE marking only
  const GREEN = '#3fa34d'      // status: agent live
  const AMBER = '#d9a441'      // status: degraded
  const SANS = `"Roots Nudge DIN", "DIN Var", -apple-system, 'Helvetica Neue', sans-serif`
  const MONO = `ui-monospace, 'SF Mono', Menlo, monospace`

  globalThis.__nudgeCss = `
    :host { all: initial }
    * { box-sizing: border-box; font-family: ${SANS}; }

    /* ---------- pill toolbar: monochrome midnight ---------- */
    .pill {
      position: fixed; top: 20px; right: 20px;
      display: none; align-items: center; gap: 2px; pointer-events: auto;
      background: ${MID}; border: 1px solid ${MID_3};
      border-radius: 999px; padding: 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 4px 12px rgba(14,19,24,.35), 0 12px 32px rgba(14,19,24,.4);
      user-select: none;
    }
    .pill .grip {
      display: flex; align-items: center; padding: 4px 2px 4px 8px; cursor: grab;
      color: rgba(242,239,234,.3); touch-action: none;
    }
    .pill .grip:hover { color: rgba(242,239,234,.7); }
    .pill .grip.dragging { cursor: grabbing; }
    .pill .grip svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; }
    .pill .status { width: 7px; height: 7px; border-radius: 50%; margin: 0 4px; background: rgba(242,239,234,.28); transition: background .3s ease; }
    .pill .status.ok { background: ${GREEN}; }
    .pill .status.half { background: ${AMBER}; }
    .pill .sep { width: 1px; height: 16px; background: ${MID_2}; margin: 0 4px; }
    .pill .who {
      display: none; max-width: 150px; padding: 0 10px 0 4px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 12px; color: rgba(242,239,234,.55); font-variation-settings: "wght" 400;
      letter-spacing: .01em; cursor: pointer; user-select: none;
    }
    .pill .who:hover { color: ${PAPER}; }
    /* session dropdown: who owns the wake channel — midnight family like the queue */
    .who-menu {
      position: fixed; width: 340px; pointer-events: auto; z-index: 3;
      background: ${MID}; border: 1px solid ${MID_3}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(14,19,24,.45);
      overflow: hidden; opacity: 0; transform: translateY(-4px); pointer-events: none;
      transition: opacity .16s ease-out, transform .16s ease-out;
    }
    .who-menu.on { opacity: 1; transform: none; pointer-events: auto; }
    .who-menu .q-head {
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      font-size: 11px; color: rgba(242,239,234,.55); font-variation-settings: "wght" 550;
    }
    .who-menu .w-row { padding: 10px 14px; border-bottom: 1px solid ${MID_2}; cursor: pointer; }
    .who-menu .w-row:last-child { border-bottom: 0; }
    .who-menu .w-row:hover { background: rgba(242,239,234,.06); }
    .who-menu .w-row.is-owner .w-line1 { color: ${GREEN}; }
    .who-menu .w-line1 { font-size: 12px; color: ${PAPER}; font-variation-settings: "wght" 600; }
    .who-menu .w-line2 { font-size: 10px; color: rgba(242,239,234,.5); margin-top: 2px; font-family: ${MONO}; }
    .who-menu .w-line3 { font-size: 11px; color: rgba(242,239,234,.45); margin-top: 3px; font-style: italic; }
    .pill button {
      display: flex; align-items: center; gap: 6px; border: 0; cursor: pointer;
      background: transparent; color: rgba(242,239,234,.68); font-size: 12px;
      font-family: ${SANS}; font-variation-settings: "wght" 500; letter-spacing: .01em;
      padding: 6px 12px; border-radius: 999px; transition: background .15s ease, color .15s ease;
    }
    .pill button:hover { background: rgba(242,239,234,.08); color: ${PAPER}; }
    .pill button.active { background: ${PAPER}; color: ${MID_DEEP}; }
    .pill svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .pill .count {
      min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; margin: 0 2px;
      background: rgba(242,239,234,.14); color: ${PAPER}; font-size: 10px;
      font-variation-settings: "wght" 650;
      display: none; align-items: center; justify-content: center;
      cursor: pointer; transition: background .12s;
    }
    .pill .count:hover { background: rgba(242,239,234,.26); }
    .pill .count.show { display: flex; }

    /* queue popover: what the badge number MEANS — read-only peek, midnight family */
    .queue {
      position: fixed; width: 320px; pointer-events: auto; z-index: 2;
      background: ${MID}; border: 1px solid ${MID_3}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(14,19,24,.45);
      overflow: hidden; opacity: 0; transform: translateY(-4px); pointer-events: none;
      transition: opacity .16s ease-out, transform .16s ease-out;
    }
    .queue.on { opacity: 1; transform: none; pointer-events: auto; }
    .queue .q-head {
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      font-size: 11px; color: rgba(242,239,234,.55); font-variation-settings: "wght" 550;
      letter-spacing: .01em;
    }
    .queue .q-row {
      display: flex; align-items: center; gap: 8px; padding: 9px 14px;
      font-size: 12px; color: rgba(242,239,234,.85);
      border-bottom: 1px solid ${MID_2};
    }
    .queue .q-row:last-child { border-bottom: 0; }
    .queue .q-row { cursor: pointer; }
    .queue .q-row.open { align-items: flex-start; }
    .queue .q-row.open .q-dot { margin-top: 1px; }
    .queue .q-row.open .q-id, .queue .q-row.open .q-age { margin-top: 1px; }
    .queue .q-row.open .q-text { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.5; }
    .queue .q-dot {
      flex: none; width: 18px; height: 18px; border-radius: 50%;
      background: ${MID_DEEP}; border: 2px solid ${PAPER};
      box-shadow: 0 1px 4px rgba(14,19,24,.4);
      display: flex; align-items: center; justify-content: center;
    }
    .queue .q-dot svg { display: block; width: 10px; height: 10px; stroke: ${AMBER}; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    .queue .q-dot.q-done svg { stroke: ${GREEN}; }
    .queue .q-hand { transform-box: view-box; transform-origin: 50% 50%; }
    .queue .q-row.live .q-hand { animation: q-sweep 4s linear infinite; }
    @keyframes q-sweep { to { transform: rotate(360deg) } }
    .queue .q-id { font-family: ${MONO}; font-size: 10px; color: rgba(242,239,234,.45); flex: none; }
    .queue .q-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queue .q-age { flex: none; font-size: 10px; color: rgba(242,239,234,.4); }
    .queue .q-x {
      flex: none; width: 18px; height: 18px; border: 0; border-radius: 6px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0;
      background: transparent; color: rgba(242,239,234,.4); font-size: 14px; line-height: 1;
      font-family: ${SANS}; transition: background .12s, color .12s;
    }
    .queue .q-x:hover { background: rgba(242,239,234,.14); color: ${PAPER}; }
    .queue .q-x:focus-visible { outline: 2px solid rgba(242,239,234,.55); outline-offset: 1px; }
    .queue .q-div {
      padding: 7px 14px 5px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
      color: rgba(242,239,234,.4); font-variation-settings: "wght" 600;
    }
    .queue .q-row.done { color: rgba(242,239,234,.55); }

    .pill button:focus-visible, .composer button:focus-visible, .composer textarea:focus-visible,
    .composer .layers button:focus-visible {
      outline: 2px solid rgba(242,239,234,.55); outline-offset: 2px;
    }

    /* open-prompt dots: one amber status dot per marked element while its prompt
       is open (status colour, deliberately tiny — click opens the queue popover) */
    .dots { position: fixed; left: 0; top: 0; width: 0; height: 0; }
    .dot {
      position: fixed; width: 17px; height: 17px; border-radius: 50%;
      background: ${MID_DEEP}; border: 2px solid ${PAPER};
      box-shadow: 0 1px 4px rgba(14,19,24,.4);
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto; cursor: pointer;
      animation: dot-in .2s ease-out;
    }
    @keyframes dot-in { from { transform: scale(.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
    .dot svg { display: block; width: 9px; height: 9px; stroke: ${AMBER}; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    .dot .d-hand { transform-box: view-box; transform-origin: 50% 50%; }
    .dot.live .d-hand { animation: q-sweep 4s linear infinite; }

    /* ---------- on-page marking: brand accent stays (not part of the chrome) ---------- */
    .hl {
      position: fixed; opacity: 0; pointer-events: none;
      border: 2px solid ${ACCENT}; border-radius: 3px;
      background: rgba(180,90,56,.08); box-shadow: 0 0 0 4px rgba(180,90,56,.15);
      transition: left .1s ease-out, top .1s ease-out, width .1s ease-out,
                  height .1s ease-out, opacity .12s ease-out;
    }
    .hl.on { opacity: 1; }
    .hl.instant { transition: none; } /* screenshot capture: box must be fully there NOW */
    .hl .chip {
      position: absolute; top: -26px; left: -2px; white-space: nowrap;
      max-width: 60ch; overflow: hidden; text-overflow: ellipsis;
      background: ${MID_DEEP}; color: ${PAPER}; font-size: 11px; font-family: ${MONO};
      letter-spacing: .01em; padding: 3px 8px; border-radius: 4px 4px 4px 0;
      border: 1px solid ${MID_3};
      box-shadow: 0 1px 3px rgba(0,0,0,.25);
    }
    .hl.flip .chip { top: auto; bottom: -26px; border-radius: 0 4px 4px 4px; }
    .hl .chip:empty { display: none; }
    /* multi-selection outlines: transient (only while composing), thinner than
     * the hover box so the set reads as "collected", not "active" */
    .hl-multi {
      position: fixed; pointer-events: none;
      border: 1.5px solid ${ACCENT}; border-radius: 3px;
      background: rgba(180,90,56,.05);
    }
    .draw { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; cursor: crosshair; }
    .draw.on { pointer-events: auto; }
    .draw path { fill: rgba(180,90,56,.06); stroke: ${ACCENT}; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }

    /* ---------- composer: monochrome midnight popover with anchor tip ---------- */
    .composer {
      position: fixed; display: none; width: 340px; pointer-events: auto;
      background: ${MID}; border: 1px solid ${MID_3}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(14,19,24,.45), 0 28px 72px rgba(14,19,24,.38);
      animation: nudge-fade .16s ease-out; /* re-runs on each display:none -> block */
    }
    @keyframes nudge-fade { from { opacity: 0; transform: translateY(4px) scale(.985) } to { opacity: 1; transform: none } }
    .composer .inner { border-radius: 11px; overflow: hidden; }
    /* tip: a bordered diamond pointing back at the marked element */
    .composer .tip {
      position: absolute; width: 12px; height: 12px; top: var(--tip-y, 18px);
      background: ${MID}; border-left: 1px solid ${MID_3}; border-bottom: 1px solid ${MID_3};
    }
    .composer.tip-left .tip { left: -6.5px; transform: rotate(45deg); }
    .composer.tip-right .tip { right: -6.5px; transform: rotate(225deg); }
    .composer .layers { display: none; flex-wrap: wrap; gap: 4px; padding: 10px 12px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2}; }
    .composer .layers button {
      border: 1px solid ${MID_3}; border-radius: 999px; padding: 3px 9px; cursor: pointer;
      background: transparent; color: rgba(242,239,234,.55); font-size: 10px; font-family: ${MONO};
      transition: color .12s, border-color .12s, background .12s;
    }
    .composer .layers button:hover { color: ${PAPER}; border-color: rgba(242,239,234,.4); }
    .composer .layers button.active { background: ${PAPER}; border-color: ${PAPER}; color: ${MID_DEEP}; }
    .composer .meta {
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      font-size: 10px; font-family: ${MONO}; color: rgba(242,239,234,.45);
      letter-spacing: .02em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .composer textarea {
      width: 100%; border: 0; outline: 0; resize: none; padding: 13px 14px;
      font-size: 13px; line-height: 1.5; min-height: 78px; font-family: ${SANS};
      color: ${PAPER}; background: transparent; caret-color: ${PAPER};
    }
    .composer textarea::placeholder { color: rgba(242,239,234,.32); }
    .composer textarea::selection { background: rgba(242,239,234,.22); }
    .composer .row {
      display: flex; justify-content: flex-end; align-items: center; gap: 10px;
      padding: 10px 12px; border-top: 1px solid ${MID_2};
    }
    .composer .row button {
      border: 0; border-radius: 8px; padding: 7px 16px; font-size: 12px; cursor: pointer;
      font-family: ${SANS}; font-variation-settings: "wght" 600; letter-spacing: .01em;
      transition: background .12s, color .12s;
    }
    .composer .cancel { background: transparent; color: rgba(242,239,234,.5); }
    .composer .cancel:hover { color: ${PAPER}; }
    .composer .send { background: ${PAPER}; color: ${MID_DEEP}; }
    .composer .send:hover { background: #fff; }
    .composer .send:disabled { opacity: .45; cursor: default; }

    /* ---------- feedback feed: monochrome chips, colour = status only ---------- */
    .feed {
      position: fixed; top: 64px; right: 20px; display: flex; flex-direction: column;
      align-items: flex-end; gap: 6px; pointer-events: none; max-width: 340px;
    }
    .feed .item {
      display: flex; align-items: center; gap: 8px;
      background: ${MID}; color: rgba(242,239,234,.85); font-size: 12px; padding: 7px 12px;
      font-family: ${SANS}; font-variation-settings: "wght" 500; letter-spacing: .01em;
      border: 1px solid ${MID_3}; border-radius: 999px;
      box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 4px 12px rgba(14,19,24,.3);
      opacity: 0; transform: translateY(-4px);
      transition: opacity .25s ease, transform .25s ease;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .feed .item.show { opacity: 1; transform: none; }
    .feed .item.bye { opacity: 0; transform: translateY(-4px); }
    .feed .item svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .feed .item.ok svg { color: ${GREEN}; }
    .feed .item.warn svg { color: ${AMBER}; }
  `
})()
