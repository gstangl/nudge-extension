# Experimental bridge candidate

Build and compare using [the shared runbook](../docs/bridge-comparison.md).
This executable requires explicit isolated `NUDGE_STORE` and `NUDGE_PORT`; it
refuses port 4700. It does not replace the installed JavaScript bridge.

The candidate uses HTTP/WS and the existing JSON/filesystem readers. Fault hooks
are a separate Cargo feature. Native launch/framing, relocatable distribution,
complete historical version compatibility and full platform qualification remain
unfinished. Historic v1 receipt signatures are safely refused before mutation;
that is not a claim of complete historical replay support. The remaining CLI,
hook and watcher require Node.
