# awesome-solana-ai submission

Target: `solana-foundation/awesome-solana-ai` (README.md, ~428 stars, community list maintained under the Solana Foundation GitHub organization).

Checked against production and the list on 2026-10-23.

## State

- PR #251, "Add three.ws to AI Agents", is open (not merged, 1 comment, no review feedback, mergeable). It adds one line under **AI Agents** pointing at the repository.
- three.ws is not yet in the README, and it has no entry under **AI Coding Skills > General**, where `https://three.ws/skill.md` belongs. That entry is the new submission this doc prepares. It should go in as a second, separate PR so the agents entry and the skill entry can be reviewed independently.

## Rules from CONTRIBUTING.md

- Related to AI and Solana development; format `[name](link) - Brief description.`; one concise sentence; correct spelling.
- Actively maintained, documented, working code usable today.
- Not a token promotion, not a paid promotion, not vaporware. The line below therefore describes developer capability and does not mention a coin.
- PR process: fork, branch, change README.md only, clear description.

## The line (primary): AI Coding Skills > General

The section is alphabetical by name; `three-ws-skill` sorts after the current last entry, so it is appended at the end of **General**.

```diff
--- a/README.md
+++ b/README.md
@@ General @@
+- [three-ws-skill](https://three.ws/skill.md) - AI agent skill for three.ws: generate textured and rigged 3D models and avatars, create agents with their own Solana wallet, and pay for or sell services over x402.
```

The draft in the work order also said "launch coins". It is dropped on purpose: the list rejects projects "primarily designed to promote or shill a token", and the skill is a developer capability set, so the line stays about tooling.

## The line (secondary): Developer Tools (hosted MCP)

Developer Tools is not alphabetical, so the entry is appended after the last MCP-server item.

```diff
+- [three.ws MCP](https://three.ws/connect) - Hosted MCP servers for AI clients: free text-to-3D and avatar rigging with no account, plus agent wallets, memory and x402 payments on Solana, with one-click setup for Claude, ChatGPT, Cursor and VS Code.
```

Primary is the skill line (it is our `skill.md` entry point). The MCP line is optional and can be sent in the same PR.

## Claims re-checked against production on 2026-10-23

| Claim | Check | Result |
|---|---|---|
| `https://three.ws/skill.md` is live | `curl -I` | 200, `text/markdown` |
| `https://three.ws/connect` is live | `curl -I` | 200 |
| Free 3D generation with no account | `POST /api/mcp-studio` `tools/list` with no auth | returns `forge_free` and the rest of the toolset |
| Hosted MCP directory | `GET /.well-known/mcp.json` | 200 |
| Agents with a Solana wallet, x402 | `skill.md` documents both (7 matches for wallet, launch or x402) and the platform ships them | true |
| Rigged avatars | `forge_avatar` and `rig_mesh` in the same `tools/list` | true |

## Branch, commit, PR

Run from an account with GitHub auth. `gh` is not installed on the build machine, so these are plain git plus the web or `gh` flow.

```bash
gh repo fork solana-foundation/awesome-solana-ai --clone && cd awesome-solana-ai
git switch -c add-three-ws-skill
# append the line under "### General" (after the last list item, before "### DeFi")
git commit -am "Add three-ws-skill to AI Coding Skills > General"
git push -u origin add-three-ws-skill
gh pr create --title "Add three-ws-skill to AI Coding Skills > General" --body-file pr-body.md
```

### PR title

Add three-ws-skill to AI Coding Skills > General

### PR body

three.ws is an open-source platform that gives AI agents a body: generated 3D models and rigged avatars, a public page, a Solana wallet per agent, and per-call x402 payments settled on Solana. Its agent entry point is a single skill file.

Why it fits: `https://three.ws/skill.md` is a working agent skill (MIT, maintained, public repo) that tells an agent how to connect over MCP, generate and rig 3D assets for free, create an agent with its own Solana wallet, and pay for or sell services over x402. It contains no token promotion.

Links: skill https://three.ws/skill.md, MCP setup https://three.ws/connect, source https://github.com/nirholas/three.ws. This is a separate PR from #251, which adds the repository under AI Agents.

## Other directories where three.ws is missing

Source of truth: [listings-registry.md](./listings-registry.md) (`npm run listings:verify` re-checks it).

| Directory | State | Exact step |
|---|---|---|
| mcp.so | Not listed (search returned 0 on 2026-10-11) | Sign in at https://mcp.so, "Submit", paste `https://github.com/nirholas/three.ws` and the endpoint `https://three.ws/api/mcp`. |
| Smithery | Not listed | `npx @smithery/cli publish` from a server directory with a `smithery.yaml`, or submit the remote URL `https://three.ws/api/mcp-studio` at https://smithery.ai/new. |
| LobeHub chat plugin index | Not listed (`/.well-known/lobehub-plugin.json` exists) | Open a PR adding the manifest URL to the LobeHub plugin index repository per its README. |
| Solana Foundation pay-skills | PR #302 open | Chase the maintainer; nothing to resubmit. |

All of these are posting to an external channel and are owner-gated.

## Owner message (one yes)

Submit two things: (1) new PR to `solana-foundation/awesome-solana-ai` with the `three-ws-skill` line above (and optionally the MCP line), title and body as written; (2) mcp.so and Smithery submissions as listed. PR #251 stays as is. Reply yes and the commands above run from an authenticated GitHub account.
