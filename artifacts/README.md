# Local verification artifacts

This directory contains generated logs, screenshots, source digests, temporary
browser packages, recovery archives and draft review material. These files are
local evidence; they are ignored by Git except for this guide. CI retains its
selected verification outputs through the repository workflows.

Current test contracts live in [test/protocols.md](../test/protocols.md).
Unresolved work and manual acceptance checks live in
[test/scenarios.md](../test/scenarios.md). Product changes belong in the
[changelog](../CHANGELOG.md), and Safari acceptance has its own
[validation levels](../docs/SAFARI.md#validation-levels).

Historical PR drafts are not current implementation tasks or fresh qualification
of the current source. Superseded reviews can be archived locally with their
related logs, screenshots and original paths. Archive manifests retain content
digests and file modes; recovery copies are extracted and checked before cleanup.
Failed and incomplete attempts remain part of that historical record.

The 2026-10-30 artifact review reconciled the legacy send/retry, scrolling,
composer and Portless notes with merged implementation. Its remaining acceptance
checks are AC-1 through AC-3 in the test catalog; old snapshots stay in the local
archive rather than being added to the source repository.
