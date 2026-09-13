# Installing and using Groundworks Nudge

**Prompt your coding agent on the running web app, in Chrome or Safari.**
Chrome installs unpacked; Safari is a temporary macOS developer preview.
Point at an element or circle a region in your browser, type what you want, and
the active agent receives the selected element, its styles and the console.
Circled regions also include a screenshot. When done, the agent reports back into the browser. Nudge works on any
`localhost` page and with any local agent that can run commands.

## Requirements

- **macOS or Linux.** Windows is not supported yet: Chrome's native messaging
  needs a registry entry there, and nobody has written that installer. A pull
  request is welcome.
- **Google Chrome** (or Chromium), or **Safari 26+ on macOS** for the temporary
  developer preview. Both can use the same bridge at the same time.
- **Node.js 22 or newer.** `node -v` must print a version.
- **A local coding agent.** Claude Code and Codex are detected natively. Tested
  in the terminal, in **Zed**, and in **T3 Code**. Zed and T3 Code work through
  the CLI they drive — there is no separate plugin. Any other agent can use the
  `groundworks-nudge` command directly.
- This repository cloned locally:
  ```sh
  git clone https://github.com/gstangl/nudge-extension.git
  ```

Choose the [Chrome installation below](#chrome-installation) or the
[Safari developer installation](docs/SAFARI.md#install-from-github).
Safari does not require Chrome, Xcode, an Apple Developer account or a signed
app for this temporary source-install path. It expires after Safari quits or
24 hours; re-add the resource folder. Full Safari parity is not yet accepted.

## Chrome installation

### 1. Install the bridge dependency

```sh
cd <path-to>/nudge-extension/bridge
npm ci
```

### 2. Load the extension into Chrome

1. Open `chrome://extensions` in Chrome.
2. Switch on **Developer mode** (toggle in the top right corner).
3. Click **Load unpacked** and select the folder
   `nudge-extension/extension/` (the folder that contains `manifest.json`).
4. A card named **Groundworks Nudge** appears. Leave it enabled.

The extension only runs on `http://localhost:*` and `http://127.0.0.1:*`. It
does nothing on other sites.

### 3. Register the native messaging host

```sh
cd <path-to>/nudge-extension
./bridge/install-native-host.sh
```

From now on Chrome starts the local bridge process itself and keeps it alive.
You never have to open a terminal for it.

The script derives the extension id from the folder path, which is how Chrome
computes the id of an unpacked extension. Compare it with the id shown on the
extension card in `chrome://extensions`. If they differ (for example because
you loaded the folder through a symlink), run the script again with that id:

```sh
./bridge/install-native-host.sh <extension-id>
```

If you move the repository later, the id changes. Load the extension again
from the new location and re-run the script.

### 4. Set up the agent side

```sh
./agent/setup-agent.sh
```

This installs, for the current user only:

- the `groundworks-nudge` command in `~/.local/bin` (a symlink into the repo),
- the Skill `/groundworks-nudge` for Claude Code (`~/.claude/skills`), Codex
  (`~/.agents/skills`) and Grok Build (`~/.grok/skills`),
- optional hooks for Claude Code and Codex: a session-start hook that makes
  sure the bridge is up, and a prompt hook that injects the current mark and
  queue into the conversation. Existing hook settings are preserved. The
  script is idempotent and can be re-run at any time.

Pass `claude-code` or `codex` as the only argument to set up just one runtime.
Zed and T3 Code need no extra step: they surface the Skill of the CLI they
are driving.

`~/.local/bin` must be on your `PATH` for the command to resolve. Most shells
add it by default; if `groundworks-nudge help` prints "command not found", add
`export PATH="$HOME/.local/bin:$PATH"` to your shell profile.

### 5. Check that it works

1. Open `http://localhost:4700/demo` in Chrome. This demo page is served by
   the bridge, so if it loads, the bridge is running. (If it does not load,
   click the Nudge icon in Chrome's toolbar once, or reload the extension in
   `chrome://extensions`, and try again.)
2. The dark **Nudge toolbar** appears at the top right of the page. The small
   dot on its left is grey or amber for now.
3. Arm an agent session **on the project you want to change**, not in this
   repository. The Skill is user-level; after step 4 it is available
   everywhere.
   - **Terminal (Claude Code or Codex):** type `/groundworks-nudge`.
   - **Zed:** in the agent panel on that project, type `/groundworks-nudge`.
   - **T3 Code:** open a thread on that project, choose Claude Code, Codex or
     Grok as the provider, then type `/groundworks-nudge` or pick
     `groundworks-nudge` from the `$` skill picker.
   The agent arms itself. The dot turns **green** and the toolbar shows the
   session's name. A *Pull* tag on the green dot (typical for T3 Code and
   Codex) means the prompt is read with your next chat message, not by itself.
4. Click **Pick**, click one of the cards, type a short prompt, press Enter.
   A chip at the top right says **nudge_1 — agent working**. Done.

## Daily use

| Action | How |
|---|---|
| Toolbar on/off | `Alt+C`, or click the Nudge icon in the browser toolbar. Off is local to that browser installation; it does not turn the other browser off |
| Move the toolbar | Drag the six-dot handle. Menus open above it when parked at the bottom; long lists scroll |
| Prompt on an element | **Pick** → click the element → type → `↩` |
| Correct the level | after the click, chips show the parent elements (`td → tr → table`). Click the one you meant |
| Several elements | `Shift+click` collects elements into one prompt ("swap these two"). Shift+click again removes one. A plain click starts over with one element |
| Prompt on a region | **Freeform** → circle it with the mouse held down → type → `↩` |
| Mark only | click an element → send empty. Then write "make *this* larger" in the agent session. Esc clears the current mark |
| Many changes, fast | send them one after another. The agent works through them strictly in order. The counter in the toolbar shows how many are open |
| Add a thought to a sent prompt | click the counter → **+ amend** on the row |
| Take a prompt back | click the counter → **×** on the row. The agent that has it is told to stop |

**Feedback chips** (top right, small, they fade on their own):

- ✈ **nudge_X — agent working**: arrived, an agent is on it now
- 🕐 **nudge_X saved — no agent**: stored, runs when an agent arms
- 🕐 **nudge_X received · arrives with the next message**: a pull agent has it and reads it on your next message
- ⚠ **Bridge offline — queued**: re-sent automatically when the bridge is back
- ✓ **nudge_X done**: the agent resolved the prompt. Region after-evidence is
  captured only when the original browser/tab is eligible; it can remain pending.
  A resolved prompt is not, by itself, verified pixels.

**The status dot** (page toolbar and browser extension icon):

| Colour | Meaning |
|---|---|
| **green** | an agent session is armed. Without a tag it wakes by itself. With a *Pull* tag it reads on its next message |
| **amber** | bridge is up, no agent is armed. Prompts are stored |
| **red** | bridge unreachable. Prompts wait in the browser queue |
| **grey** | toolbar switched off (`Alt+C`) |

Click the dot for a one-line explanation of the current state.

## Working with several projects

Each localhost port is owned by one agent session. When two dev servers run
(say `localhost:5173` and `localhost:5174`), arm one session per project and
pick the owner per port in the toolbar's **Switch session** dropdown. A prompt
on one port never wakes the other project's agent.

Chrome and Safari connect to the same local bridge and agent roster. Choose an
already armed agent from either browser. Currently that choice is shared per
website/port (including the `localhost`/`127.0.0.1` alias), not independent per
browser. Previously sent prompts keep their original owner. Browser on/off,
toolbar position, author and offline queue are separate; region evidence stays
bound to the originating browser/tab. Browser selection never arms a chat or
changes a pull runtime into an automatic push runtime.

## Updating

```sh
cd <path-to>/nudge-extension && git pull
cd bridge && npm ci
```

In Chrome, reload Groundworks Nudge in `chrome://extensions`. In Safari,
[restage and reload its resource folder](docs/SAFARI.md#updates-and-removal).
Preserve unsent work, then reload the localhost tab in each browser you use.
Re-run `./agent/setup-agent.sh` from the repository root if the Skill or hooks
changed (the changelog says so).
The bridge picks up new code the next time it starts. To restart it, first
identify its listener with `lsof -nP -iTCP:4700 -sTCP:LISTEN` and verify its
command is this checkout's `bridge/bridge.mjs` with `ps -p <pid> -o command=`.
Stop only that verified bridge process, then run `groundworks-nudge ensure-bridge`
and check the version with `groundworks-nudge status`. Never kill an unknown
listener or delete the store. `ensure-bridge` alone does not replace an already
healthy older bridge.

## If something is stuck

1. **Dot stays red.** In Chrome, wait about ten seconds for native-host recovery;
   check that step 3 was run from the extension's folder and `node` is on your
   `PATH`. In Safari, run `groundworks-nudge ensure-bridge` and check that the
   staged resources use the shared bridge, not an isolated test port. See
   [Safari setup troubleshooting](docs/SAFARI.md#use-with-your-actual-project-and-agent).
2. **Dot stays amber.** No agent is armed. In the session that owns the page,
   type `/groundworks-nudge` again. In Zed or T3 Code this has to be a thread
   on **your app**, not on this repository.
3. **Prompts do not reach the agent.** In the agent, type `/groundworks-nudge`
   again. The first line is always the connection report and the agent repairs
   itself from there. `groundworks-nudge status` in a terminal shows the same
   report as JSON. If the green dot shows a *Pull* tag, send a short message
   in the agent chat after you prompt from the page.
4. **Toolbar vanished after a code update.** A small pill says "Nudge updated
   — press ⌘R to reload the toolbar". Do that.
5. **Everything else:** open an issue with the output of
   `groundworks-nudge status` and the browser/version. Redact local paths,
   session IDs and project details before posting publicly.

## Uninstall

- Chrome: remove the extension in `chrome://extensions`.
- Safari: remove the temporary extension in Safari Settings > Extensions.
  Removing either browser extension does not remove the other's installation
  or delete the shared store.
- Native host: delete `dev.groundworks.nudge.json` (and the older
  `energy.roots.nudge.json`, if present) from
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (macOS)
  or `~/.config/google-chrome/NativeMessagingHosts/` (Linux), and the same in
  the Chromium folder next to it.
- Agent side: delete `~/.local/bin/groundworks-nudge`, the
  `groundworks-nudge` folders in `~/.claude/skills`, `~/.agents/skills` and
  `~/.grok/skills`, the `nudge-*.{mjs,sh}` and `runtime.mjs` files in
  `~/.claude/hooks` and `~/.codex/hooks`, and the two Nudge entries under
  `hooks` in `~/.claude/settings.json` and `~/.codex/hooks.json`.
- Data: the store is `~/.nudge` (or `~/.claude/nudge` on installations older
  than August 2026).
