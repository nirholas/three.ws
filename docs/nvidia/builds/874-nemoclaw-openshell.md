# Design: three.ws tools for NemoClaw agents under an OpenShell policy

**Status:** planned, not built. Work order: [874](../../../prompts/finish/874-nvidia-24-nemoclaw-openshell-integration.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

NemoClaw is NVIDIA's package for running AI agents. OpenShell is the runtime
that limits what such an agent may touch: which hosts, which files, which
credentials. This build makes three.ws a ready-made capability for those
agents: install it, and a NemoClaw agent can generate, rig and fetch 3D models,
inside a policy that lets it reach three.ws and nothing else.

It also proves the integration we already ship for Hermes Agent inside NVIDIA's
"NemoClaw for Hermes Agent" blueprint.

## Why build it

- Agents are NVIDIA's largest push of 2026
  ([research, agents](../../nvidia-showcase-research.md#agents-are-the-center-of-gravity)).
  The partners it named are large enterprises. A small, working, well-documented
  community entry is how a startup shows up there.
- NVIDIA named exactly one third-party channel: the `NVIDIA/nemoclaw-community`
  repository.
- "3D generation as a tool for agents, safely sandboxed" is a clear, useful
  example for that repository.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| The MCP servers | `api/_mcp-studio/`, [docs/mcp.md](../../mcp.md) | Hosted tools for generating and rigging models, on the free lane with a three.ws API key |
| The Hermes integration | [integrations/hermes/three-ws/](../../../integrations/hermes/three-ws/README.md) | `plugin.json`, `mcp.json` and four skills: create-3d-avatar, find-3d-assets, generate-3d-model, rig-a-model |
| Other NVIDIA integration | [integrations/nvidia/omniverse-kit-extension/](../../../integrations/nvidia/omniverse-kit-extension/README.md) | The neighbor directory this one sits beside |

## What is not known yet

These are read from NVIDIA's repositories in step 0, not assumed:

- How NemoClaw registers tools: MCP servers, a skill format, plugins or
  something else.
- The OpenShell policy file format.
- The licenses of both, and what the community repository accepts.

## Design

```
NemoClaw agent (hosted NVIDIA model endpoint)
    |
OpenShell policy
    |-- network: three.ws hosts the tools need + the model endpoint, nothing else
    |-- files:   one workspace directory, where GLBs are saved
    |-- secrets: the three.ws API key through the runtime's credential mechanism
    |
three.ws MCP server (unchanged)  ->  Forge  ->  GLB URL  ->  saved in the workspace
```

- **No three.ws server changes** unless a real protocol bug turns up, which is
  then fixed test-first. If NemoClaw speaks MCP, the integration is
  configuration. If it does not, the thinnest adapter in its native format
  calls the same public endpoints.
- **The policy must be shown to bite.** One run asks the agent to fetch an
  unrelated host and to write outside the workspace, and both are denied. A
  policy that was never seen to refuse anything proves nothing.
- **A worked example a real person would ask for:** "make a low-poly treasure
  chest, save it to the workspace, and tell me its triangle count and file
  size", run three times with transcripts kept.
- **Hermes inside NemoClaw.** The same policy, with our existing Hermes skills
  running inside NVIDIA's Hermes blueprint. Whatever breaks in our integration
  is fixed test-first.
- **Packaged for a stranger** as `integrations/nvidia/nemoclaw/`: README, config,
  policy explained line by line, the example, a verify script, and a test that
  validates the files against the documented formats.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Run NemoClaw unmodified | Exact versions and commands recorded |
| 2. Connect three.ws | The agent lists and calls our tools |
| 3. Policy | Allowed calls work; a foreign host and an outside write are denied, with the output kept |
| 4. Worked example | Three end-to-end runs, transcripts stored with secrets removed |
| 5. Hermes blueprint | Our existing skills work inside it, or the blueprint is recorded as gone |
| 6. Package and community entry | Directory complete; pull request title and body prepared in `docs/nvidia-nemoclaw-community-pr.md`, not sent |
| 7. Docs | `docs/nemoclaw.md`, linked from the MCP doc, changelog |

## The numbers it leaves behind

Three recorded runs with time per run, the denied actions with their policy
output, and the versions everything was tested against.

## Cost

No new service. At most 5 generated models for the live runs. If a throwaway VM
is needed to install NemoClaw, it deletes itself.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| NemoClaw does not speak MCP | A thin adapter in its native tool format over the same public endpoints |
| The community repository's rules exclude this kind of entry | The integration still ships in our repo and docs; the report says what the rules require |
| NemoClaw changes quickly | Versions are pinned in the README and the verify script fails loudly on a mismatch |

## Owner steps

Push. Open the pull request on `NVIDIA/nemoclaw-community` with the prepared
text. That is an external post, so it is always the owner's step.

## What we can say, and when

NemoClaw and OpenShell are things we integrate with, not technology running in
our production. The honest sentence is: "a NemoClaw agent can generate 3D models
through three.ws under a least-privilege OpenShell policy", with the code link.
