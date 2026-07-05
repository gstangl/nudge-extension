# Fixtures — third-party test surfaces (Nudge suites only)

Real-world pages/templates the suites pick against, VENDORED so test runs are
hermetic (no network). These files are test material, never product code —
they must not leak into `apps/` or `packages/`. Served locally by
`test/fixture-gauntlet.mjs` (python http.server on a side port).

| What | Files | Source | License | Fetched |
|---|---|---|---|---|
| TodoMVC (React) — the classic re-render UI: keyed lists, DOM replaced on every toggle/edit | `todomvc-react/` | todomvc.com/examples/react/dist | MIT (TodoMVC team) | 2026-07-05 |
| Tailwind Play runtime | `vendor/tailwind-play.js` | cdn.tailwindcss.com | MIT (Tailwind Labs) | 2026-07-05 |
| Flowbite dist (components JS/CSS: modal, dropdown, drawer) | `vendor/flowbite.min.{js,css}` | cdn.jsdelivr.net/npm/flowbite@2.5.2 | MIT (Themesberg) | 2026-07-05 |
| Tailwind Gauntlet — composed fixture page from the above: sticky navbar, dropdown, modal with backdrop outside-click, sticky-header table (40 near-identical rows), CSS-transformed card, shadow-DOM web component, long scroll run, toast at z-index 9999 | `tailwind-gauntlet.html` | authored here from Flowbite/Tailwind component patterns | MIT throughout | 2026-07-05 |

Refresh policy: refetch only deliberately (new upstream versions), then re-run
Suite F and update this table's date. Never hotlink CDNs from fixtures.
