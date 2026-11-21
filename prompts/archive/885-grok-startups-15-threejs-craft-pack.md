# grok-startups 15: an account-free three.js craft skills plugin for Grok Build that hands heavy work to three.ws

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3285.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, creating a GitHub repo, opening the marketplace PR) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The three.ws plugin (order 872) needs an account for generation, which is correct but adds a step. A second plugin that needs nothing at all, and makes Grok Build measurably better at three.js work, earns installs from every developer building for the web in 3D: loading and optimizing GLBs, PBR materials, lighting, shadows, post-processing, performance on mobile, WebXR, and debugging blank canvases. Where a task needs an asset, the skills point to the free three.ws catalog (no account) and, for generation, to the three.ws plugin. It is useful on day one, it is the kind of craft content developer accounts reshare, and it is a second, independent marketplace entry.

## Step 0: re-derive the current state

    ls integrations/grok/ integrations/grok/three-ws/skills
    grep -n "\"three\"" package.json
    ls node_modules/three/examples/jsm | head -30
    ls src/*.js | wc -l; grep -rln "MeshoptDecoder\|KTX2Loader\|DRACOLoader" src | head
    curl -s -o /dev/null -w "%{http_code}\n" "https://three.ws/api/v1/catalog/search?q=lamp"

Read the Grok Build skills and plugin format from docs.x.ai (`skills-plugins-marketplaces`, `.md` suffix) and the cloned `xai-org/plugin-marketplace` (clone it to your scratchpad) to learn the skill frontmatter, how skills are selected, size guidance, and how bundled scripts are allowed. Find the real catalog search endpoint by reading `vercel.json` and `docs/` (correct the probe URL above). Record the three.js version the repo uses; examples in the skills must target the current stable three.js release, which you verify on npm.

## Tasks

1. **Plugin skeleton.** `integrations/grok/threejs-craft/` with `.grok-plugin/plugin.json` (name `threejs-craft`, kebab-case, conformant with the validator), README, LICENSE (match the repo's license for integrations), and no MCP server and no network calls except the free catalog search in one skill.
2. **Skills, each with a precise trigger description and tested code.** At least these: `load-and-optimize-gltf` (GLTFLoader with Meshopt, KTX2 and Draco decoders, `gltf-transform` optimize commands, and how to measure), `pbr-materials-and-lighting` (physically based setup, environment maps, tone mapping and color management in current three.js), `shadows-that-look-right`, `postprocessing-pipeline`, `mobile-performance-budget` (draw calls, instancing, texture memory, a measuring recipe), `webxr-quickstart`, `debug-blank-canvas` (a checklist that finds the usual causes), and `find-or-make-3d-assets` (search the free three.ws catalog with no account; for generation, point to the three.ws plugin and say it needs a free account). Each skill is accurate for the verified three.js version; cite the three.js docs page for every API you show.
3. **Every code block runs.** `integrations/grok/threejs-craft/tests/` plus `scripts/grok-craft-verify.mjs` (npm script `grok:craft-verify`): extracts every fenced JS code block from every skill, builds it into a tiny page with the pinned three.js, loads a real CC0 GLB from the three.ws catalog, runs it in Playwright Chromium, and fails on a thrown error, a console error or a blank canvas (pixel check). Blocks that are intentionally partial carry a marker comment the extractor skips, and the README explains that marker.
4. **One command and one agent.** A `/three-audit` command that inspects the current project's three.js usage (renderer settings, color management, loaders, obvious performance traps) and prints a prioritized fix list; and an agent definition, `threejs-reviewer`, that runs the audit, applies the safe fixes, and re-runs it.
5. **Marketplace readiness.** Run the marketplace validator and index generator in the clone against a local entry for this plugin and record the success output. Use `scripts/export-plugin-repo.mjs` if a sibling created it (extend it if it lacks something); otherwise write it here (`--src`, `--out`, plugin at the root, LICENSE, README, CHANGELOG.md from git history, validator run, `git init`, one commit, deterministic, tested). Write the marketplace JSON entry with the proposed `<org>/threejs-craft` source and the SHA pinning procedure into a new "### Grok Build: threejs-craft" section at the end of [docs/partners/grok-bot-listings.md](../../docs/partners/grok-bot-listings.md) (hot file, small anchored edit).
6. **Docs.** Link the plugin from `docs/grok.md` and `/grok` (hot files, small anchored edits), add a STRUCTURE.md row, and a changelog entry.

## Definition of done

- [ ] `npm run grok:craft-verify` exits 0: every non-partial code block in every skill ran in Chromium against a real GLB with a non-blank canvas.
- [ ] The marketplace validator and index check pass in the clone against an entry for `threejs-craft` (output in the report).
- [ ] The export produces a tree with `.grok-plugin/` at its root and one commit.
- [ ] `grep -rniE "\\\$THREE|wallet|token price" integrations/grok/threejs-craft` returns nothing.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| WebGL in headless Chromium | Use swiftshader flags; the memory note on verifying without the full world covers the pattern. |
| A decoder needs WASM files served | Serve them from the pinned `three` package in the test page's static root. |
| The Grok Build CLI cannot run without an xAI login | Validation plus the code-block runner is the test; list the one-command live install in the owner message. |
| A skill topic needs an API that changed between three.js versions | Teach the current API, add one line naming the old one so migrators recognize it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (creating the public repo, pushing, opening the marketplace PR): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (code blocks verified).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
