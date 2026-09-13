# Groundworks Nudge

**Prompt your coding agent on the pixel — in Chrome or Safari.** Groundworks
Nudge is a browser extension backed by one shared local bridge. Chrome loads
unpacked; Safari is a temporary developer preview on macOS. It is the first
public piece of the Groundworks Framework. Pick an element or circle a region
in any `localhost` app, type what you want, and the prompt reaches the coding
agent that owns the codebase, together with the selector, computed styles,
console and network errors, plus a screenshot for circled regions. The agent
fixes it, verifies it, and reports back into the page.

[![Test](https://github.com/gstangl/nudge-extension/actions/workflows/test.yml/badge.svg)](https://github.com/gstangl/nudge-extension/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Works with **Claude Code** and **Codex** out of the box. Tested in the
**terminal**, in **Zed**, and in **T3 Code**. Any other local agent that can
run a shell command uses the same CLI.

> [!IMPORTANT]
> **We recommend Claude Code for Nudging.** In the current integration, only
> **Claude Code with Monitor** has a verified path for automatically waking the
> agent when you submit a browser prompt, without another chat message.
>
> **Codex (including GPT-6 Astra) and other pull runtimes require an additional
> chat message** after you submit a browser prompt so the agent reads it.
> A green connection indicator does **not** mean the agent wakes automatically.
> See [wake modes and verification limits](#agents-and-wake-modes).

Safari is available as a [temporary GitHub source installation](docs/SAFARI.md#install-from-github)
on macOS, without Xcode, signing or App Store setup. It uses the same core and
bridge as Chrome; both may be open at once. Full real-Safari feature parity is
not yet accepted. Temporary installations expire after Safari quits or 24 hours.

**New here?** [Install](INSTALL.md) for Chrome or Safari, plus the Skill. Then, in the project
you want to change, arm the agent with `/groundworks-nudge`. That Skill is the
trigger. The extension does not watch the browser on its own.

## The Skill is the trigger

The agent does not watch the browser on its own. You switch Nudge on **inside
the agent session that owns your app** — not inside this repository — by
invoking the Skill:

```
/groundworks-nudge
```

| You are in | How to invoke it |
|---|---|
| Terminal (Claude Code or Codex) | type `/groundworks-nudge` |
| Zed | in the agent panel on **your app**, type `/groundworks-nudge` |
| T3 Code | open a thread on **your app**, pick Claude Code, Codex or Grok, then type `/groundworks-nudge` or choose it from the `$` skill picker |

That command arms the session: it starts a watcher and adds the session to the
toolbar's agent roster in Chrome and Safari. If several sessions are armed,
choose the owner for your localhost port in **Switch session**. New prompts
from that page go to the selected session.
Without the Skill, prompts are stored and wait. Nothing is lost, but nothing
happens either.

The Skill is user-level (`./agent/setup-agent.sh`). After that, it is available
in every project. You do not open this repository to use Nudge.

## How it works

```
Chrome / Safari tab              bridge (Node, port 4700)          agent session
┌───────────────────────┐  HTTP/WS  ┌─────────────────────┐  watcher  ┌────────────────────┐
│ Nudge toolbar         │ ────────▶ │ store in ~/.nudge   │ ────────▶ │ /groundworks-nudge │
│ pick · lasso · send   │ ◀──────── │ roster and routing  │ ◀──────── │ groundworks-nudge  │
│ status dot · chips    │   state   │ evidence screenshots│  resolve  │ CLI                │
└───────────────────────┘           └─────────────────────┘           └────────────────────┘
```

- **Shared extension core** (`extension/`): a shadow-DOM overlay on `http://localhost:*`
  and `http://127.0.0.1:*`. Toolbar with Pick and Freeform (lasso), layer
  chips, Shift+click multi-select, number pills for open prompts, feedback
  chips, and connection status (grey off, red no bridge, amber no agent,
  green agent live). Chrome loads this folder directly; Safari stages the same
  code with browser-specific configuration, not a separate product fork.
- **Bridge** (`bridge/`): one Node process. HTTP and WebSocket on port 4700, a
  global store in `~/.nudge` (prompts, screenshots, Markdown mirrors of every
  prompt), a roster of armed agent sessions, per-localhost routing. Chrome can
  start it through its native messaging host. Safari uses
  `groundworks-nudge ensure-bridge` or the installed agent session hook; it
  does not require Chrome to be open.
- **Agent side** (`agent/`): the `groundworks-nudge` CLI (watch, status,
  context, show, resolve) and the `/groundworks-nudge` Skill. Claude Code and
  Codex get native Skill adapters plus optional hooks. Any other agent uses the
  same CLI.

## Requirements

| | |
|---|---|
| OS | macOS or Linux. Windows is not supported yet (see [INSTALL.md](INSTALL.md)). |
| Browser | Google Chrome/Chromium with Developer mode, or Safari 26+ on macOS (temporary developer preview). |
| Node.js | 22 or newer. |
| Agent | Claude Code, Codex, Zed, T3 Code, or any local agent that can run shell commands. Tested in the terminal, Zed and T3 Code. |

The only runtime dependency is `ws`. Playwright, Vitest and Python 3 are
needed for the test suites only.

## Install

Choose a browser, or install both. Set up the shared bridge and agent Skill
once; follow each browser's extension steps.

| Browser | Installation | Bridge startup |
|---|---|---|
| Chrome / Chromium | [Load unpacked](INSTALL.md#chrome-installation) from `extension/` | Chrome native messaging host |
| Safari 26+ on macOS | [Temporary source installation](docs/SAFARI.md#install-from-github); no Xcode or signing | CLI or agent session hook; no Safari native autostart |

The Chrome quickstart follows. For Safari alone, use the linked Safari guide
and skip Chrome's native host. Full troubleshooting is in [INSTALL.md](INSTALL.md).

```sh
git clone https://github.com/gstangl/nudge-extension.git
cd nudge-extension/bridge && npm ci && cd ..
```

1. **Load the extension.** Chrome → `chrome://extensions` → switch on
   *Developer mode* (top right) → *Load unpacked* → select the `extension/`
   folder of this repository.
2. **Register the native host** so that Chrome runs the bridge for you:
   ```sh
   ./bridge/install-native-host.sh
   ```
   The script derives the extension id from the folder path. If
   `chrome://extensions` shows a different id, pass that id as the argument.
3. **Set up the agent side.** Installs the CLI and the Skill for Claude Code,
   Codex and Grok Build, plus optional hooks for Claude Code and Codex:
   ```sh
   ./agent/setup-agent.sh
   ```
   Zed and T3 Code have no separate plugin. They pick up the same user-level
   Skill from the CLI they drive.
4. **Try it.** Open `http://localhost:4700/demo` in Chrome. In an agent session
   **on any project of yours**, invoke `/groundworks-nudge`, wait for the green
   dot, click **Pick**, click a card, type a prompt, press Enter.

## Daily use

| You want to | Do this |
|---|---|
| Show/hide the toolbar | `Alt+C` (`Option+C` on macOS), or click the Nudge icon in the browser toolbar. The visible toolbar is always draggable |
| Move the toolbar | Drag the six-dot handle; menus open above it near the bottom edge |
| Choose an agent | Click the status dot → **Switch session**; choose an already armed session |
| Prompt on an element | **Pick** (or `P`) → click the element → type → `↩` (`⇧↩` for a newline) |
| Pick the parent you meant | after the click, use the layer chips (`td → tr → table`) |
| Several elements, one prompt | `Shift+click` adds or removes elements |
| Prompt on a region | **Freeform** (or `F`) → circle it → type → `↩` |
| Mark only, talk in chat | click an element and send empty. A numbered pill appears. In the agent chat say "Nudge 12: make this larger" |
| Follow up on a sent prompt | open the counter popover → **+ amend** |
| Take a prompt back | open the counter popover → **×**. The agent is told to stop |

**Status dot** (page toolbar and browser extension icon):

| Colour | Meaning |
|---|---|
| grey | toolbar off |
| red | bridge unreachable. Prompts queue in the browser and are re-sent |
| amber | bridge up, no agent armed. Prompts are stored |
| green | an agent session is armed. A *Pull* tag means it reads on its next message instead of waking |

## Agents and wake modes

The Skill is the entry point for every runtime. What differs is whether a new
prompt can wake the agent by itself (`push`) or is read with the next message
(`pull`). The toolbar shows which one you have.

| Runtime | Skill location | Wake | Notes |
|---|---|---|---|
| Claude Code (terminal) | `~/.claude/skills/groundworks-nudge` | push | Tested. The watcher runs under the `Monitor` tool. A prompt wakes the session in about a second. |
| Zed | same user-level Skill as the CLI it drives | push | Tested. Invoke `/groundworks-nudge` in the agent panel on **your app**. Claude Code in Zed uses Monitor, so a prompt wakes the session. |
| Codex CLI (including GPT-6 Astra) | `~/.agents/skills/groundworks-nudge` | pull | Send a chat message, then read the queue through the Skill/CLI. Where the runtime supports the installed `UserPromptSubmit` hook, it adds context to that message; it does not start a turn. |
| Grok Build | `~/.grok/skills/groundworks-nudge` (also sees the Claude/Codex homes) | pull | Same Skill; start the watcher as a long-running child process. |
| T3 Code | through the Claude Code, Codex or Grok CLI it drives | pull | Tested. No extra install. Open a thread on **your app**, then `/groundworks-nudge` or `$`. A *Pull* tag on the green dot means send a chat message after you prompt from the page. |
| Other local agents | none needed | pull | Run `groundworks-nudge watch --label "<name>" --wake pull` as a long-running child process, then use `groundworks-nudge context`, `show` and `resolve`. |

### GPT-6 Astra: what is verified

Reviewed on 2026-09-13. The bridge stores browser prompts and notifies the
watcher; the watcher writes to stdout. A runtime must deliver that output into
the conversation to wake an idle agent. Declaring `--wake push` only advertises
a capability; it does not implement one. The current integration has no Astra
API or Codex turn-start adapter. Claude Code with Monitor remains the only
documented, previously tested autonomous wake path. This is a runtime
integration limit, not a claim that Astra cannot support push.

[OpenAI's Astra documentation](https://developers.openai.com/api/docs/guides/latest-model)
describes asynchronous tool calling and mid-turn steering. Those features need
application-side delivery and do not automatically connect Nudge to an idle
Codex conversation. A background process whose output the agent explicitly
polls is still pull.

The locally inspected Codex CLI 0.154.0 exposes `codex queue --thread <thread>
--message <text>`. Nudge does not call it. Its availability is a possible
integration lead, not a verified browser-to-Astra wake path; no message was
queued into a live session during this review.

Verification: `cd test && npm run test:ci` exercises a real isolated bridge,
watcher, scoped queue, directly invoked context hook, and resolution.
The CI command and `node test/wake-mode.mjs` passed on the review date. The
wake suite initially exposed a missing legacy pre-hello WebSocket snapshot;
restoring that compatibility contract made all five checks pass. Neither runner
launches a model session or proves native hook execution inside Codex.
`node test/e2e.mjs` (Suite A) also passed with the version bump; its agent
heartbeat is simulated, so it proves extension behavior rather than model wake.
**An idle Astra session waking from a browser prompt without another chat
message has not been verified.** Keep Astra on pull until that exact live test
passes; do not treat green connection status or watcher output as proof.

### Chrome and Safari together

Both installations use one bridge, store and armed-agent roster. Choose a
session from either browser's **Switch session** menu. The choice is shared
per website/port, including the `localhost`/`127.0.0.1` alias: changing it in one
browser also changes the recipient of new prompts on that website in the other.
Previously sent prompts keep their original owner. With several dev servers,
choose an owner for each port.

Toolbar on/off, position, author and the offline queue are browser-local.
Region screenshots stay bound to the originating browser/tab. Choosing an
agent never arms a chat or turns a pull runtime into push. Current shared-core
and two-profile Chromium checks cover these contracts; simultaneous real
Safari/Chrome acceptance is still open. See [Safari validation levels](docs/SAFARI.md#validation-levels).

## Repository layout

```
extension/   Shared plain-JavaScript MV3 core; Chrome loads it unpacked.
             content.js overlay logic · styles.js shadow-DOM CSS · sw.js
             service worker (capture, status icon, bridge lifecycle) ·
             page-hook.js console/network ring buffer · vendor/finder.js
             (@medv/finder, MIT) · fonts/ (IBM Plex subsets, OFL) ·
             platform.js browser configuration
safari/      Safari manifest overlays and platform configuration; no copied core
scripts/     package-safari.mjs stages temporary Safari resources from extension/
             package-runtime.mjs stages the relocatable CLI/bridge payload
bridge/      bridge.mjs HTTP + WebSocket · store.mjs the global store ·
             watch-nudges.mjs the agent watcher · native-host.mjs the
             launcher Chrome spawns · install-native-host.sh · demo.html
agent/       groundworks-nudge.mjs CLI · NUDGE-SKILL.md the Skill ·
             nudge-context.mjs and nudge-session-start.sh optional hooks ·
             setup-agent.sh installer
test/        Vitest units (unit/), the CI integration checks, and the
             Playwright suites described in test/protocols.md
docs/        VISION.md · PRODUCT.md · DECISIONS.md (index: docs/README.md)
```

## Documentation

- [INSTALL.md](INSTALL.md): end-user install, update and troubleshooting.
- [docs/SAFARI.md](docs/SAFARI.md): temporary Safari installation, shared bridge,
  browser-specific testing and current acceptance limits.
- [AGENTS.md](AGENTS.md): start file for coding agents working **on this
  repository** (as opposed to using Nudge in another project).
  [CLAUDE.md](CLAUDE.md) is a one-line pointer at that file.
- [CONTRIBUTING.md](CONTRIBUTING.md): dev setup, tests, versioning, PR rules.
- [SUPPORT.md](SUPPORT.md): where to get help.
- [docs/VISION.md](docs/VISION.md): mission, audience and non-goals. Read
  this before proposing scope.
- [docs/PRODUCT.md](docs/PRODUCT.md): current product definition and
  accepted trade-offs.
- [docs/DECISIONS.md](docs/DECISIONS.md): why the repository is shaped the
  way it is.
- [CHANGELOG.md](CHANGELOG.md): every version, newest first.
- [test/protocols.md](test/protocols.md): the test contract.
  [test/scenarios.md](test/scenarios.md): the edge-case catalogue.
- [agent/NUDGE-SKILL.md](agent/NUDGE-SKILL.md): what the agent does when you
  invoke `/groundworks-nudge`.

## Known limitations

- `<all_urls>` host permission: `captureVisibleTab` rejects narrow host
  patterns. The content script itself only runs on localhost, and the bridge
  restricts CORS to localhost origins.
- Source hints come from `data-*` attributes where a framework provides them
  (Astro, JSX tooling). Otherwise the agent gets selector, xpath and text and
  maps them to code itself.
- The bridge runs as a detached local process, started by Chrome's native host
  or the CLI/session hook. Closing a browser does not stop that shared process;
  no system daemon is installed. Safari has no native bridge autostart.
- `chrome://extensions` → Errors lists the page's own console warnings as
  extension errors because the page hook wraps `console.warn` and
  `console.error`. Cosmetic, developer mode only.
- Chrome/Chromium on macOS and Linux; Safari temporary developer preview on
  macOS. Safari has no native bridge autostart and full runtime parity is not
  yet accepted. No Windows or iOS installation is provided.

## Security

`localhost` is the trust boundary: any local process can post or resolve
prompts, and the bridge port must never be exposed. Details and how to report
a vulnerability are in [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Third-party notices for the vendored selector
library, the fonts and the test fixtures are listed there.
