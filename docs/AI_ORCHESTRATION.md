# Sol–Claude–Luna orchestration for Lab-Bench

## Roles

- **Sol — brain and accountable controller:** understand the goal, split work, judge risk and permissions, select routes, reconcile disagreement, verify evidence, and deliver the final result.
- **Claude Desktop Opus — specialist organ:** provide an independent deep review for architecture, security, privacy, complex semantics, and adversarial analysis. Its output is advice, not completion evidence.
- **Luna — execution body:** perform bounded, low-ambiguity, reversible, mechanically verifiable work such as repository mapping, searches, static checks, test runs, log collection, formatting, and tightly specified patches.

Sol retains responsibility after delegation.

## Routing rules

Use Luna only when the directory or files, expected output, verification command, forbidden actions, and rollback path can be stated in advance. Do not route product judgment, ambiguous cross-module design, credentials, publication, deletion, production changes, or external messages to Luna.

Use confirmed Claude Desktop Opus when at least one condition applies:

- two or more credible architectures need comparison;
- a security, privacy, scientific, or irreversible decision needs an independent view;
- the question crosses several modules or has subtle semantic constraints;
- Sol's confidence is insufficient;
- the user explicitly requests Claude or Opus.

Do not invoke all three roles ceremonially. A useful sequence is:

`Luna gathers evidence → Sol frames the decision → Opus attacks the proposal → Sol decides → Luna implements → Sol verifies`.

## Identity and fallback

- Record Claude output as “Opus review” only when the Desktop UI identifies the model as Opus and no fallback is shown.
- Claude Desktop and Claude Code CLI are different interfaces. A CLI alias is not sufficient model-identity evidence.
- If Desktop is unavailable, untrusted, awaiting permission, or model identity is unclear, label the result “Claude/model unverified” and have Sol perform an independent review.
- If a verified Luna route is unavailable, use a bounded Codex subagent or Sol and record the fallback.
- When two routes disagree, Sol decides from the user goal, source code, tests, runtime behavior, and readback.
- Stop after two consecutive failures of the same route and report the evidence instead of retrying indefinitely.

## Task contract

Every delegation must state:

```text
Task:
Why this route:
Allowed reads:
Allowed writes:
Forbidden actions:
Expected output:
Verification evidence:
Budget or timeout:
Fallback:
```

Default to read-only access and the minimum relevant context. Never pass `.env`, credentials, cookies, tokens, Keychain data, private student records, production data, or unrelated project material.

Only Sol may declare completion, after confirming the deliverable, running proportionate checks, identifying anything unverified, and satisfying user-confirmation requirements.

## First validated trial — 2026-08-13

### Luna-class route (Codex subagent fallback)

The active subagent interface did not expose `gpt-5.6-luna`, so this trial used a bounded Codex subagent as the documented fallback. It validates the task contract and routing class, not Luna model identity.

Scope: read-only repository mapping and mechanical checks.

Verified results:

- `app.js` and `i18n.js` passed `node --check`.
- `start-lab.command` passed `zsh -n`.
- `index.html` parsed successfully, had no duplicate IDs, and referenced existing local assets.
- No `TODO`, `FIXME`, `HACK`, or `XXX` markers were found.
- The repository remained clean.

This is the correct Luna task class: bounded, repeatable, low-risk, and mechanically verifiable. A later run must confirm an actual Luna model entry point. It does not prove browser behavior.

### Claude Desktop Opus route

Scope: read-only review of the JSON import → state model → `innerHTML` trust boundary. The Desktop UI identified the model as **Opus 5**.

Opus independently confirmed a high-risk persistent DOM XSS path:

- import validation checks shape but not untrusted field content (`app.js`, import validation and application around lines 2274–2334);
- imported state is written to localStorage and restored across sessions (`app.js`, state load/save around lines 186–222);
- `render()` rebuilds all views with HTML templates (`app.js`, around lines 312–335);
- `studentName()` returns raw data and several template sinks omit encoding (`app.js`, around lines 251–253, 634, 871, 920, 963, 1135, 1182, and 1208);
- raw values also reach quoted attributes, and imported paper URLs require an explicit `http:`/`https:` allowlist rather than HTML escaping alone;
- the i18n guard is not the root cause; inconsistent sink encoding is.

Sol's accepted remediation order:

1. Add a regression harness that loads a valid-shape hostile backup without executing a real exfiltration payload.
2. Encode every text sink at the rendering boundary; keep raw helpers raw for confirmations and comparisons.
3. Encode every dynamic quoted attribute value and constrain identifier formats during import.
4. Add a parsed URL allowlist for external links and omit invalid links.
5. Add a restrictive CSP as defense in depth, after confirming required Paper Radar network origins and current inline-style use.
6. Run syntax checks plus browser smoke tests for import, rendering, filters, i18n, backup round-trip, and Paper Radar links.

The orchestration contract worked as intended: the Luna-class fallback established mechanical health, Opus examined the cross-cutting threat model, and Sol reconciled both into a prioritized engineering decision. Actual Luna model identity remains unverified. No business code was changed during this trial.
