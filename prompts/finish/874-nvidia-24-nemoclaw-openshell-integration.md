# nvidia 24: A NemoClaw agent can make 3D models with three.ws inside an OpenShell policy, proven on a real install and packaged for NVIDIA's community repository

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3274 (`npm run dev -- --port 3274 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, opening the pull request on `NVIDIA/nemoclaw-community`, any forum or social post, the Inception portal edit) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **This order calls Forge only as an outside client** through the public MCP server, on the free lane. It changes no generation code.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

NVIDIA's largest 2026 push is agents. The Agent Toolkit announced at GTC on 2026-03-16 centers on NemoClaw (`github.com/NVIDIA/NemoClaw`, described as the full agent deployment package: models, harness, tools and runtime) and OpenShell (`github.com/NVIDIA/OpenShell`, an open-source runtime that enforces policy on an agent's files, network, credentials and tools). The one third-party contribution channel NVIDIA named is `github.com/NVIDIA/nemoclaw-community`. Nearly every new NVIDIA blueprint is a NemoClaw variant, and none of them can make a 3D model. three.ws already ships an MCP server (`mcp-server/`, `@three-ws/mcp-server`) and integrations for other agent harnesses under `integrations/`. A tested NemoClaw integration puts us inside the thing NVIDIA is promoting, by the door it opened.

What is NOT known and must be read from the repositories, not assumed: how NemoClaw registers tools (MCP servers, a skill format, plugins, or something else), the OpenShell policy file format, the licenses, and what the community repository accepts.

## Step 0: re-derive the current state

A design doc for this build exists at `docs/nvidia/builds/874-nemoclaw-openshell.md`. It is a plan written on 2026-11-26, not a spec: this order is complete without it, and where the code or a license disagrees with it, the code and the license win.

    ls integrations integrations/nvidia integrations/hermes/three-ws
    sed -n 1,80p mcp-server/README.md
    sed -n 1,60p docs/mcp.md
    grep -rn -i "nemoclaw\|openshell" --include=*.md --include=*.json --include=*.js . 2>/dev/null | grep -v node_modules | head

Clone `NVIDIA/NemoClaw`, `NVIDIA/OpenShell` and `NVIDIA/nemoclaw-community` into your session scratch directory (not the repo). Read each README, license, contribution guide and at least two existing community entries end to end. Write down: the install path that works without a local GPU (NemoClaw can use hosted models; find out which and how it is configured), how a tool source is added, the policy format, and the exact directory layout and review rules for a community contribution. If an integration for NemoClaw already exists under `integrations/`, finish it.

Read one sibling integration (`integrations/hermes/three-ws/`) for the house layout of an integration: README, config, example, tests.

## Tasks

1. **Run NemoClaw for real.** Install it on this machine or on a GCE VM that deletes itself, configured against a hosted model endpoint (the `NVIDIA_API_KEY` we already use, read the sanctioned way). Record the exact versions and commands.
2. **Connect three.ws.** Add the three.ws MCP server (the hosted studio server on the free lane, authenticated with a three.ws API key) by whatever mechanism NemoClaw supports. If NemoClaw does not speak MCP, write the thinnest adapter in its native tool or skill format that calls the same public endpoints. No three.ws server code changes unless you find a real protocol bug, which is then fixed test-first.
3. **An OpenShell policy that is least-privilege.** Network egress only to the three.ws hosts the tools need and the model endpoint; file writes only inside one workspace directory where GLBs are saved; the API key supplied through the runtime's credential mechanism, never written into a file the agent can read back. Prove the policy bites: a test run where the agent is asked to fetch an unrelated host or write outside the workspace is denied, with the denial in the log.
4. **A worked example.** One task a real user would give: "make a low-poly treasure chest, save it to the workspace, and tell me its triangle count and file size". Run it end to end at least three times (this order's live generation budget is 5 models) and keep the transcripts, with secrets removed, in the integration directory.
5. **Prove the integration we already ship.** NVIDIA's blueprint catalog (`build.nvidia.com/blueprints`) lists NemoClaw variants for other agent harnesses, including one for Hermes Agent, and we already publish a Hermes integration at `integrations/hermes/three-ws/`. Run that blueprint and show our existing Hermes skills working inside it under the same policy. Fix what breaks in our integration test-first, and record the result in its README. If the blueprint no longer exists, say so and skip this task.
6. **Package it** as `integrations/nvidia/nemoclaw/`: README (what it does, prerequisites, install, the policy explained line by line, troubleshooting from the errors you actually hit), the config and policy files, the example, and a script that verifies an install. Add a test under `tests/` that validates the config and policy files against the formats you documented.
7. **Prepare the community contribution, do not send it.** Lay the entry out exactly as `NVIDIA/nemoclaw-community` requires in `integrations/nvidia/nemoclaw/community-entry/`, with the pull request title and body in `docs/nvidia-nemoclaw-community-pr.md`. NVIDIA-facing copy stays technical: no token, price or monetization vocabulary, and no claim beyond "three.ws is a member of the NVIDIA Inception program".
8. **Docs.** A developer doc at `docs/nemoclaw.md` linked from `docs/mcp.md`, a `STRUCTURE.md` row, and a `data/changelog.json` entry (then `npm run build:pages`). NemoClaw and OpenShell are listed as integrations we support, not as technologies running in our production, in `docs/nvidia-apps-catalog-listing.md`.

## Definition of done

- [ ] NemoClaw ran on a real install with versions recorded, and the agent produced a GLB through three.ws three times.
- [ ] The OpenShell policy allows the task and denies an off-policy fetch and an off-workspace write, with log lines as evidence.
- [ ] `integrations/nvidia/nemoclaw/` is complete and its verify script passes on a clean install.
- [ ] The community entry and pull request text are in the repo, matching the upstream contribution rules you quoted.
- [ ] No secret appears in any committed transcript, config or log (`npm run check:rules` and a manual grep for the key prefix).
- [ ] `npm test` passes; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| NemoClaw needs a local RTX GPU for its default models | Configure it against hosted models. If no hosted configuration exists, run it on a GCE GPU VM in the pre-approved project that deletes itself, and record the cost. |
| The install needs Docker features the devbox lacks | Use a GCE VM with a startup script and a self-delete, keep the script in the integration directory. |
| A license forbids redistribution of something you wanted to vendor | Do not vendor it. Reference it and document the install step. |
| The repositories have moved or been renamed | Follow the redirect, record the new location in the README, and continue. |
| The community repository's format is unclear | Mirror the most recently merged entry and say which one you mirrored. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner. Then bring this build's design doc `docs/nvidia/builds/874-nemoclaw-openshell.md` and its row in `docs/nvidia/builds/README.md` up to date: the status, the measured numbers, anything the design got wrong, and the commit hash in place of the link to this order (the order is archived, so the link would break).
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, opening the pull request on `NVIDIA/nemoclaw-community`, any forum or social post, the Inception portal edit); one-line judgment calls. No trailing questions.
