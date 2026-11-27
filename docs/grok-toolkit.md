# The Grok toolkit: 14 open repos and where three.ws plugs into each

A post on X on 2026-11-27 listed 14 free GitHub repositories that take a Grok user from a prompt to a shipped product: xAI's own prompts, CLI, SDKs and cookbook, then the tools people use to run many agents at once. This page maps each one to the three.ws surface that works with it, the command that runs it, and how it was checked.

Every repository was confirmed to exist on 2026-11-27 with the GitHub API. Every "checked" line below is something that was run that day, not a reading of a README. Where a step could not be run, the line says so and says why.

Everything here uses the free studio server unless stated otherwise:

```
https://three.ws/api/mcp-studio
```

Catalog search and docs need no account. Making, rigging or rendering views of a model is free but needs a three.ws account: sign in through the client, or send an API key from [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) as `Authorization: Bearer <key>`.

## At a glance

| # | Repository | What it is | three.ws surface | Status |
|---|---|---|---|---|
| 01 | [xai-org/grok-prompts](https://github.com/xai-org/grok-prompts) | The system prompts behind Grok on X and grok.com | Shared pages now carry their explanation in plain HTML for the @grok bot ([share-to-x.md](share-to-x.md)) | Shipped |
| 02 | [xai-org/grok-build](https://github.com/xai-org/grok-build) | xAI's coding CLI | The `three-ws` plugin ([integrations/grok/three-ws](../integrations/grok/three-ws/)) | Shipped |
| 03 | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) | The plugin catalog Grok Build installs from | A prepared catalog entry that passes xAI's validators | Ready, submission is an owner step |
| 04 | [xai-org/xai-sdk-python](https://github.com/xai-org/xai-sdk-python) | Official Python SDK | [examples/grok-python-mcp](../examples/grok-python-mcp/) | Shipped |
| 05 | [xai-org/xai-sdk-ts](https://github.com/xai-org/xai-sdk-ts) | Official TypeScript SDK | [examples/grok-sentence-to-3d](../examples/grok-sentence-to-3d/) | Shipped |
| 06 | [xai-org/xai-cookbook](https://github.com/xai-org/xai-cookbook) | xAI's recipe collection | The same example, written in the cookbook's layout | Ready, the pull request is an owner step |
| 07 | [xai-org/grok-build-plugin-cc](https://github.com/xai-org/grok-build-plugin-cc) | Grok review and delegation inside Claude Code | Marketplace registered in this repo's Claude Code settings | Installable, see the note on Linux |
| 08 | [stablyai/orca](https://github.com/stablyai/orca) | Runs a fleet of coding agents on your own subscriptions | A declarative plugin ([integrations/orca/three-ws](../integrations/orca/three-ws/)) | Shipped, catalog listing is an owner step |
| 09 | [slopus/happy](https://github.com/slopus/happy) | Drives Claude, Codex and Grok from a phone or desktop | A root [`mcp.toml`](../mcp.toml) that Happy Agent reads | Shipped |
| 10 | [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) | An open-source alternative to Grok Bot | A paste-ready server entry | Documented |
| 11 | [Anil-matcha/suparagent](https://github.com/Anil-matcha/suparagent) | A self-hosted platform for agent teams | A community listing that passes its validator | Ready, the listing is an owner step |
| 12 | [FoundationAgents/MetaGPT](https://github.com/FoundationAgents/MetaGPT) | Roles that work as a software company | [examples/metagpt-3d-studio](../examples/metagpt-3d-studio/) | Shipped |
| 13 | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | An open-source coding agent | The repo's `.agents/skills` and `AGENTS.md`, plus a catalog entry | Works today, the catalog entry is an owner step |
| 14 | [BerriAI/litellm](https://github.com/BerriAI/litellm) | A self-hosted gateway to many models, with an MCP gateway | [examples/litellm-grok-gateway](../examples/litellm-grok-gateway/) | Shipped |

Setup for 08 to 11 and 13 is in [grok-fleet-tools.md](grok-fleet-tools.md). The rest is below.

## 01. grok-prompts: what the @grok bot reads

xAI publishes the system prompts for Grok on X. The one for the @grok bot (read at commit `a7c186f`) tells the bot to keep a reply under 550 characters with no markdown, to look at the images in the thread, and to browse a linked page when it needs to check something. The repository is AGPL-3.0, so nothing from it is copied into this repo. We read it to learn how the bot behaves.

That reading found a real gap. The share panel's **Ask @grok** button posts a link with a question such as "How does a turbofan actually work, step by step? @grok". A reader that runs no JavaScript got only the part and step counts from `/anatomy/:id`, never the tour itself. Now the guided tour and every named part are in the page's HTML, in the `LearningResource` node and in one `<noscript>` outline.

- Code: [server/anatomy-head.mjs](../server/anatomy-head.mjs), pinned in [tests/share-cards.test.js](../tests/share-cards.test.js). Details: [share-to-x.md](share-to-x.md#what-grok-reads-when-it-answers).
- Checked: the test failed before the change and passes after. Rendered with the real rocket engine design from production, the outline holds 10 tour steps and 30 parts (8,655 characters of plain text) where the page had none.
- Live check, once this is deployed: `curl -s https://three.ws/anatomy/<id> | grep -c 'class="anp-outline"'` prints 1.

## 02. grok-build: the three-ws plugin

[integrations/grok/three-ws](../integrations/grok/three-ws/) is a Grok Build plugin: the studio MCP server, six skills, five commands and an art director agent that renders a model and names what is wrong with it.

```bash
grok plugin install ./integrations/grok/three-ws --trust
```

- Checked: `grok plugin validate` from Grok Build 1.0.92 answered "Plugin manifest is valid." on a fresh export of the folder.
- More: [grok.md](grok.md#grok-build).

## 03. plugin-marketplace: a catalog entry that passes xAI's checks

The marketplace is the catalog `grok plugin install <name>` reads. On 2026-11-27 it held 36 plugins and none of them was for 3D.

- Checked: on a fresh clone at `ed02ed2`, with our entry appended and pinned to today's export (`7e87201d`), xAI's own scripts answered `Catalog OK`, `Wrote .grok-plugin/plugin-index.json` and `Plugin index OK`.
- Not done: the pull request. It needs a repository under a three.ws organization first. The entry, the pull request text and the exact commands are in [partners/grok-bot-listings.md](partners/grok-bot-listings.md).

## 04. xai-sdk-python

[examples/grok-python-mcp](../examples/grok-python-mcp/) attaches the studio server to Grok with the official Python SDK and prints the GLB and a viewer link.

```bash
cd examples/grok-python-mcp
pip install -r requirements.txt
python main.py --check        # no xAI key: lists the tools and searches the catalog
XAI_API_KEY=... python main.py
```

- Checked: `--check` ran against production (21 tools offered, three chairs returned), and a full run had Grok return Wooden Chair 01 from the catalog in about 24 seconds, install included. The pin, `xai-sdk==1.21.0`, is the newest release on PyPI.

## 05. xai-sdk-ts

[examples/grok-sentence-to-3d](../examples/grok-sentence-to-3d/) does the same job with the official TypeScript SDK (`@xai-official/sdk` 0.2.11, Node 22.13 or newer). It streams each tool call as xAI runs it.

```bash
cd examples/grok-sentence-to-3d/typescript
npm ci
npm run check                 # no xAI key
XAI_API_KEY=... npm start
```

- Checked: 7 unit tests pass, `npm run check` passes against production, and one full run had Grok call `search_catalog` and return a real chair GLB with a viewer link in about 6.5 seconds. A wrong key prints xAI's own error and exits 1.
- Checked, making a model: with a three.ws key and a request the catalog cannot fill ("make a brass desk lamp with a green glass shade"), Grok called `forge_free`, collected the job with `check_job` over three rounds, and returned a generated GLB in 298 seconds.

## 06. xai-cookbook: the same example, in the cookbook's layout

The cookbook takes outside recipes as `examples/<slug>/README.md` with YAML front matter and a folder per language. `examples/grok-sentence-to-3d` is written that way, so it can be copied in unchanged.

- Checked: copied into a fresh clone of the cookbook at `002788b`, the cookbook's own builder answered `Catalog OK: 31 examples, all relative links resolve`, both when writing the catalog and in `--check` mode. It added our row to the catalog table and to `registry.yaml`.
- Not done: the pull request (title `[Content] Sentence to 3D with a remote MCP server`).

## 07. grok-build-plugin-cc: Grok inside Claude Code

xAI's bridge plugin lets a Claude Code session ask Grok Build for a review, a critique, or to take over a task. This repo's [.claude/settings.json](../.claude/settings.json) now lists its marketplace, so installing it here is one command inside Claude Code:

```
/plugin install grok-build@xai-grok-build
/grok-build:check
/grok-build:review --wait --base main
```

It needs the `grok` CLI on `PATH`, or `GROK_BINARY` pointing at it, and a logged-in CLI.

The plugin is registered but not enabled for the repo. Its `delegate` command hands Grok a task with write access and spends xAI credits, so turning it on is left to each person who works here.

- Checked: the plugin's `check` (version 0.2.1, commit `8070d2f`) reports ready with Grok Build 1.0.92 and "You are using XAI_API_KEY."
- A fault upstream: with no key, `grok models` prints "You are not authenticated." and still exits 0, and the bridge reports `"loggedIn": true`. Read the `detail` line, not the flag.
- Not run: a review. Grok Build runs reviews inside a `bubblewrap` sandbox. On Ubuntu 24.04 AppArmor stops `bwrap` from creating a user namespace (`bwrap: setting up uid map: Permission denied`), so the review exits before it calls xAI. The fix is an AppArmor profile that allows `userns` for `/usr/bin/bwrap`. That changes kernel security policy for the whole machine, so it was not changed for this check.

## 08 to 11 and 13. The fleet tools

Orca, Happy, OpenMausBot, Suparagent and OpenHands each take a remote MCP server in their own format. [grok-fleet-tools.md](grok-fleet-tools.md) has the exact file or form for each one, how each was checked against the project's own parser or validator, and the prepared listings.

- **Orca:** [integrations/orca/three-ws/orca-plugin.json](../integrations/orca/three-ws/orca-plugin.json) is a declarative plugin, manifest version 2. Orca refuses request headers in a manifest, so the plugin ships the plain URL and signs in through the client.
- **Happy:** the [`mcp.toml`](../mcp.toml) at the root of this repo is read by Happy Agent in any session opened here.
- **OpenMausBot and Suparagent:** paste the server URL into the form. The Suparagent community listing is written and passes its validator.
- **OpenHands:** it loads this repo's `.agents/skills` and `AGENTS.md` as they are.

None of the five apps was launched. The checks ran each project's parser or validator on our file.

## 12. MetaGPT: a three-role 3D studio

MetaGPT models a software company as roles that pass messages, and it has no 3D ability and no MCP support. [examples/metagpt-3d-studio](../examples/metagpt-3d-studio/) hires an Art Director, a Modeler and a Reviewer into a MetaGPT `Team`, with Grok as every role's model and the studio server as the tools. The Reviewer looks at a render and fails the model with the fault named. The loop stops after two iterations whatever the result.

```bash
cd examples/metagpt-3d-studio
uv venv --python 3.11 .venv && . .venv/bin/activate   # needs uv: https://docs.astral.sh/uv/
uv pip install --no-deps -r requirements.txt
python main.py --check        # no xAI key
XAI_API_KEY=... python main.py "a vintage wooden armchair"
```

- Checked: `--check` against production (21 tools, three chairs, one render). A full run of "a vintage wooden armchair", signed in to three.ws, had the Modeler pick the catalog's Chinese Armchair, the Reviewer look at four rendered views (`look_at_model`: three-quarter, front, side, back) and pass it in one iteration with 3 Grok calls. Signed out, the same brief passes on the public poster render, one view. The default brief (a low-poly chair, which the catalog does not hold) failed review twice signed out and stopped, as designed, with exit code 3.
- MetaGPT needs Python 3.9 to 3.11, and its last PyPI release is from April 2024, so the example pins a commit of its `main` branch and the whole dependency tree.
- Checked, generation: the default brief ("a low-poly wooden chair for a cozy cabin scene"), signed in, ran both iterations on 2026-11-27 in 848.8 seconds with 6 Grok calls. The catalog had no fit, so the Modeler generated a chair with `forge_free` each time, the Reviewer looked at four views and failed both on triangle count (23,315 and 28,162 against a low-poly spec), and the run delivered the second chair with the fault named (exit code 3). The free generator did not follow the polygon budget in any of the three generations that day, and the review caught that from the measured count.
- Two faults found by running it live were fixed with tests first: a busy generator ended the run where it should have started a new generation, and a refusal in the second iteration (the hourly generation limit) printed a stack trace and dropped the chair already made. `python3 -m unittest discover -s tests` in the example runs the 13 tests with no network.

## 14. LiteLLM: one endpoint for Grok and the 3D tools

[examples/litellm-grok-gateway](../examples/litellm-grok-gateway/) is a LiteLLM proxy config that routes the alias `grok` to xAI and registers the studio server in LiteLLM's MCP gateway. Any client that speaks the OpenAI Responses API then gets Grok with the 3D tools, and the proxy runs the tool calls itself.

```bash
cd examples/litellm-grok-gateway
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export LITELLM_MASTER_KEY=sk-pick-any-local-secret
XAI_API_KEY=... litellm --config config.yaml --host 127.0.0.1 --port 4317
python main.py --check        # second terminal, no xAI key
python main.py
```

- Checked with LiteLLM 1.111.0: `--check` through the gateway lists the tools and returns three chairs. A full run, with a three.ws key forwarded in the `x-mcp-three_ws-authorization` header, had Grok call `search_catalog` through the proxy and answer with a real catalog chair. With no xAI key on the proxy the client exits 2, and with a wrong key it prints xAI's error and exits 1.
- Not run: making a model through the gateway, which needs a three.ws key sent as the `x-mcp-three_ws-authorization` header.

## Run the checks yourself

One command installs each example in a temporary folder and runs it against production:

```bash
npm run grok:examples-smoke                # the six examples in examples/grok
npm run grok:examples-smoke -- --only grok-sentence-to-3d,litellm-grok-gateway,metagpt-3d-studio
npm run grok:examples-smoke -- --all       # all nine
```

With `XAI_API_KEY` set, every example makes a real Grok run and must end with a model. Without one, each example's three.ws leg still runs live, and the xAI leg is proved by sending a key that is not valid and reading xAI's own "Incorrect API key provided" answer. On 2026-11-27 the three examples on this page passed both ways.

## Not submitted yet

Each of these publishes something under the three.ws name on someone else's site, so each one is prepared and waiting, not sent.

1. **The Anatomy outline (01)** reaches the @grok bot with the next production deploy.
2. **Grok plugin marketplace (03).** It needs a public plugin repository, the export pushed to it, and the pull request. Text and commands: [partners/grok-bot-listings.md](partners/grok-bot-listings.md).
3. **xAI cookbook (06).** Copy `examples/grok-sentence-to-3d` into a fork and open the pull request.
4. **Suparagent, Orca, OpenMausBot and OpenHands (08, 10, 11, 13).** The listings are in [grok-fleet-tools.md](grok-fleet-tools.md#prepared-submissions-owner-step).
5. **The reply on X.** Draft: [x-posts/2026-11-27-grok-toolkit-reply.md](x-posts/2026-11-27-grok-toolkit-reply.md).

## What was not run

- Generation through the LiteLLM gateway (14). Catalog search through it ran, with a valid three.ws key forwarded; `forge_free` through it did not.
- Rigging a model from any of these examples. They stop at the GLB.
- A Grok review through the Claude Code bridge (07), for the sandbox reason given there.
- The five fleet apps themselves (08 to 11, 13).
- MetaGPT on Python 3.9 and 3.10. Only 3.11 was tested.
