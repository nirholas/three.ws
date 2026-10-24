# three.ws community skills

Skills anyone can write, and any three.ws agent can pick up in one click.

A **skill** here is a set of instructions in one markdown file. Import it onto an agent and the agent follows it in every conversation from the next message on: a risk desk that sizes every trade, a diligence checklist before any buy, a house style for social posts. No code runs on the platform, so a skill is safe to share and easy to review.

Browse and import: **[three.ws/skills/community](https://three.ws/skills/community)**

## What's in a skill

```
skills/<slug>/
├── SKILL.md        required: frontmatter + the instructions
├── metadata.json   required: name, description, author, tags, version
├── references/     optional: longer documents the skill points to (.md, .txt, .json)
└── scripts/        optional: helpers a tool-using client can run (.mjs, .js, .py, .sh)
```

`SKILL.md` opens with frontmatter. `name` must equal the folder name; `description` says when the skill applies, because clients that load skills on demand decide from it alone:

```markdown
---
name: risk-manager
description: Enforce pre-trade risk rules before any buy or sell... Use whenever the user asks to buy, sell, swap...
---

# Risk manager

Every reply to a trade request starts with this block...
```

`metadata.json`:

```json
{
	"name": "Risk Manager",
	"description": "Pre-trade risk desk: sizes every position from its stop...",
	"author": "three.ws",
	"tags": ["risk", "trading"],
	"version": "1.0.0",
	"license": "MIT"
}
```

The same folder is also a valid [Agent Skill](https://agentskills.io/specification), so it works in Claude Code and other clients that load `SKILL.md` folders, where the `scripts/` are runnable.

## Using a skill

**On a three.ws agent (web):** open [three.ws/skills/community](https://three.ws/skills/community), pick a skill, press **Import to agent**, choose the agent. It becomes an editable custom skill on that agent; you can rewrite it, switch it off, or pull a newer registry version later.

**From the command line:**

```bash
npx three-ws skills search risk
npx three-ws skills import risk-manager --agent <agent-id>
npx three-ws skills installed --agent <agent-id>
```

**From a model over MCP** (the main three.ws server, `https://three.ws/api/mcp`): `list_available_skills`, then `import_community_skill { slug, agent_id }`.

**Over HTTP:**

```bash
curl -s https://three.ws/api/skills/community?tag=risk
curl -s https://three.ws/api/skills/community/risk-manager
curl -s -X POST https://three.ws/api/agents/<agent-id>/custom-skills \
  -H "authorization: Bearer $THREE_WS_API_KEY" -H 'content-type: application/json' \
  -d '{"source":"community","slug":"risk-manager"}'
```

## How skills reach the agent

Enabled skills are added to the agent's system prompt in the order they were installed, inside a budget of 6,000 tokens per agent. A skill that would overflow the budget is skipped whole, never cut off mid-instruction, and the agent's skills page shows which ones are active. That is why a single community skill is capped at 12,000 characters (about 3,000 tokens): at least two always fit side by side.

## External sources (operator-configured)

The registry in this directory is reviewed: every skill is committed here and passes `tools/validate.mjs`. An operator can additionally list skills from public third-party GitHub repositories. These are **external** skills and are kept apart from the reviewed registry everywhere they appear.

Trust model:

- A skill is a set of instructions an agent follows, so an external skill is untrusted input.
- Every source is **pinned to a full commit sha**. A branch or tag name is rejected, so the bytes behind a listing cannot change under a reader.
- External skills carry `origin: "external"`, `not_reviewed: true`, their source repository, the pinned commit, their license and a link to that exact commit. `/skills/community` shows them in their own section with a "not reviewed by three.ws" notice.
- Nothing enables an external skill on an agent automatically. Installing is an explicit owner action that goes through the scanner and an approval step (`POST /api/skill-imports/scan`, then approve), the same flow as `/skills/import`. A skill that asks to spend, sign or send messages also needs the owner to acknowledge the spend gate.
- `three-ws skills import <slug> --agent <id>` prints the source and commit for an external skill and asks for confirmation. With no terminal it refuses unless you pass `--yes`; a gated skill also needs `--acknowledge-gated`.
- A source that fails to load (404, rate limit, timeout) is logged and skipped. The reviewed registry never depends on it.

Each external `SKILL.md` must pass the same frontmatter rules as ours (`name` equal to its directory, a `description` of 20 to 400 characters, a body of 200 to 12,000 characters, a URL-safe slug). A file that does not is dropped with a logged reason, and the rules are never loosened to admit it. Author comes from the repository owner and license from the operator's declaration; `tags` and `version` are read from the frontmatter when present. A slug that clashes with a reviewed skill, or with an earlier source, is dropped.

Operator setup: set one environment variable on the API service, a JSON array.

```bash
COMMUNITY_SKILL_SOURCES='[{"repo":"owner/name","ref":"<40-hex commit sha>","path":"skills","license":"Apache-2.0"}]'
```

| Field | Meaning |
| --- | --- |
| `repo` | `owner/name` of a public GitHub repository |
| `ref` | full commit sha to pin to (required) |
| `path` | directory holding one folder per skill, each with a `SKILL.md` (default `skills`) |
| `license` | SPDX id of the repository license (MIT, Apache-2.0 or BSD for anything worth listing) |

The tree is listed through the public GitHub API and bodies are read from `raw.githubusercontent.com` at the pinned commit; set `GITHUB_TOKEN` to lift the unauthenticated rate limit. The merged result is cached in memory for five minutes (one minute after a failure). With the variable unset, `/api/skills/community` and `/skills/community` behave exactly as before. To apply a change: `gcloud run services update three-ws-api --region us-central1 --update-env-vars COMMUNITY_SKILL_SOURCES=...` (never `--set-env-vars`, which replaces the whole environment).

The list response gains an `external` object (`count`, `total`, `sources` with per-source load status and dropped skills with reasons, and `skills`), and `GET /api/skills/community/<slug>` also resolves external slugs. Code: `api/_lib/community-skill-sources.js`; tests: `tests/community-skill-sources.test.js`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: add a folder under `skills/`, run `node tools/validate.mjs`, open a pull request.

## Files in this repository

| Path | What it is |
| --- | --- |
| `skills/` | one folder per skill |
| `registry.json` | the generated index the site, CLI and MCP read; never edit by hand |
| `tools/registry.mjs` | the validation rules and registry builder (no dependencies) |
| `tools/validate.mjs` | run it before every pull request |

Canonical source: [nirholas/three.ws/community-skills](https://github.com/nirholas/three.ws/tree/main/community-skills). Mirror for contributors: [nirholas/three-ws-skills](https://github.com/nirholas/three-ws-skills). MIT licensed.
