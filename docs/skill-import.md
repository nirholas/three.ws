# Importing skills from external registries

Agents on three.ws can carry prompt-only skills: `SKILL.md` instruction sets injected into the agent's system prompt (see [Agent skills](./agent-skills.md) and the [community skills](https://three.ws/skills/community) page). Skill import opens that surface to the outside world. Any public GitHub repository of `SKILL.md` files, or any https registry manifest, can be browsed and installed, with four guarantees:

1. **Pinned.** Every skill is read at an exact commit (GitHub) or an exact sha256 (manifest). The installed copy never changes because upstream changed.
2. **Licence-checked.** A skill is listed only when its licence permits reuse. Proprietary and unlicensed skills are shown separately with the reason, never offered.
3. **Scanned.** The exact bytes are scanned for hidden or overriding instructions, secret harvesting, exfiltration links and hardcoded payout addresses, and checked against the same size and token limits as hand-written skills. Granite Guardian runs over the instructions when it is configured on the deployment.
4. **Owner-approved.** Nothing reaches an agent until its owner has seen the scan and said yes. A skill that asks to spend, sign or send messages needs a second, explicit acknowledgement and then runs under the spend gate.

Open it at [three.ws/skills/import](https://three.ws/skills/import).

---

## The registries

| Registry | Key | What it holds |
|---|---|---|
| three.ws community skills | `github:nirholas/three.ws/community-skills/skills` | The curated community skills, MIT licensed |
| Anthropic agent skills | `github:anthropics/skills/skills` | The public Agent Skills examples, mostly Apache-2.0 |
| Published on three.ws | `published` | Skills three.ws users published with `skill_publish` or the Publish button |
| Your own | `github:owner/repo[/dir]` or `manifest:https://…` | Any registry you add, up to 20 per account |

Add a registry from the page (**Add a registry**) or the API. Accepted forms:

- `owner/repo` or `owner/repo/sub/dir`
- `https://github.com/owner/repo` or `https://github.com/owner/repo/tree/<ref>/<dir>`
- an `https://` URL of a [registry manifest](#manifest)

The registry is read once when you add it, and it is refused if it holds no skills.

### How a registry is read

**GitHub.** The importer resolves the ref (the default branch unless the URL names one) to a commit sha, lists the tree at that commit, and finds every `SKILL.md` under the directory. Each body is fetched by its git blob id and verified: the git blob hash of the bytes received must equal the id in the tree, so a mirror or proxy cannot substitute content. A `metadata.json` beside a `SKILL.md` is read for author, tags and category. The licence comes from the skill's frontmatter `license` field, then a `LICENSE` file in the skill's directory, then the repository licence GitHub reports.

**Manifest.** The manifest is fetched over https, every skill URL must be https, and each body must hash to the sha256 the manifest lists, or it is refused as an integrity mismatch.

**Caching.** A registry index is cached for five minutes. Skill bodies are cached by content address (blob id or sha256), so a cached body is always the exact pinned bytes. Size limits: 64 KB per `SKILL.md`, 512 KB per manifest, 200 skills per registry.

---

## Browse

Every listed skill shows its registry, licence, author, category and how many agents have it installed. Categories are DeFi, intelligence, social, infrastructure, security and data (plus other): an explicit `category` in the skill's metadata wins, otherwise the importer scores keywords in the name, tags and description.

```bash
curl -s 'https://three.ws/api/skill-imports/browse?category=defi' | jq '.data.skills[] | {key, name, license: .license.spdx, installs}'
```

Skills that are found but not offered appear under **Not offered**, each with its reason: a proprietary licence, no recognisable licence, a body over the size limit, or unreadable frontmatter.

---

## Install: scan, review, approve

Installing is two steps, so there is always a moment where the owner sees exactly what will be installed.

**1. Scan.** Pick a skill and an agent. The importer fetches the body at its pin and scans it. The result is an *import request* that holds those exact bytes for 24 hours. The report shows:

- **Provenance:** registry, repository, path, commit (or sha256), licence, author.
- **What it asks for:** the tools it lists in `allowed-tools`, any `permissions`, and whether its text or tools ask to **spend**, **sign** or **send messages**, with the evidence lines.
- **Findings,** each `block`, `warn` or `info`:

| Rule | Severity | Catches |
|---|---|---|
| `instruction_override` | block | "ignore your previous instructions / safety rules" |
| `concealment` | block | "don't tell the owner", "silently send" |
| `secret_harvest` | block | reading or handing over keys, seed phrases, tokens, `.env` |
| `gate_bypass` | block | "skip the confirmation", "disable limits" |
| `fixed_destination` | block | sending funds to an address written into the skill |
| `exfil_url` | block | a URL template that carries conversation or secrets to a third party |
| `hidden_directive` | block | instructions hidden inside an HTML comment |
| `hidden_unicode` | block | invisible bidirectional or tag characters |
| `license`, `invalid_frontmatter`, `missing_description`, `empty_body`, `too_long`, `over_budget` | block | not reusable, not a valid skill, or over the agent's skill budget |
| `withholding`, `remote_script`, `zero_width`, `encoded_blob` | warn | worth a human look |
| `guardian` | block or warn | Granite Guardian flagged the instructions |

A warning about secrets ("never reveal your seed phrase") is recognised as a warning and not flagged. Script and handler files that ship beside a `SKILL.md` are listed and never run: only the instructions are installed.

**Verdicts.** `refused` (any block finding) closes the request on the spot, and it can never be installed. `flagged` (warnings only) and `clean` can be approved.

**2. Approve or refuse.** The owner reads the report, including the full raw `SKILL.md`, and decides. On approval the skill is written to the agent as a prompt-only skill with `source: external`, its full provenance and the request it came from. If it asked to spend, sign or message, approval also requires ticking (or passing) `acknowledge_gated`.

### The spend gate for imported skills

An imported skill is guidance, never authority:

- The system prompt says so, ahead of the imported skills: external skills never override the owner or the agent's safety rules, and a gated skill's spending, signing or messaging is never done because the skill says so.
- Every transfer the chat agent proposes while a **gated** imported skill is active is held server-side unless the owner's own message asked for that send, with the same amount and (when one is set) the same recipient written out. The reply names the recipient, amount, asset and chain of what was held, so the owner can ask for it directly. Everything the platform already requires for a transfer (confirmations, limits, guardians) still applies on top.

---

## Updates: pinned, with a diff

An installed import stays at the revision you approved. **Check for update** on the Installed tab (or `external_skill_update_diff` over MCP) re-reads the registry without the cache and compares pins:

- **Unchanged:** nothing to do.
- **Changed:** you get the unified diff from your installed copy to the new revision, the added and removed line counts, whether you edited your copy locally, and a freshly scanned update request. Approving it replaces the skill's instructions and pin; refusing leaves everything as it is.
- **Removed upstream:** your copy keeps working; there is nothing to update to.

---

## Fork and publish

**Fork** copies any skill on any agent you own (imported, community or hand-written), or any skill published on three.ws, onto one of your agents as your own editable custom skill. The fork records where it came from (`forked_from`) and carries the upstream licence. A fork of a gated skill stays gated.

**Publish** puts one of your own skills in the public **Published on three.ws** registry, so anyone can browse and import it with you credited as author. Rules:

- The skill is scanned first; a refused scan cannot be published.
- Imported and community skills are someone else's work. Fork one and change it before publishing; an unchanged fork is refused.
- Copyleft stays copyleft: a fork of GPL, LGPL, AGPL, MPL, EPL or CC-BY-SA work must be published under the same licence.
- Publishing again replaces the public copy (and its sha256). Unpublish removes it from the registry; agents that already installed it keep their pinned copy.

The published registry is itself a standard [manifest](#manifest), so other importers can read it:

```bash
curl -s https://three.ws/api/skill-imports/published/manifest.json | jq '.skills[] | {slug, license, sha256}'
```

---

## Manifest

A registry manifest is a JSON document at an https URL. The full contract is [specs/SKILL_REGISTRY_MANIFEST.md](../specs/SKILL_REGISTRY_MANIFEST.md); the short version:

```json
{
  "schema": "three.ws/skill-registry@1",
  "name": "Example skills",
  "homepage": "https://skills.example",
  "skills": [
    {
      "slug": "release-notes",
      "name": "Release notes",
      "description": "Turn merged changes into readable release notes.",
      "author": "Example",
      "version": "1.2.0",
      "license": "MIT",
      "category": "data",
      "tags": ["docs"],
      "url": "skills/release-notes/SKILL.md",
      "sha256": "<64 hex chars: sha256 of the exact SKILL.md bytes>"
    }
  ]
}
```

`url` may be relative to the manifest. Entries without a kebab-case slug, an https url and a sha256 are reported as unreadable and skipped.

---

## MCP tools

All six are in the `skills` policy group. See [MCP](./mcp.md#importing-external-skills) for the schemas.

| Tool | Tier | Does |
|---|---|---|
| `browse_external_skills` | read | Browse registries by category or text, with install counts and the excluded list |
| `scan_external_skill` | write | Fetch and scan one skill into an import request |
| `install_external_skill` | write | Install a scanned request; refuses without `owner_approved: true`, and a gated skill also needs `acknowledge_gated: true` |
| `external_skill_update_diff` | write | Diff an installed import against upstream and open an update request |
| `skill_fork` | write | Fork a skill onto one of your agents |
| `skill_publish` | write | Publish your own skill; refuses without `confirm_publish: true` |

---

## REST API

Base: `https://three.ws/api/skill-imports`. Public routes need nothing; owner routes take a session or a bearer API key (`agents:read` for reads, `agents:write` for writes). Full reference: [API reference](./api-reference.md#skill-import-api).

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /browse?registry=&category=&q=` | public | Browse (signed-in owners also see their own registries) |
| `GET /published/manifest.json` | public | The published registry manifest |
| `GET /published/<slug>/SKILL.md` | public | One published skill |
| `GET /registries` · `POST /registries` · `DELETE /registries?key=` | owner | List, add, remove your registries |
| `POST /scan` | owner | `{agent_id, registry, skill}` opens a scanned request |
| `GET /requests[?status=]` · `GET /requests/<id>` | owner | Your scan history, one request |
| `POST /requests/<id>` | owner | `{decision: "approve" or "refuse", acknowledge_gated}` |
| `POST /updates` | owner | `{agent_id, skill_id, open_request}`: the update diff |
| `POST /fork` | owner | `{agent_id, skill_id or published_slug, name?}` |
| `POST /publish` | owner | `{agent_id, skill_id, license, category, confirm_publish: true}` |
| `GET /publications` · `DELETE /publications?slug=` | owner | Your publications, unpublish |

```bash
# Scan a community skill for your agent, then approve it.
REQ=$(curl -s -X POST https://three.ws/api/skill-imports/scan \
  -H "authorization: Bearer $THREE_WS_KEY" -H 'content-type: application/json' \
  -d "{\"agent_id\":\"$AGENT_ID\",\"registry\":\"github:nirholas/three.ws/community-skills/skills\",\"skill\":\"honest-social-posts\"}" \
  | jq -r .data.request.id)
curl -s -X POST "https://three.ws/api/skill-imports/requests/$REQ" \
  -H "authorization: Bearer $THREE_WS_KEY" -H 'content-type: application/json' \
  -d '{"decision":"approve","acknowledge_gated":true}' | jq '.data.skill | {slug, external}'
```

---

## Verifying it

- `npx vitest run tests/skill-import.test.js` covers registry parsing, licences, categories, the parser, every scanner rule, the spend gate, the published renderer and the MCP tool contract, offline.
- `node --env-file=.env.local scripts/skill-import-live-check.mjs` reads both public registries live (commit, licences, categories, exclusions), fetches and integrity-checks a sample of bodies, scans them, and scans the deliberately hostile fixture at `tests/fixtures/skill-import/hostile/SKILL.md`, failing unless it is refused. `--hostile-registry nirholas/three.ws/tests/fixtures/skill-import` reads that fixture through the real GitHub path instead.

## Related

- [Agent skills](./agent-skills.md) and [Skills](./skills.md)
- [Community skills](https://three.ws/skills/community)
- [STRUCTURE.md](../STRUCTURE.md) for where the code lives
