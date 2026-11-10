---
name: create-agent
description: Generate a rigged, animated 3D character from a sentence and scaffold a project with an embed page using @three-ws/create-agent. Use when the user wants a 3D agent or avatar to embed on a website from a text prompt or a reference photo.
---

# Create a 3D agent

`@three-ws/create-agent` (Node 18+) turns a description into a rigged humanoid GLB on the free three.ws lane, with no account and no API key, then writes a small project around it.

## Run

```bash
npx -y @three-ws/create-agent "a friendly cartoon astronaut in a glossy white suit"
# same thing: npm create @three-ws/agent "..."
```

Options:

```
"<what to make>"     describe a single full-body character
--photo <url>        build from a public https reference image instead
--out <dir>          output directory (default: a slug of the prompt)
--name <name>        display name (default: derived from the prompt)
--object             make an object or prop instead of a rigged character
--no-download        skip writing agent.glb locally, keep the hosted URL only
--json               print the result as JSON and nothing else
--origin <url>       API origin (default https://three.ws)
-h, --help
```

Generation takes a while and is a blocking call. Progress lines are real events (submitted, working, download), not a percentage.

## Output

The command creates a folder with `agent.glb` (unless `--no-download`) and the generated project files, then prints the viewer URL, the studio URL when available, and an `<agent-3d>` embed snippet that loads `https://three.ws/agent-3d/latest/agent-3d.js`. With `--json` the result includes `dir`, `files`, `name`, `bytes`, `seconds` and `result` (with `glbUrl`, `viewerUrl`, `studioUrl`).

## Worked example

```bash
npx -y @three-ws/create-agent "a knight in worn steel armor" --out ./knight --json
```

Then open `./knight/index.html` in a browser, or paste the printed `<agent-3d>` snippet into any page.

Library use:

```js
import { createAgent, embedSnippet } from '@three-ws/create-agent';
const made = await createAgent({ prompt: 'a small ceramic frog figurine', rig: false, out: './frog' });
console.log(made.result.glbUrl, made.files);
```

## Guidance

- Describe one full-body subject per prompt. Use `--object` for props so no skeleton is attempted.
- `--photo` needs a public https image URL.
- Errors surface as `ForgeError` from the underlying generation call. Rerun after a transient failure.
