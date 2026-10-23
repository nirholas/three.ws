# Suggested skills: agents that learn from runs that worked

An agent that finishes a run well can propose a skill for itself. The platform records the run, drafts a real skill bundle from it, validates the bundle with the marketplace publisher's checks, and puts it in a **Suggested skills** list on the agent dashboard. The owner reads it and clicks install, publish or dismiss. Nothing installs or publishes without that click.

Code: [api/_lib/skill-candidates.js](../api/_lib/skill-candidates.js) (database layer), [api/_lib/skill-candidate-bundle.js](../api/_lib/skill-candidate-bundle.js) (pure evidence, redaction and bundle templating), [api/agents/[id]/skill-candidates.js](../api/agents/%5Bid%5D/skill-candidates.js) (HTTP), [src/dashboard/suggested-skills.js](../src/dashboard/suggested-skills.js) (dashboard list), table `agent_skill_candidates` ([migration](../api/_lib/migrations/20261023130000_agent_skill_candidates.sql)). Tests: [tests/skill-candidates.test.js](../tests/skill-candidates.test.js).

## What counts as a success

The detector in [api/_lib/reflection.js](../api/_lib/reflection.js) and the agent run path records a candidate only after one of three verified signals:

| Signal | Source of truth |
| --- | --- |
| `multi_tool_turn` | A server agent run with at least 3 tool calls across at least 2 distinct tools, no tool error, no blocked call, and a final answer. |
| `labor_escrow_passed` | A labor-escrow job whose verdict is a pass, settled in [api/_lib/labor-settle.js](../api/_lib/labor-settle.js). The evidence is the agent's own signed action log before the settlement. |
| `profitable_trade` | A strategy position closed with positive profit in [api/_lib/agent-strategy-runtime.js](../api/_lib/agent-strategy-runtime.js). The evidence is the action log before the close. |

A run that errored, was blocked by the trade firewall, has too few steps, or was not verified writes no row. The owner's account memory setting `skill_drafts_enabled` turns the whole feature off. An agent keeps at most 25 open candidates; dismiss some to free room.

## No argument value is ever stored

The evidence run is reduced to **shapes** before anything is written or sent to a model:

- Every argument leaf becomes its type name (`string`, `integer`, `boolean`), keys that look like data become `<key>`.
- Every literal that appeared in an argument (an address, an amount, a name) is collected, and the goal sentence is scrubbed of each one (`Vet the token <value> before I buy`).
- The model sees only the scrubbed goal and the shapes. It writes prose, never code.
- `tools.json` and `handlers.js` are generated from a template, not by the model, and the stored draft is scanned for every collected literal and for address-like patterns. A draft that contains one is kept as invalid.

## The draft bundle

A candidate holds the standard `skill/0.1` bundle: `manifest.json`, `SKILL.md`, `tools.json`, `handlers.js`. The handler is a composite tool that calls exactly the tools the evidence run called, in order, and stops at the first failing step with its name and error. In the server agent loop an installed candidate is offered as a tool only when every step is one of the loop's read-only tools (price, safety, holders, balance and the like), so a learned skill can never move funds on its own.

The draft is validated with `validateBundle` from `@three-ws/skill-import`, the same checks the marketplace publisher runs (manifest, frontmatter, declared tools against `tools.json`, exported functions, a syntax check, the SKILL.md token budget). A draft that fails, or that could not be written because no model answered, is stored with `status: "invalid"` and its `validation_errors`. An invalid draft cannot be accepted or published; the owner can **Redraft** it from the stored, already redacted steps. A bundle that was edited in the database after validation is re-validated on every install and refused with `422`.

## The owner's decisions

| Action | Effect |
| --- | --- |
| Install on this agent | Adds the hosted bundle URI to this agent's `skills` and nothing else. The agent's next run can call the new tool. |
| Publish to marketplace | Creates the listing through the existing marketplace flow, owned by the owner. It does not install anything by itself. |
| Dismiss | Hides the candidate. Dismissing an installed candidate uninstalls it, and the agent's `skills` no longer contains it. |
| Redraft | Retries the draft for an `invalid` candidate. |

## Refining an installed skill

When an installed skill is called again and the run deviates and still succeeds, the platform does not edit the skill. It appends a **revision proposal** to the candidate: a unified diff of the bundle files, a bumped patch version, and a kind:

- `extension`: the run used the skill and then needed more tools to finish.
- `repair`: the skill failed and the agent finished the job another way.

The owner accepts the revision (which updates the installed bundle) or dismisses it. At most 5 revisions wait on a candidate.

## API

All routes are owner-only except the hosted bundle files.

| Route | Purpose |
| --- | --- |
| `GET /api/agents/:id/skill-candidates` | List candidates (`?status=draft\|invalid\|installed\|dismissed`). |
| `GET /api/agents/:id/skill-candidates/:cid` | One candidate with bundle, evidence and revisions. |
| `POST /api/agents/:id/skill-candidates/:cid` | `{ "action": "accept" \| "publish" \| "dismiss" \| "redraft" \| "accept_revision" \| "dismiss_revision", "revision_id"? }` |
| `GET /api/agents/:id/skill-candidates/:cid/bundle/<file>` | `manifest.json`, `SKILL.md`, `tools.json` or `handlers.js` of an installed candidate. Public, like every hosted skill bundle. |

The full request and response shapes are in the [API reference](api-reference.md#suggested-skills-api). The read-only MCP tool `list_skill_candidates` returns the same list to a connected client; it cannot accept, publish or dismiss.
