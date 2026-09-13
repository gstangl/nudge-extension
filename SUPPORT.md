# Support

Nudge is a local developer tool for Chrome and Safari. Safari is a temporary
developer preview; there is no hosted service or account.

- **Install, update, troubleshooting:** [INSTALL.md](INSTALL.md)
- **Safari setup and preview limits:** [docs/SAFARI.md](docs/SAFARI.md)
- **How it is supposed to work:** [README.md](README.md)
- **Bugs and ideas:** open a GitHub issue. Include the output of
  `groundworks-nudge status` (strip local paths, session IDs and project details),
  your OS and browser name/version, the installation method,
  the agent runtime (Claude Code / Codex / Zed / T3 Code / other), and the colour
  of the toolbar status dot.
- **Security:** [SECURITY.md](SECURITY.md). Do not file vulnerabilities as
  public issues.

The usual first checks, in order: the Skill `/groundworks-nudge` was invoked
**in the session that owns the page**; the status dot is green; if the dot
shows *Pull*, send a chat message after you prompt from the page.
