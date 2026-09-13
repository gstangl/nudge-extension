# Security

## Threat model

Nudge is a developer tool for `localhost`. The trust boundary is the local
machine:

- The bridge listens on `127.0.0.1:4700` (configurable with `NUDGE_PORT`).
  Any local process can post prompts, read the store, or resolve prompts.
  That is accepted for a dev tool. **Never expose the port** to a network.
- HTTP and WebSocket admission validate the requested Host against `localhost`
  and `127.0.0.1`, reject proxy-style request targets, and reject foreign or
  opaque Origin headers. CORS reflects only local HTTP(S) origins. This includes
  a Host check for same-origin requests without Origin (DNS-rebinding defense);
  it is not authentication against local processes or malicious localhost apps.
- The content scripts run only on `localhost` and `127.0.0.1` pages. The
  `<all_urls>` host permission exists solely because `captureVisibleTab`
  rejects narrower patterns.
- The store (`~/.nudge`) contains prompt text, DOM excerpts, computed styles,
  console excerpts and screenshots of your local apps. Treat it like any other
  local dev artefact; it is never uploaded anywhere by Nudge.
- HTTP requests have a byte limit; inbound WebSocket messages are limited to
  64 KiB and protocol errors close only the offending connection. Annotation
  shapes, image decoding and stored fields have bounds. Adversarial and
  historical-data regressions live in `test/bridge-boundary.mjs`,
  `test/bridge-realtime.mjs` and `test/bridge-brutal.mjs`. These checks are
  hardening, not proof against every possible malformed request or disk edit.
- An agent session only receives Nudge context after the user invoked the
  Skill in that session (the opt-in fence). No session is armed implicitly.

## Supported versions

Only the latest version on `main` is supported.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository (Security tab → *Report a
vulnerability*). You will get an acknowledgement within a few days and a fix
or a mitigation before any public disclosure.
