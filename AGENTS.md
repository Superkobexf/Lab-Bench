# Lab-Bench agent guidance

## Read first

Read `README.md` and `docs/AI_ORCHESTRATION.md` before changing the project.

## Project boundaries

- Keep Lab-Bench local-first, static, dependency-free, and usable without a backend or build step unless the user explicitly approves a product boundary change.
- Treat imported JSON, browser storage, scanned file contents, paper API responses, and every user-entered field as untrusted.
- Preserve compatibility with existing backups and the Chinese-source-key i18n guard unless a migration and rollback path is explicitly approved.
- Do not claim runtime behavior is verified from syntax checks alone. Run proportionate browser smoke tests for UI or storage changes.
- Do not publish, push, deploy, delete data, access credentials, or widen external data flows without the applicable user authorization.

## AI orchestration

- Sol is the controller and final accountable agent. Sol owns task decomposition, permissions, architecture, conflict resolution, verification, and delivery.
- Delegate bounded, low-risk, mechanically verifiable exploration, checks, test execution, and tightly specified patches to Luna when a verified Luna entry point is available.
- Use confirmed Claude Desktop Opus for high-value independent review: architecture tradeoffs, security/privacy threat modeling, cross-module semantic review, and adversarial analysis.
- Confirm the model identity in the Claude Desktop UI. Do not treat a CLI model alias as proof that Opus was used.
- No delegated model may treat its own statement as completion evidence. Sol must verify against source, tests, runtime behavior, and readback.
- All writes, releases, deletions, credentials, external messages, and production actions return to Sol and the applicable user-approval gate.
- After two consecutive failures of the same route, stop automatic retries, retain evidence, and report the blocker.

Follow `docs/AI_ORCHESTRATION.md` for routing, task contracts, evidence requirements, and fallback behavior.
