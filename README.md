# Groundworks Nudge

**Prompt your coding agent on the pixel.** Groundworks Nudge is a Chrome
extension plus a small local bridge — the first public piece of the
Groundworks Framework. You pick an element or circle a region in any `localhost`
app, type what you want, and the prompt reaches the coding agent that owns the
codebase, together with the selector, computed styles, console and network
errors, and a screenshot. The agent fixes it, verifies it, and reports back
into the page.

[![Test](https://github.com/gstangl/nudge-extension/actions/workflows/test.yml/badge.svg)](https://github.com/gstangl/nudge-extension/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Works with **Claude Code** and **Codex** out of the box. Tested in the
**terminal**, in **Zed**, and in **T3 Code**. Any other local agent that can
run a shell command uses the same CLI.

**New here?** [Install once](#install) (Chrome + Skill). Then, in the project
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

That single command arms the session: it starts a watcher, tells the toolbar
in Chrome which session owns your localhost (the status dot turns green), and
from then on every prompt you send from the page lands in that session.
Without the Skill, prompts are stored and wait. Nothing is lost, but nothing
happens either.

The Skill is user-level (`./agent/setup-agent.sh`). After that, it is available
in every project. You do not open this repository to use Nudge.

## How it works

```
Chrome (localhost tab)            bridge (Node, port 4700)          agent session
┌───────────────────────┐  HTTP/WS  ┌─────────────────────┐  watcher  ┌────────────────────┐
│ Nudge toolbar         │ ────────▶ │ store in ~/.nudge   │ ────────▶ │ /groundworks-nudge │
│ pick · lasso · send   │ ◀──────── │ roster and routing  │ ◀──────── │ groundworks-nudge  │
│ status dot · chips    │   state   │ evidence screenshots│  resolve  │ CLI                │
└───────────────────────┘           └─────────────────────┘           └────────────────────┘
```

- **Extension** (`extension/`): a shadow-DOM overlay on `http://localhost:*`
  and `http://127.0.0.1:*`. Toolbar with Pick and Freeform (lasso), layer
  chips, Shift+click multi-select, number pills for open prompts, feedback
  chips, and a status dot that never lies (grey off, red no bridge, amber no
  agent, green agent live).
- **Bridge** (`bridge/`): one Node process. HTTP and WebSocket on port 4700, a
  global store in `~/.nudge` (prompts, screenshots, Markdown mirrors of every
  prompt), a roster of armed agent sessions, per-localhost routing. Chrome
  starts and heals it through a native messaging host. You never run it by
  hand.
- **Agent side** (`agent/`): the `groundworks-nudge` CLI (watch, status,
  context, show, resolve) and the `/groundworks-nudge` Skill. Claude Code and
  Codex get native Skill adapters plus optional hooks. Any other agent uses the
  same CLI.

## Requirements

| | |
|---|---|
| OS | macOS or Linux. Windows is not supported yet (see [INSTALL.md](INSTALL.md)). |
| Browser | Google Chrome or Chromium with Developer mode. |
| Node.js | 22 or newer. |
| Agent | Claude Code, Codex, Zed, T3 Code, or any local agent that can run shell commands. Tested in the terminal, Zed and T3 Code. |

The only runtime dependency is `ws`. Playwright, Vitest and Python 3 are
needed for the test suites only.

## Install

Takes about five minutes. The full guide with troubleshooting is
[INSTALL.md](INSTALL.md).

```sh
git clone https://github.com/gstangl/nudge-extension.git
cd nudge-extension/bridge && npm install && cd ..
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
| Toggle the toolbar | `Alt+C`, or click the Nudge icon in Chrome's toolbar |
| Prompt on an element | **Pick** (or `P`) → click the element → type → `↩` (`⇧↩` for a newline) |
| Pick the parent you meant | after the click, use the layer chips (`td → tr → table`) |
| Several elements, one prompt | `Shift+click` adds or removes elements |
| Prompt on a region | **Freeform** (or `F`) → circle it → type → `↩` |
| Mark only, talk in chat | click an element and send empty. A numbered pill appears. In the agent chat say "Nudge 12: make this larger" |
| Follow up on a sent prompt | open the counter popover → **+ amend** |
| Take a prompt back | open the counter popover → **×**. The agent is told to stop |

**Status dot** (toolbar and Chrome icon):

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
| Codex CLI | `~/.agents/skills/groundworks-nudge` | pull | Prompts arrive with your next message. The `UserPromptSubmit` hook injects the current mark and the open queue. |
| Grok Build | `~/.grok/skills/groundworks-nudge` (also sees the Claude/Codex homes) | pull | Same Skill; start the watcher as a long-running child process. |
| T3 Code | through the Claude Code, Codex or Grok CLI it drives | pull | Tested. No extra install. Open a thread on **your app**, then `/groundworks-nudge` or `$`. A *Pull* tag on the green dot means send a chat message after you prompt from the page. |
| Other local agents | none needed | pull | Run `groundworks-nudge watch --label "<name>" --wake pull` as a long-running child process, then use `groundworks-nudge context`, `show` and `resolve`. |

Parallel projects: each localhost port is owned by one session. With several
dev servers running, pick the owner per port in the toolbar's *Switch session*
dropdown.

## Repository layout

```
extension/   Chrome MV3 extension, load unpacked. No build step.
             content.js overlay logic · styles.js shadow-DOM CSS · sw.js
             service worker (capture, status icon, bridge lifecycle) ·
             page-hook.js console/network ring buffer · vendor/finder.js
             (@medv/finder, MIT) · fonts/ (IBM Plex subsets, OFL)
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
- [AGENTS.md](AGENTS.md): start file for coding agents working **on this
  repository** (as opposed to using Nudge in another project).
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
- The bridge lives as long as Chrome or an armed session does. If both are
  gone nothing runs, by design. No daemon.
- `chrome://extensions` → Errors lists the page's own console warnings as
  extension errors because the page hook wraps `console.warn` and
  `console.error`. Cosmetic, developer mode only.
- Chrome or Chromium only. macOS and Linux only.

## Security

`localhost` is the trust boundary: any local process can post or resolve
prompts, and the bridge port must never be exposed. Details and how to report
a vulnerability are in [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Third-party notices for the vendored selector
library, the fonts and the test fixtures are listed there.
