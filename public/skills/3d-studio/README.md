# three.ws 3D Agent Skills

The platform's 3D creation skills, packaged so any agent runtime can load them.
Each folder is a self-contained skill: a `SKILL.md` whose frontmatter says when
to trigger it, and instructions for driving the free, keyless 3D tools on
https://three.ws/api/mcp-studio.

| Skill | What it does |
| --- | --- |
| [`create-3d-avatar`](create-3d-avatar/SKILL.md) | Turn a text prompt (or reference image) into a rigged, animation-ready 3D avatar (GLB). |
| [`embed-three-ws-avatar`](embed-three-ws-avatar/SKILL.md) | Embed a live, animated three.ws 3D avatar in any website with the &lt;agent-3d&gt; web component. |
| [`generate-3d-model`](generate-3d-model/SKILL.md) | Turn a text prompt into a downloadable, textured 3D model (GLB). |
| [`rig-a-model`](rig-a-model/SKILL.md) | Auto-rig a static 3D GLB model into an animation-ready one. |

## Use them

Download the whole set:

```bash
curl -O https://three.ws/skills/3d-studio/three-ws-3d-skills.zip
```

Or read one directly, no clone required:

```bash
curl https://three.ws/skills/3d-studio/create-3d-avatar/SKILL.md
```

Drop a folder into `.claude/skills/` for Claude Code or the Claude apps, upload
the zip on the Skills tab of an OpenAI plugin submission, or point any other
agent runtime at the same files. Nothing here needs an account, an API key, or a
payment: the platform covers provider cost on the free lanes.

## Generated, not hand-maintained

This directory is produced by
[`scripts/build-openai-skills-bundle.mjs`](../../../scripts/build-openai-skills-bundle.mjs)
from the canonical pack in [`.agents/skills/`](../../../.agents/skills).
Edit the skill there, then run `npm run build:openai-skills`.
`npm run check:openai-skills` fails if this copy has drifted.

Only skills tagged `3d/creative` and `cross-platform-safe` are published here,
and any skill referencing a tool the studio endpoint does not expose is dropped:
a skill that tells a model to call a tool that is not there is a dead path, not a
feature.
