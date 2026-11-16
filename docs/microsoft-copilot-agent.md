# three.ws 3D Studio agent for Microsoft 365 Copilot

A declarative agent that ships inside the three.ws Microsoft 365 app package. In Microsoft 365 Copilot (and Copilot in Teams) it shows up as **three.ws 3D Studio** in the agent list. Ask it for a 3D model, a rigged mascot, a ready-made asset or embed code, and it does the work through the same studio MCP tools that every other three.ws Microsoft surface uses (`https://three.ws/api/mcp-studio`). The free tools need no account and no sign-in.

Built and operated by three.ws. Approved claims only: three.ws and Microsoft have announced a partnership, and three.ws is live on Microsoft Marketplace. Neither the agent nor this doc says or implies that Microsoft built, endorses or reviews it.

## What users see

- **Name and description.** "three.ws 3D Studio", described as turning a plain-language request into a textured GLB 3D model or a rigged avatar, finding free CC0 assets with embed code, and opening every result in a 3D viewer.
- **Six conversation starters.** Each was run end to end in production through the exact tool sequence the agent uses (see [Production proof](#production-proof)):

  | Starter | Prompt | Tool sequence |
  |---|---|---|
  | Product model for a deck | Make a 3D model of a sleek wireless speaker for our sales deck. | `forge_free` → `check_job` |
  | Rigged mascot | Create a rigged, animation-ready 3D mascot: a friendly round robot in bright blue. | `forge_avatar` → `check_job` → `rig_mesh` (when the mesh came back unrigged) → `check_job` |
  | Find a ready-made asset | Find a free ready-made 3D model of an office chair I can use right away. | `search_catalog` → `get_catalog_item` |
  | Put 3D on our website | Give me paste-ready code to show a ready-made 3D armchair on our product page. | `search_catalog` → `get_item_source` |
  | How auto-rigging works | How does auto-rigging work on three.ws? | `search_docs` |
  | Inspect a model | Make a 3D model of a ceramic coffee mug and show me it from every side. | `forge_free` → `check_job` → `look_at_model` |

- **Asynchronous generation, said plainly.** A generation takes 30 seconds to 5 minutes. The tool answers within its inline wait with either the finished model or `status: pending`, a `job_id` and a `viewer_url`. The agent gives the viewer link straight away (it opens the model by itself the moment it is ready) and collects the result with `check_job` on the next turn. A failed or busy generation is retried once with a new `idempotency_key`; if that also fails, the agent passes on the reason the tool gave.
- **Results.** "Open in 3D viewer" (viewer URL), "Download GLB", the poster image, and one line on use (PowerPoint **Insert > 3D Models**, Teams, a website through `get_item_source`, any 3D tool). Catalog results carry their licence (CC0).
- **Disclaimer** shown before the first conversation: the agent is built and operated by three.ws, prompts are processed by three.ws, anyone with a model's link can open it, so prompts should not contain confidential information, with the privacy policy link.
- **Refusals.** Sexual content, real identifiable people without consent, weapons, hateful symbols and copies of trademarked characters or products are declined in one sentence with a safe alternative. The agent does not discuss crypto, tokens or trading.

## How it is built

All files live in [`integrations/microsoft/copilot-teams/`](../integrations/microsoft/copilot-teams):

| File | Role |
|---|---|
| `manifest.template.json` | The unified app manifest (v1.30). `copilotAgents.declarativeAgents` points at the agent: `{ "id": "threews-3d-studio", "file": "declarativeAgent.json" }`. App version 1.1.0. |
| `declarativeAgent.json` | Declarative agent manifest, schema v1.9: name, description, instructions, starters, disclaimer, one action. No capabilities (web search, OneDrive, Graph connectors and so on) are declared, because the agent only needs its own tools. |
| `ai-plugin.json` | Plugin manifest, schema v2.4, with a single `RemoteMCPServer` runtime at `https://three.ws/api/mcp-studio`. Tools are **pinned**: 13 named `functions` and a matching `run_for_functions`, described by `mcp_tool_description.file: "mcptools.json"`, so Copilot sees exactly the vetted tool descriptions instead of discovering them at run time. The persona tools are left out. Auth is `None`, because the studio's free tools serve anonymous callers. |
| `mcptools.json` | The studio tool descriptions, shared with the `agentConnectors` entry the Copilot Studio and Agent 365 surfaces read. |
| `schema/` | Vendored copies of Microsoft's published schemas (Teams v1.30, declarative agent v1.9, plugin v2.4) so validation runs offline. See [`schema/README.md`](../integrations/microsoft/copilot-teams/schema/README.md). |

### Validation

`npm run package:microsoft-app -- --check` validates the whole package offline, the agent and plugin included:

- `declarativeAgent.json` against the vendored v1.9 schema, plus Microsoft's documented limits: name 100 characters, description 1,000, instructions 8,000, at most 12 conversation starters (titles present and unique), disclaimer 500, 1 to 10 actions, every action file present in the package, ASCII only.
- `ai-plugin.json` against the vendored v2.4 schema, plus: `name_for_human` 20 characters, `description_for_human` 100, `description_for_model` 2,048; exactly one `RemoteMCPServer` runtime pointed at the production studio URL with `mcptools.json` pinned; no dynamic discovery (`*`); `functions` and `run_for_functions` identical; every pinned tool present in `mcptools.json`.
- The manifest's `copilotAgents` reference resolves to the shipped agent id and file.

A passing check prints, for example:

```
OK: manifest, schema v1.30, 16 tools, meeting stage tab and RSC, declarative agent "three.ws 3D Studio" (schema v1.9, 4034/8000 instruction characters, 6 starters), plugin schema v2.4 pinning 13 tools, icons and ASCII checks pass (owner values not checked).
```

[`tests/microsoft-app-package.test.js`](../tests/microsoft-app-package.test.js) fails on every violation above (over-long instructions, a 13th starter, a duplicate title, a missing action file, a wrong schema version, an unknown or dynamically discovered tool, a wrong runtime URL, and more) and on any starter without a production proof sequence.

## Sideload it in a developer tenant

You need a Microsoft 365 tenant with a Microsoft 365 Copilot licence on the test account and custom app upload allowed ([upload your app](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload)). A Microsoft 365 developer tenant works.

1. Build the package with the owner values set (see the [plan's owner checklist](./microsoft-marketplace-offer-plan.md#owner-checklist-in-order), step 15):
   `MS_APP_ID=... MS_DEVELOPER_NAME=... MS_KEYVAULT_URL=... MS_TEAMS_BOT_APP_ID=... npm run package:microsoft-app`
2. In Teams: **Apps** > **Manage your apps** > **Upload an app** > **Upload a custom app**, and pick the zip. The Microsoft 365 Agents Toolkit's preview command or the Teams Developer Portal (**Apps** > **Import app**) upload the same zip.
3. Open Microsoft 365 Copilot (or Copilot in Teams). **three.ws 3D Studio** appears in the agents list. Open it, read the disclaimer, and pick a starter.
4. Check each starter returns what the [proof table](#production-proof) shows: a viewer link and GLB for the generation starters, a CC0 chair with its GLB for the catalog starter, `<model-viewer>` code for the website starter, and a cited docs section for the auto-rigging question.

## How it ships

The agent is part of the same app package and the same Partner Center offer as the rest of the Microsoft 365 app: **Apps and Agents for Microsoft 365 and Copilot** (owner checklist step 14). There is no separate offer. Upload the rebuilt 1.1.0 zip to that offer and resubmit. The version bump from 1.0.0 is what tells Partner Center and installed tenants that the package changed. Publisher Attestation (step 16) is filed for the app as a whole; before resubmitting, check its data-handling answers still hold now that prompts typed into Copilot reach three.ws through the agent.

## Production proof

`node scripts/microsoft-copilot-agent-proof.mjs [--only "Starter title"] [--json out.json]` runs each starter's tool sequence anonymously against the URL in `ai-plugin.json` (override with `MCP_STUDIO_URL`), follows generations through `check_job`, and fetches every GLB to confirm it is a real glTF binary (and, for the mascot, that it carries a skeleton). Nothing is staged: every id below came back from production.

Run of 2026-11-16 against `https://three.ws/api/mcp-studio`:

| Starter | Result | Production output |
|---|---|---|
| Find a ready-made asset | Pass | `search_catalog` returned `object:modern_arm_chair_01` ("Modern Arm Chair 01", CC0); `get_catalog_item` gave the GLB `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/modern_arm_chair_01.glb` (glTF magic confirmed). |
| Put 3D on our website | Pass | `search_catalog` returned `object:chinese_armchair`; `get_item_source` returned `<model-viewer>` embed code with `src` `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/chinese_armchair.glb`. |
| How auto-rigging works | Pass | `search_docs` returned the "One-click auto-rigging" section of "What a three.ws agent can do" at `https://three.ws/docs#agent-abilities/FULL-ARTICLE@one-click-auto-rigging--bring-static-models-to-life`. |
| Rigged mascot | Mesh only | `forge_avatar` job `t1.mwje3sbz-1c43427d-f677-445f-9c7e-8138226c6753` finished through `check_job` with `https://three.ws/cdn/forge/nvidia/02e96e05-322e-4292-9ef3-e78ea18716b5.glb` (1.5 MB), but that file has no skin: a `forge_avatar` that goes pending returns the unrigged mesh. That run is why the agent instructions and the proof now call `rig_mesh` on such a mesh. |
| Product model for a deck, Inspect a model | Failing in production | Every `forge_free` attempt from 15:00 to 15:25 UTC failed, for example jobs `t1.mwje3sa3-84c51396-4fa5-4215-8638-3c48b30da52c` and `t1.mwje9ytg-4d70714e-3023-4920-b33c-2a2ab8cbd9da`. |

Why the generation starters failed on 2026-11-16, from the production logs:

1. The free NVIDIA lane answered `504` ("free NVIDIA NIM lane unavailable").
2. The fallback is our own TRELLIS worker. It received the reference image as a raw `*.r2.dev` URL that returned `404`, because the R2 credential is rejected (`401`). The write had gone to the GCS fallback bucket, but the URL still pointed at R2. Fixed in `api/_lib/image-persist.js` (the reference is now handed on as a `/cdn/` URL, which reads through the fallback), with a regression test in `tests/image-persist.test.js`. The fix needs a production deploy.
3. `model-triposg` in us-central1 cannot start: the region's L4 GPU quota is exhausted.

## Known limits

- **Free quota is per client IP** (4 generations a minute, 30 an hour; `STUDIO_LIMITS` in `api/_lib/rate-limit.js`). Copilot calls the plugin from Microsoft's egress, and `auth: None` carries no per-user identity, so heavy use across many tenants shares that quota. When the limit is hit the tool says when it resets and the agent passes that on.
- **Inline wait.** A generation tool answers within roughly 40 seconds, either done or pending with a viewer link. The agent never blocks a turn for the full generation.
