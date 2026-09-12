# Security

## Threat model

Nudge is a developer tool for `localhost`. The trust boundary is the local
machine:

- The bridge listens on `127.0.0.1:4700` (configurable with `NUDGE_PORT`).
  Any local process can post prompts, read the store, or resolve prompts.
  That is accepted for a dev tool. **Never expose the port** to a network.
- CORS is restricted to `http://localhost:*` and `http://127.0.0.1:*`
  origins, so a foreign website open in the same browser cannot read
  `/selection`, `/comments` or `/shots/*`.
- The content scripts run only on `localhost` and `127.0.0.1` pages. The
  `<all_urls>` host permission exists solely because `captureVisibleTab`
  rejects narrower patterns.
- The store (`~/.nudge`) contains prompt text, DOM excerpts, computed styles,
  console excerpts and screenshots of your local apps. Treat it like any other
  local dev artefact; it is never uploaded anywhere by Nudge.
- Every client field is capped and sanitised by the bridge before it is
  stored; a hostile or buggy local client cannot bloat or corrupt the store
  (see `test/bridge-brutal.mjs`).
- An agent session only receives Nudge context after the user invoked the
  Skill in that session (the opt-in fence). No session is armed implicitly.

## Supported versions

Only the latest version on `main` is supported.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository (Security tab → *Report a
vulnerability*). You will get an acknowledgement within a few days and a fix
or a mitigation before any public disclosure.
