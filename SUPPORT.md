# Support

Nudge is a local developer tool. There is no hosted service and no account.

- **Install, update, troubleshooting:** [INSTALL.md](INSTALL.md)
- **How it is supposed to work:** [README.md](README.md)
- **Bugs and ideas:** open a GitHub issue. Include the output of
  `groundworks-nudge status` (strip anything private), your Chrome version,
  the agent runtime (Claude Code / Codex / T3 Code / other), and the colour
  of the toolbar status dot.
- **Security:** [SECURITY.md](SECURITY.md). Do not file vulnerabilities as
  public issues.

The usual first checks, in order: the Skill `/groundworks-nudge` was invoked
**in the session that owns the page**; the status dot is green; if the dot
shows *Pull*, send a chat message after you prompt from the page.
