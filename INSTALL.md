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

## Guided setup for agents

This is the canonical setup procedure for Nudge's Skill and external entry
points such as Groundworks. Nudge is optional and independent of Groundworks.
One browser is enough; use the User's existing Chrome or Safari preference.
An explicit request to use Nudge authorizes connecting the current session.
Installing components requires an explicit setup request or one confirmation
at first use. Reuse permission already given in the conversation. A decline or
an unanswered question installs nothing and leaves ordinary work available.

1. Locate `groundworks-nudge` with `command -v groundworks-nudge`. If it exists,
   run `groundworks-nudge status --check`, with `--browser chrome|safari` and
   `--port <app-port>` only when the intended browser and app port are known.
   Pass `--runtime codex|claude-code|grok` when automatic detection cannot
   identify the current runtime. The report has
   `kind: groundworks-nudge-readiness` and `schemaVersion: 1`. An older
   CLI may return only bridge identity; that is not a readiness report.
   Reuse an existing checkout or installation; an unavailable command may be a
   PATH problem. Inspect its launcher before proposing another clone.
2. If local components are missing, explain what will be installed and ask
   once whether to set up Nudge, unless that setup is already authorized.
   Use this public repository's browser-specific installation instructions.
   Clone into a stable user-selected tools location, outside the application
   repository; retain the resolved Git Commit as the installation basis.
   Keep existing installations and prompt stores. A `different` Skill means
   its bytes differ from the current Nudge source, not necessarily that it is
   safe to overwrite: inspect the diff, preserve local edits and refresh a
   confirmed older official copy using `./agent/setup-agent.sh`. Install the
   Skill once per active runtime; never add a second Project-owned copy or
   replace another capability with the same name. Nudge owns its updates.
3. Interpret the observed checks using the table below. The status check performs no
   repair. On an explicit Nudge-use request, the shared bridge may be recovered
   with `groundworks-nudge ensure-bridge`; that command validates the listener
   before reuse or startup. Never kill or replace an unknown listener.
4. Follow [Chrome installation](#chrome-installation) or the public
   [Safari guide](https://github.com/gstangl/nudge-extension/blob/main/docs/SAFARI.md#install-from-github)
   for the chosen browser only. Explain the remaining browser clicks and site
   access. An absent connection does not establish that the extension is absent.
   Safari's temporary-installation and acceptance limits still apply.
5. Once local prerequisites and bridge compatibility are resolved, load the
   canonical Skill at `source.skill` and arm the explicitly requested current
   session. If this guide was entered from that Skill, continue its arming
   steps using the checks already performed. Browser activation may still be
   pending; do not require an armed session before allowing the Skill to arm.
   Check again after arming, with its returned agent id and the intended app
   port. A missing or stale native Skill entry may require a fresh agent
   session; do not claim runtime discovery from a copied file alone.
6. Finish with one deliberately submitted test prompt on the intended app.
   Confirm receipt in the selected session and preserve the existing queue's
   ownership. A `ready` report proves observed connections only. It does not
   prove prompt delivery, automatic wake or a verified visual change. A pull
   session still needs another chat message. Every Nudge follows the receiving
   Project's existing work authority, intake and verification rules.

| Observed check | Next action |
|---|---|
| Node unsupported, dependency missing, or Skill missing/different | Complete only the missing setup or inspect the Skill difference |
| Bridge unreachable | Recover the shared bridge; do not infer a missing extension |
| Bridge incompatible, unverified, or store conflict | Inspect the exact conflict; preserve the listener and all stores |
| Browser not connected or unverified | Open the intended localhost app, enable the toolbar/site access, then check again |
| Current session not armed or its identity unknown | Arm this explicitly requested session through the canonical Skill |
| Another session owns the page | Select the intended session in the toolbar; do not take its queued work |
| Connections ready | Check an explicit test prompt; report push or pull separately |

`status --check` exits zero when it produced a diagnostic report, even when setup is
incomplete. Invalid arguments exit nonzero. Read its fields, not just the exit
code. `status` without `--check` retains its existing bridge-identity response.

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
| Show/hide toolbar | `Alt+C` (`Option+C` on macOS), or click the Nudge icon in the browser toolbar. This does not lock the drag handle. Off is local to that browser installation; it does not turn the other browser off |
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
