# grok-startups 02: a Grok Build plugin that is correct, complete and installable from xAI's marketplace

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3272.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, creating a GitHub repo, opening the marketplace PR) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

xAI launched the Grok Build plugin marketplace on 2026-06-11 as an open catalog fed by pull requests to `xai-org/plugin-marketplace`, with a code-owner review on every entry. It has no 3D plugin. Grok Bot loads the same `.grok-plugin` format, so one good plugin reaches both products. Our plugin exists but its README still promises "no account, no API key", which stopped being true when the free generation lane started requiring a free account. A reviewer who follows our README and hits a sign-in wall rejects the entry. The marketplace PR text is prepared in section 3 of [docs/partners/grok-bot-listings.md](../../docs/partners/grok-bot-listings.md) and its submission belongs to order 929; this order makes the plugin worth submitting.

## Step 0: re-derive the current state

    ls -la integrations/grok/three-ws integrations/grok/three-ws/.grok-plugin integrations/grok/three-ws/skills integrations/grok/three-ws/commands
    cat integrations/grok/three-ws/.grok-plugin/*.json integrations/grok/three-ws/.mcp.json
    grep -rniE "no account|no api key|no payment|without an account" integrations/grok/three-ws
    sed -n '/### 3. xai-org/,/### 4/p' docs/partners/grok-bot-listings.md
    git log --oneline -8 -- integrations/grok

Then, in your scratchpad: clone `https://github.com/xai-org/plugin-marketplace` and read `README.md`, `CONTRIBUTING.md` and its validator and index scripts; clone `https://github.com/xai-org/grok-build` and read how the CLI is built and installed. Fetch `https://docs.x.ai/build/features/skills-plugins-marketplaces` (try the `.md` suffix) for the plugin layout (skills, commands, agents, hooks, MCP servers, LSPs) and the project instructions file Grok Build reads (verify whether it is `GROK.md` or another name before writing one). Confirm live behavior: call a generation tool on `https://three.ws/api/mcp-studio` without auth and record the `sign_in_required` answer.

## Tasks

1. **Copy that matches reality, guarded.** Rewrite every line in the plugin (README, skills, commands) that implies generation needs no account. State plainly: catalog search is free with no account; making or rigging a model needs a free three.ws account, by OAuth on first connect or an API key. Add `tests/grok-build-plugin-copy.test.js` that fails if the plugin directory claims generation without an account, so this cannot regress.
2. **Spec conformance.** Bring `.grok-plugin/plugin.json` and the component layout to the current spec from the docs and the marketplace validator. Run the marketplace's own validator and index generator in the clone against a local entry that points at your working tree, exactly as section 3 of the listings doc did, and record `Catalog OK` (or the current success string) and the index check output.
3. **Components worth installing.**
   - Commands: keep `/three-ws-tour`; add `/make-3d <prompt>`, `/rig <glb url>` and `/embed <glb url>` that call the right tools and print paste-ready results.
   - An agent definition (for example `3d-art-director`) that generates, renders the result with the render tool, inspects the image, and refines once, with a hard stop after two iterations.
   - The project instructions file for 3D web projects (task 2 told you its exact name): how to load GLBs, where three.ws fits, how to keep keys out of client code.
   - Hooks only if a hook does real work (for example validating that a generated GLB URL resolves before the agent embeds it). Do not add a hook for show.
   - No wallet, spend, trade or launch tool reachable from any component. Add the same tool-surface assertion described in task 3 of order 871 (a real `tools/list` against every URL in `.mcp.json`, failing on spend-capable names), as `tests/grok-build-plugin-tools.test.js`.
4. **Install it for real.** Build the Grok Build CLI from the cloned public repo, install the plugin from your local path with the documented command (verify it: reported forms are `grok plugin install <name> --trust` and `/marketplace` inside the CLI), and capture the CLI listing the plugin, its commands, its agent and its MCP server. A model turn needs an xAI key: if `GROK_API_KEY` exists, run one real turn that calls `/make-3d` and record the GLB URL; otherwise record the install evidence and put the one-turn command in the owner message (context file, no-key rule).
5. **Standalone repo export.** xAI reviewers question personal-account sources and every remote entry pins a 40-character commit SHA, so the plugin needs its own public repo. Use `scripts/export-plugin-repo.mjs` if a sibling order created it (extend it if it lacks something); otherwise write it here with the CLI `--src <plugin dir> --out <dir>`: plugin at the tree root, LICENSE, README, CHANGELOG.md from git history, validator run, `git init`, one commit, deterministic, tested.
6. **Marketplace entry, ready to paste.** Regenerate the marketplace JSON entry (name, description, category, source with the exported repo URL placeholder replaced by the proposed `<org>/three-ws-grok` path the owner will create, and the procedure for pinning the SHA after the push). Put it, with the validator output, into section 3 of the listings doc in a small anchored edit (hot file, last).
7. **Docs.** Update `integrations/grok/three-ws/README.md` (install, sign-in, every command and the agent, a troubleshooting table) and the Grok Build section of `docs/grok.md` (hot file, small anchored edit).

## Definition of done

- [ ] `grep -rniE "no account|no api key" integrations/grok/three-ws` returns nothing that misdescribes generation, and `tests/grok-build-plugin-copy.test.js` passes.
- [ ] The marketplace validator and index check pass in the clone against an entry for this plugin (output in the report).
- [ ] The Grok Build CLI built from source lists the installed plugin with its commands, agent and MCP server (captured output).
- [ ] `tests/grok-build-plugin-tools.test.js` passes against production and lists no spend-capable tool.
- [ ] The export produces a tree with `.grok-plugin/` at its root and one commit.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The Grok Build CLI needs a toolchain we lack (Rust, Go, a specific Node) | Install it into your user directory (rustup, a Go tarball, or the repo's documented installer); it is a build dependency, not a paid service. If a prebuilt release binary is published by `xai-org`, use that and record its checksum. |
| The CLI wants an xAI login to start at all | Install and inspect the plugin with the CLI's non-interactive subcommands; if none run without login, validate with the marketplace validator plus a real MCP session and put the one-command live check in the owner message. |
| The docs page for plugins is not fetchable | Use the cloned marketplace's README, CONTRIBUTING.md and existing first-party plugins as the spec; cite the commit SHA. |
| No three.ws API key | Self-unblock playbook, QA-login row. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (creating the public repo, pushing the export, pinning the SHA, then order 929 row 3): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (install time and one-turn generation time when a key exists).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
