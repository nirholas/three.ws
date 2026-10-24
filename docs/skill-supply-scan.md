# Skill supply-chain scanner

Every marketplace skill is scanned before it can be listed, and again on every new version. A skill that tries to read secrets, call hosts it never declared, evaluate hidden code or talk the agent out of asking its owner is blocked or held for a moderator. The authors see why, with the file, the line and how to fix it.

Code: [api/_lib/skill-supply-scan.js](../api/_lib/skill-supply-scan.js) (scanner), [api/_lib/skill-scan-store.js](../api/_lib/skill-scan-store.js) (policy, moderation, catalog rescan). Corpus and tests: [tests/skill-supply-scan.corpus.js](../tests/skill-supply-scan.corpus.js), [tests/skill-supply-scan.test.js](../tests/skill-supply-scan.test.js).

## What it reads

`handlers.js` is parsed into an AST with [acorn](https://github.com/acornjs/acorn) and walked; `tools.json`, `SKILL.md` and `manifest.json` are read as data and prose. Strings built at runtime are folded back to their value first (concatenation, template literals, `String.fromCharCode`, `atob`, `Buffer.from(..., 'base64' | 'hex')`, `join`, reversed splits), so `globalThis['pro' + 'cess']` is seen as `process`.

| Rule | Severity | Catches |
| --- | --- | --- |
| `env_access`, `secret_material`, `credential_store` | block | `process.env`, key material on a wallet or keypair object, `localStorage`, cookies |
| `secret_to_network`, `secret_with_network` | block (review when every host is declared and verified) | a secret read that flows into, or sits beside, a network call |
| `undeclared_host`, `dynamic_network_target` | review | a call to a host `manifest.json` does not declare, or to a URL the scanner cannot resolve |
| `exfil_sink` | block | webhook catchers, raw IP hosts, the cloud metadata endpoint |
| `dynamic_code`, `dynamic_import`, `forbidden_import`, `unverified_import` | block | `eval`, `new Function`, `.constructor(...)`, string timers, computed `import()`, Node built-ins, remote imports |
| `obfuscated_string`, `obfuscated_identifiers`, `hidden_payload`, `encoded_blob`, `minified` | block | code built to hide what it does |
| `excess_permission`, `purpose_mismatch` | review | spend, sign or message tools called without being declared in `requires` |
| `secret_param`, `tool_text_injection` | block | a tool that asks the model for a private key or seed phrase, or carries injected instructions |
| `prose`, `skip_confirmation`, `hidden_text` | block or review | `SKILL.md` that asks for secrets, tells the agent to act without asking the owner, hides instructions in comments or invisible characters |

Safe phrasing is not flagged: "Never send funds without asking the owner to confirm" and "Read-only queries may execute without confirmation" both pass.

## Verdicts

| Verdict | Effect |
| --- | --- |
| `clean` | Lists normally. |
| `review` | Saved privately with `review_status: pending`. A moderator approves or rejects with a note. |
| `blocked` | Refused with `422 skill_blocked` and the findings. Cannot be listed or approved. The only way out is an edit that scans clean. |

A moderator approval holds across rescans of unchanged content. Any edit to the content, tools, manifest or handlers is a new version and is scanned again.

## Declaring network hosts

Add the hosts a skill calls to `manifest.json`. Wildcards match subdomains.

```json
{ "requires": { "network": ["api.weather.example.com", "*.cdn.example.com"] } }
```

A call to a declared host passes. A call to anything else is held for review; a call to a webhook catcher, raw IP or metadata endpoint is blocked whatever is declared.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/skills` | Publish. Accepts optional `manifest` and `handlers_src`. Returns `scan` in the `201`, or `422 skill_blocked` with `scan`. |
| `PATCH /api/skills/:id` | Edit. Same body fields. Setting `is_public: true` on a held skill returns `409 held_for_review`. |
| `POST /api/skills/scan` | Dry run for the publish form. Body `{ name, description, content?, schema_json?, manifest?, handlers_src? }`. Writes nothing. Signed-in, rate limited. |
| `GET /api/skills/moderation` | Admin only. The pending queue with findings. |
| `POST /api/skills/moderation` | Admin only. `{ id, decision: "approve" \| "reject", note? }`. |

The scan payload is `{ verdict, counts, scanner_version, held, findings: [{ rule, severity, file, line, column, message, fix, snippet? }] }`.

Suggested skills published from an agent ([skill-candidates.md](skill-candidates.md)) go through the same scan.

## In the publish form

Marketplace, Publish a skill. Open "Skill code and instructions", paste `SKILL.md`, `manifest.json` and `handlers.js`, and press Check skill to see the findings before publishing. A blocked publish shows the same list. A held publish is saved privately with a note that a moderator will list it.

## Rescanning the catalog

```
node --env-file=.env.local scripts/rescan-marketplace-skills.mjs            # dry run
node --env-file=.env.local scripts/rescan-marketplace-skills.mjs --apply    # write verdicts, hide held or blocked
node --env-file=.env.local scripts/rescan-marketplace-skills.mjs --only-stale
```

The dry run prints how many skills would be hidden before anything changes. `--only-stale` rescans only rows scanned by an older scanner version. On 2026-10-24 the existing catalog of 152 skills was scanned: 152 clean, 0 review, 0 blocked.
