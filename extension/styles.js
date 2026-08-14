// Pin overlay styles — injected into the shadow root by content.js via
// adoptedStyleSheets (a manifest "css" entry would land in the page, not the
// shadow DOM). Loaded before content.js; shared via globalThis like finder.js.
//
// DESIGN CONTRACT: the values below are MIRRORED from @roots/design tokens.css
// (self-contained by design — Pin must work without the repo; keep in sync by
// hand). Language: monochrome midnight — paper-on-midnight contrast everywhere;
// COLOUR ONLY FOR STATUS (green live / amber degraded / red dead) and for the
// on-page marking accent (highlight/lasso, brand terracotta). Type: IBM Plex Sans,
// shipped as "Roots Nudge Sans" — the rename is an OFL obligation, not a whim:
// "Plex" is a Reserved Font Name and we ship a subset. See fonts/HERKUNFT.md.
// Mono only for selectors.
//
// TYPE TUNING — replaced the licensed DIN Var (2026-08-14), matched to it by
// measurement, not by eye. Two calibrations, don't "simplify" them:
//   1. WEIGHTS are remapped by measured STEM WIDTH, because this face is lighter
//      per nominal step: DIN Var 400/500/550/600/650 → 365/470/500/540/590.
//      An untagged element must therefore say "wght" 365, not inherit 400 —
//      hence the value on the * rule below.
//   2. LETTER-SPACING is DIN Var's original set, untouched. The width axis is
//      baked at 100, where the set width matches DIN Var to the pixel (227.3px
//      for a 12px test line), so no tracking correction is needed.
// Figures are tabular by default here — `font-variant-numeric: tabular-nums`
// below is belt-and-braces, not load-bearing.
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
  const SANS = `"Roots Nudge Sans", -apple-system, 'Helvetica Neue', sans-serif`
  const MONO = `"Roots Nudge Mono", ui-monospace, 'SF Mono', Menlo, monospace`

  globalThis.__nudgeCss = `
    :host { all: initial }
    /* wght 365 = DIN Var's old 400 by stem width (see TYPE TUNING at the top).
       Without it every element that sets no weight — the composer textarea, the
       amend input — would render at the family's default 400 and sit too heavy. */
    * { box-sizing: border-box; font-family: ${SANS}; font-variation-settings: "wght" 365; }

    /* ---------- pill toolbar: monochrome midnight ----------
       The 20px corner is mirrored as CORNER in content.js: the bar is always
       drawn at an INLINE left/top so it can be kept fully inside the viewport
       (fitPill) — this rule is the default spot it starts from. */
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
    /* the 7px dot keeps its look; 4px padding (content-box) makes it a 15px click
       target — same horizontal footprint as before (7 + 8 margin), so no layout
       shift. background-clip: content-box keeps the colour on the 7px core only. */
    .pill .status {
      box-sizing: content-box; width: 7px; height: 7px; padding: 4px; margin: 0;
      border-radius: 50%; cursor: pointer;
      background-color: rgba(242,239,234,.28); background-clip: content-box;
      transition: background-color .3s ease;
    }
    .pill .status:hover { filter: brightness(1.3); }
    .pill .status.ok { background-color: ${GREEN}; }
    .pill .status.half { background-color: ${AMBER}; }
    .pill .sep { width: 1px; height: 16px; background: ${MID_2}; margin: 0 4px; }
    .pill .who {
      display: none; align-items: center; padding: 0 6px 0 4px;
      cursor: pointer; user-select: none;
    }
    /* "Agent:" kind label — the Pick/Freeform button typeface (wght 470, brighter),
       so it reads as a label and the session name behind it as its value */
    .pill .who-kind {
      flex: none; margin-right: 5px; font-size: 12px; line-height: 18px;
      color: rgba(242,239,234,.68); font-variation-settings: "wght" 470; letter-spacing: .01em;
    }
    .pill .who-kind:empty { display: none; }
    .pill .who:hover .who-kind { color: ${PAPER}; }
    .pill .who-label {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;
      font-size: 12px; line-height: 18px; color: rgba(242,239,234,.55); font-variation-settings: "wght" 365; letter-spacing: .01em;
    }
    .pill .who:hover .who-label { color: ${PAPER}; }
    /* owner session id8 — quiet mono, no frame (vs the framed host pill), visible
       without any click so the /nudge chat report matches the toolbar at a glance */
    .pill .who-id {
      flex: none; margin-left: 6px; font-family: ${MONO}; font-size: 10px; line-height: 18px;
      letter-spacing: 0; font-variation-settings: normal; color: rgba(242,239,234,.35);
    }
    .pill .who-id:empty { display: none; }
    .pill .who:hover .who-id { color: rgba(242,239,234,.6); }
    /* subtle localhost tag next to the session in the TOOLBAR (this tab's host).
       Box height = 14 lh + 2 padding + 2 border = 18px, exactly the label's line
       box, so align-items:center puts chip and text on ONE clean baseline. */
    .pill .who-host {
      flex: none; font-family: ${MONO}; font-size: 10px; line-height: 14px; font-variation-settings: normal; letter-spacing: 0;
      color: rgba(242,239,234,.5); background: rgba(242,239,234,.05);
      border: 1px solid rgba(242,239,234,.10); border-radius: 5px;
      padding: 1px 5px; margin-left: 6px; white-space: nowrap;
    }
    .pill .who-host:empty { display: none; }
    /* wake-mode tag: shown ONLY for a pull owner (CLI) — amber signals „needs your
       action" (the nudge is stored but comes on the next terminal prompt, not by
       itself). Auto/push owners show nothing: green already means „kommt von selbst". */
    .pill .who-wake {
      flex: none; font-family: ${SANS}; font-size: 10px; line-height: 14px;
      font-variation-settings: "wght" 590; letter-spacing: .02em;
      color: ${AMBER}; background: rgba(217,164,65,.12);
      border: 1px solid rgba(217,164,65,.35); border-radius: 5px;
      padding: 1px 5px; margin-left: 6px; white-space: nowrap;
    }
    .pill .who-wake:empty { display: none; }
    /* session dropdown: who owns the wake channel — midnight family like the queue */
    .who-menu {
      position: fixed; width: 460px; pointer-events: auto; z-index: 3;
      background: ${MID}; border: 1px solid ${MID_3}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(14,19,24,.45);
      opacity: 0; transform: translateY(-4px); pointer-events: none;
      transition: opacity .16s ease-out, transform .16s ease-out;
    }
    .who-menu.on { opacity: 1; transform: none; pointer-events: auto; }
    .who-menu .q-head {
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      border-radius: 11px 11px 0 0;
      font-size: 11px; color: rgba(242,239,234,.55); font-variation-settings: "wght" 500;
    }
    .who-menu .w-row { padding: 10px 14px; border-bottom: 1px solid ${MID_2}; cursor: pointer; }
    .who-menu .w-row:last-child { border-bottom: 0; }
    .who-menu .w-row:hover { background: rgba(242,239,234,.06); }
    .who-menu .w-row.is-owner .w-name { color: ${GREEN}; }
    .who-menu .w-line1 { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 18px; color: ${PAPER}; font-variation-settings: "wght" 540; }
    .who-menu .w-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 18px; }
    /* subtle localhost tag, right-aligned per session row — box = 14 lh + 2 pad + 2 border = 18px = the name's line box */
    .who-menu .w-host {
      flex: none; font-family: ${MONO}; font-size: 10px; line-height: 14px; font-variation-settings: normal; letter-spacing: 0;
      color: rgba(242,239,234,.5); background: rgba(242,239,234,.05);
      border: 1px solid rgba(242,239,234,.10); border-radius: 5px;
      padding: 1px 5px; white-space: nowrap;
    }
    .who-menu .w-line2 { font-size: 10px; line-height: 11px; color: rgba(242,239,234,.5); margin-top: 6px; font-family: ${MONO}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who-menu .w-line3 { font-size: 11px; color: rgba(242,239,234,.45); margin-top: 5px; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill button {
      display: flex; align-items: center; gap: 6px; border: 0; cursor: pointer;
      background: transparent; color: rgba(242,239,234,.68); font-size: 12px;
      font-family: ${SANS}; font-variation-settings: "wght" 470; letter-spacing: .01em;
      padding: 6px 12px; border-radius: 999px; transition: background .15s ease, color .15s ease;
    }
    .pill button:hover { background: rgba(242,239,234,.08); color: ${PAPER}; }
    .pill button.active { background: ${PAPER}; color: ${MID_DEEP}; }
    .pill svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .pill .count {
      min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; margin: 0 2px;
      background: rgba(242,239,234,.14); color: ${PAPER}; font-size: 10px;
      font-variation-settings: "wght" 590;
      display: none; align-items: center; justify-content: center;
      cursor: pointer; transition: background .12s;
    }
    .pill .count:hover { background: rgba(242,239,234,.26); }
    .pill .count.show { display: flex; }

    /* queue popover: what the badge number MEANS — read-only peek, midnight family */
    .queue {
      position: fixed; width: 420px; pointer-events: auto; z-index: 2;
      background: ${MID}; border: 1px solid ${MID_3}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(14,19,24,.45);
      opacity: 0; transform: translateY(-4px); pointer-events: none;
      transition: opacity .16s ease-out, transform .16s ease-out;
    }
    /* Caret pointing UP at whatever the user clicked (--caret-x = anchor centre,
       relative to the popover's left edge). Shared by the toolbar popovers (Nudge
       History + Switch session). Two triangles: outer = border colour, inner =
       header fill offset down 1.5px so ~1px of border shows on the edges. No
       overflow:hidden (it would clip the caret) — the header rounds its own top
       corners, the transparent last row rounds via the parent. */
    .queue::before, .queue::after, .who-menu::before, .who-menu::after, .status-menu::before, .status-menu::after {
      content: ""; position: absolute; width: 0; height: 0;
      left: var(--caret-x, 32px); transform: translateX(-50%);
      border-left: 8px solid transparent; border-right: 8px solid transparent;
    }
    .queue::before, .who-menu::before, .status-menu::before { top: -8px; border-bottom: 8px solid ${MID_3}; }
    .queue::after, .who-menu::after, .status-menu::after { top: -6.5px; border-left-width: 7px; border-right-width: 7px; border-bottom: 7px solid ${MID_DEEP}; }
    /* status hint popover — same midnight family as the queue/switcher */
    .status-menu {
      position: fixed; width: 300px; pointer-events: auto; z-index: 3;
      background: ${MID}; border: 1px solid ${MID_3}; border-radius: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(14,19,24,.45);
      opacity: 0; transform: translateY(-4px); pointer-events: none;
      transition: opacity .16s ease-out, transform .16s ease-out;
    }
    .status-menu.on { opacity: 1; transform: none; pointer-events: auto; }
    .status-menu .q-head {
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      border-radius: 11px 11px 0 0;
      font-size: 12px; color: ${PAPER}; font-variation-settings: "wght" 540;
    }
    .status-menu .sm-body {
      padding: 11px 14px; font-size: 12px; line-height: 1.5;
      color: rgba(242,239,234,.72);
    }
    .status-menu .sm-body b { color: ${PAPER}; font-variation-settings: "wght" 590; }
    .queue.on { opacity: 1; transform: none; pointer-events: auto; }
    .queue .q-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      border-radius: 11px 11px 0 0;
      font-size: 11px; color: rgba(242,239,234,.55); font-variation-settings: "wght" 500;
      letter-spacing: .01em;
    }
    .queue .q-head-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .queue .q-head-host {
      flex: none; font-family: ${MONO}; font-size: 10px; line-height: 14px; letter-spacing: 0;
      color: rgba(242,239,234,.5); background: rgba(242,239,234,.05);
      border: 1px solid rgba(242,239,234,.10); border-radius: 5px;
      padding: 1px 5px; white-space: nowrap; font-variation-settings: normal;
    }
    .queue .q-row {
      display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 9px 14px;
      font-size: 12px; line-height: 18px; color: rgba(242,239,234,.85);
      border-bottom: 1px solid ${MID_2};
    }
    .queue .q-row:last-child { border-bottom: 0; }
    .queue .q-row { cursor: pointer; }
    /* Collapsed and open share the SAME first-line geometry: every item (dot,
       id, text, age, ×) has an 18px first-line box, top-aligned via flex-start —
       so expanding only reveals more wrapped lines BELOW. Toggling used to swap
       align-items + margins + line-height at once, jittering the icon and text
       on every open/close (Gerald 2026-07-05). */
    .queue .q-row.open .q-text { white-space: normal; overflow: visible; text-overflow: clip; }
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
    /* the two numbers of a nudge, side by side and weighted by what they are FOR:
       #47 is what Gerald reads off the pill and says out loud, so it leads and is
       legible; nudge_1046 is the identity behind it (files, commits) and stays a
       muted footnote. Same order and same pair as the inbox heading. */
    .queue .q-num {
      font-family: ${MONO}; font-size: 10px; line-height: 18px; flex: none;
      color: rgba(242,239,234,.78); font-variant-numeric: tabular-nums;
    }
    .queue .q-id { font-family: ${MONO}; font-size: 10px; line-height: 18px; color: rgba(242,239,234,.45); flex: none; }
    .queue .q-text { flex: 1; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* owning agent session (immutable per nudge) — a muted tag so provenance
       stays visible even after the channel owner changes */
    .queue .q-who {
      flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 10px; line-height: 18px; color: rgba(242,239,234,.42);
      font-variation-settings: "wght" 500;
    }
    .queue .q-who:not(:empty)::before { content: "· "; color: rgba(242,239,234,.28); }
    .queue .q-age { flex: none; font-size: 10px; line-height: 18px; color: rgba(242,239,234,.4); }
    .queue .q-x {
      flex: none; width: 18px; height: 18px; border: 0; border-radius: 6px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0;
      background: transparent; color: rgba(242,239,234,.4); font-size: 14px; line-height: 1;
      font-family: ${SANS}; transition: background .12s, color .12s;
    }
    .queue .q-x:hover { background: rgba(242,239,234,.14); color: ${PAPER}; }
    .queue .q-x:focus-visible { outline: 2px solid rgba(242,239,234,.55); outline-offset: 1px; }
    /* "+N" follow-up count on a nudge that carries amendments. No weight here:
       the mono is a static face, so a font-variation-settings would be inert —
       it was, silently, for as long as this line existed. Colour does the work. */
    .queue .q-amc { flex: none; font-family: ${MONO}; font-size: 10px; line-height: 18px; color: ${ACCENT}; }
    /* "+ ergänzen" button — same ghost language as × */
    .queue .q-add {
      flex: none; width: 18px; height: 18px; border: 0; border-radius: 6px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0;
      background: transparent; color: rgba(242,239,234,.4); font-size: 15px; line-height: 1;
      font-family: ${SANS}; transition: background .12s, color .12s;
    }
    .queue .q-add:hover { background: rgba(242,239,234,.14); color: ${PAPER}; }
    .queue .q-add:focus-visible { outline: 2px solid rgba(242,239,234,.55); outline-offset: 1px; }
    .queue .q-row.amending .q-add { background: rgba(180,90,56,.22); color: ${ACCENT}; }
    /* follow-ups — readable under the row when it's EXPANDED or being amended */
    .queue .q-amend-list { display: none; flex: 0 0 100%; flex-direction: column; gap: 4px; margin-top: 4px; }
    .queue .q-row.open .q-amend-list, .queue .q-row.amending .q-amend-list { display: flex; }
    .queue .q-amend-item {
      font-size: 12px; line-height: 1.45; color: rgba(242,239,234,.72); white-space: pre-wrap;
      padding-left: 10px; border-left: 2px solid rgba(180,90,56,.55);
    }
    /* the input panel: a full-width row, only while amending */
    .queue .q-amend { display: none; flex: 0 0 100%; margin-top: 6px; }
    .queue .q-row.amending .q-amend { display: block; }
    .queue .q-amend-row { display: flex; align-items: flex-end; gap: 6px; }
    .queue .q-amend-input {
      flex: 1; min-width: 0; box-sizing: border-box; resize: none; min-height: 34px; max-height: 120px;
      border: 1px solid ${MID_3}; border-radius: 8px; padding: 7px 9px; background: ${MID_DEEP};
      font-family: ${SANS}; font-size: 12px; line-height: 1.4; color: ${PAPER}; caret-color: ${ACCENT};
    }
    .queue .q-amend-input::placeholder { color: rgba(242,239,234,.32); }
    .queue .q-amend-input:focus-visible { outline: none; border-color: ${ACCENT}; }
    /* subtle send button, right of the input — brightens to terracotta on hover */
    .queue .q-amend-send {
      flex: none; width: 34px; height: 34px; border: 1px solid ${MID_3}; border-radius: 8px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0;
      background: ${MID_DEEP}; color: rgba(242,239,234,.5); transition: background .12s, color .12s, border-color .12s;
    }
    .queue .q-amend-send svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .queue .q-amend-send:hover { color: ${ACCENT}; border-color: ${ACCENT}; background: rgba(180,90,56,.14); }
    .queue .q-amend-send:focus-visible { outline: 2px solid rgba(242,239,234,.55); outline-offset: 1px; }
    /* line-height PINNED (here and on .meta, .layers button, .w-line2): without
       it the line box comes from the font's own metrics, so the divider grew a
       pixel on every typeface swap. Fixed px keeps the geometry font-independent. */
    .queue .q-div {
      padding: 7px 14px 5px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      font-size: 10px; line-height: 13px; letter-spacing: .06em; text-transform: uppercase;
      color: rgba(242,239,234,.4); font-variation-settings: "wght" 540;
    }
    .queue .q-row.done { color: rgba(242,239,234,.55); }

    .pill button:focus-visible, .composer button:focus-visible, .composer textarea:focus-visible,
    .composer .layers button:focus-visible {
      outline: 2px solid rgba(242,239,234,.55); outline-offset: 2px;
    }

    /* open-prompt pills: one readable NUMBER pill per marked element while its
       prompt is open — the number is the chat referent („Nudge 123 macht das"),
       clock keeps the status language (sweep = agent live). Click opens the queue.
       The number is the bounded LABEL (max 3 digits, see store.mjs), never the
       raw id — the pill must stay this narrow after ten thousand nudges. */
    .dots { position: fixed; left: 0; top: 0; width: 0; height: 0; }
    .dot {
      position: fixed; height: 18px; border-radius: 999px;
      background: ${MID_DEEP}; border: 1.5px solid ${PAPER};
      box-shadow: 0 1px 4px rgba(14,19,24,.4);
      display: flex; align-items: center; justify-content: center; gap: 4px;
      padding: 0 7px 0 5px;
      pointer-events: auto; cursor: pointer;
      animation: dot-in .2s ease-out;
    }
    @keyframes dot-in { from { transform: scale(.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
    .dot svg { display: block; flex: none; width: 9px; height: 9px; stroke: ${AMBER}; fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
    .dot .d-num {
      font-size: 10.5px; line-height: 1; color: ${PAPER};
      font-variation-settings: "wght" 500; letter-spacing: .02em;
      font-variant-numeric: tabular-nums;
    }
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
      background: transparent; color: rgba(242,239,234,.55); font-size: 10px; line-height: 11px; font-family: ${MONO};
      transition: color .12s, border-color .12s, background .12s;
    }
    .composer .layers button:hover { color: ${PAPER}; border-color: rgba(242,239,234,.4); }
    .composer .layers button.active { background: ${PAPER}; border-color: ${PAPER}; color: ${MID_DEEP}; }
    .composer .meta {
      padding: 9px 14px; background: ${MID_DEEP}; border-bottom: 1px solid ${MID_2};
      font-size: 10px; line-height: 12px; font-family: ${MONO}; color: rgba(242,239,234,.45);
      letter-spacing: .02em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* the marked element did not come back after a page reload — the nudge keeps
       its frozen context, the meta line says so. Status colour, nothing else. */
    .composer .meta.lost { color: ${AMBER}; }
    .composer textarea {
      width: 100%; border: 0; outline: 0; resize: none; padding: 13px 14px;
      font-size: 13px; line-height: 1.5; min-height: 78px; max-height: 210px; overflow-y: auto;
      font-family: ${SANS};
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
      font-family: ${SANS}; font-variation-settings: "wght" 540; letter-spacing: .01em;
      transition: background .12s, color .12s;
    }
    .composer .cancel { background: transparent; color: rgba(242,239,234,.5); }
    .composer .cancel:hover { color: ${PAPER}; }
    .composer .send { background: ${PAPER}; color: ${MID_DEEP}; }
    .composer .send:hover { background: #fff; }
    .composer .send:disabled { opacity: .45; cursor: default; }

    /* ---------- feedback feed: monochrome chips, colour = status only ---------- */
    /* feedback chips stack directly UNDER the toolbar (left-aligned to it, even
       gaps) and follow the pill when it moves — placeFeed() sets top/left/maxWidth */
    .feed {
      position: fixed; display: flex; flex-direction: column;
      align-items: flex-start; gap: 8px; pointer-events: none;
    }
    .feed .item {
      display: flex; align-items: center; gap: 8px;
      background: ${MID}; color: rgba(242,239,234,.85); font-size: 12px; padding: 7px 12px;
      font-family: ${SANS}; font-variation-settings: "wght" 470; letter-spacing: .01em;
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
    .feed .item .feed-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* localhost as a clean pill in the feed chip — same language as the switcher tag */
    .feed .item .feed-host {
      flex: none; font-family: ${MONO}; font-size: 10px; line-height: 14px; letter-spacing: 0;
      color: rgba(242,239,234,.5); background: rgba(242,239,234,.06);
      border: 1px solid rgba(242,239,234,.12); border-radius: 5px;
      padding: 1px 5px; white-space: nowrap;
    }
    /* Respect the OS motion setting. This sheet is scoped to the overlay's shadow
       root, so the universal selector only touches Nudge chrome: the gliding
       highlight snaps, the clock stops spinning, chips appear without a slide —
       nothing on the host page is affected. */
    @media (prefers-reduced-motion: reduce) {
      * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
    }
  `
})()
