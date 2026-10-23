# create-agent: one command, one 3D character

```bash
npm create @three-ws/agent "a friendly cartoon astronaut in a glossy white suit"
```

That command generates a textured 3D figure, rigs it with a humanoid skeleton, downloads it, and writes a folder with a working demo page and the embed snippet for your own site. No account, no API key, no signup: it runs on the three.ws free lane and the platform's provider keys cover the cost.

It is the terminal-native version of [three.ws/create](https://three.ws/create), for people who would rather stay in a shell, and for scripts and CI that need a character without a browser.

---

## The 60-second version

```bash
$ npm create @three-ws/agent "a knight in worn steel armor"

three.ws building "a knight in worn steel armor"
  a rigged humanoid, free lane, no account needed

· sent to the three.ws forge
· generating the figure (15s)
· generating the figure, then the skeleton (60s)
✓ model ready
· downloading the model

Knight In Worn is ready in 88s

  folder  a-knight-in-worn/
          index.html
          agent.json
          README.md
          agent.glb (3.1 MB)
  viewer  https://three.ws/viewer?src=…
```

```bash
$ npx serve a-knight-in-worn
```

The demo page renders the character with `<agent-3d>`; `agent.glb` is yours to drop into Blender, Unity, Godot, or any glTF tool.

---

## What lands on disk

| File | What it is |
| --- | --- |
| `agent.glb` | The model with its skeleton. Poseable and animatable, because three.ws retargets its pre-baked clip library onto any humanoid rig it can canonicalize. |
| `index.html` | A demo page that works on a double click. It points at the **hosted** model URL on purpose: a page opened over `file://` cannot fetch a neighbouring `.glb` without a server, and a demo that shows nothing is worse than no demo. |
| `agent.json` | Prompt, hosted URLs, backend, generation time, and a `madeWith` marker, so a script can pick the result up. |
| `README.md` | The embed snippet and the next steps, written for whoever opens the folder later. |

---

## Options

| Option | Meaning |
| --- | --- |
| `--photo <url>` | Build the character from a public https reference image instead of a description |
| `--out <dir>` | Where to write the project (default: a slug of the description) |
| `--name <name>` | Display name (default: derived from the description) |
| `--object` | An object or prop (mesh only) instead of a rigged character |
| `--no-download` | Keep the hosted model URL, skip writing `agent.glb` |
| `--json` | Print the result as JSON and nothing else, for scripting |
| `--origin <url>` | API origin (default `https://three.ws`) |

### Writing a prompt that rigs well

Describe **one full-body humanoid in a neutral standing pose**. Lead with the subject, then materials and colours; the free lane conditions on roughly the first 77 characters, so front-load what matters.

Good: `a friendly cartoon astronaut in a glossy white suit, orange visor`
Less good: `an epic scene where an astronaut floats above a ringed planet`

A clearly non-humanoid subject (furniture, a vehicle, a quadruped) should use `--object`. Auto-rigging assumes a humanoid.

---

## Under the hood

The CLI is a thin client over one public endpoint:

```bash
curl -s -X POST https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "forge_avatar",
      "arguments": { "prompt": "a friendly cartoon astronaut in a glossy white suit" }
    }
  }'
```

`forge_avatar` is generate-then-rig bundled; `--object` calls `forge_free` instead. Both are open, keyless JSON-RPC tools on the same endpoint the three.ws MCP server exposes, so anything that can speak HTTP can do what this CLI does. The MCP surface is documented in [mcp.md](mcp.md).

The job blocks server-side until the model exists, which is why the CLI reports **real elapsed seconds** rather than a progress bar it would have to invent. Every call carries a 10-minute deadline; on a timeout the job may still finish, and finished models land at [three.ws/creations](https://three.ws/creations).

---

## Programmatic use

```js
import { createAgent } from '@three-ws/create-agent';

const made = await createAgent({
	prompt: 'a friendly cartoon astronaut',
	out: './astro',
	onProgress: ({ message }) => console.log(message),
});
```

`createAgent`, `callForge`, `downloadModel` and the scaffold builders are all exported, and each takes `{ fetchImpl, signal, origin }`, so the pipeline runs against a local three.ws or a test double. Errors are one class, `ForgeError`, carrying a `code`: `timeout`, `unreachable`, `no_model`, `rpc_error`, `http_<status>`.

Full reference: [packages/create-agent/README.md](https://github.com/nirholas/three.ws/blob/main/packages/create-agent/README.md).

---

## Start from a template in the web wizard

The browser wizard at [three.ws/create-agent](https://three.ws/create-agent) has a second way to start besides the CLI above: a template gallery. The first step carries a "Start from a template" card. It opens a searchable grid of 26 ready-made Solana finance personas (whale watching, wallet safety, yield, launch vetting, tax planning and more). Pick one to preview its greeting, suggested prompts, the three.ws tools it works with and the full persona text, then press "Use this template".

What the click does:

- Fills the persona, greeting, category (`finance`) and skills. These replace whatever was there.
- Fills the name and description only when they are empty, and merges the template's tags into yours (up to 8). Your own words about your own agent are never overwritten.
- Clears any interview-generated profile, since the template persona replaces it.
- Leaves everything editable. A status line offers "Review persona" (jumps to the Personality step) and "Undo" (restores the previous values).

The gallery is keyboard operable: arrow keys, Home and End move between cards, Enter opens a preview, Escape closes the dialog and returns focus to the button that opened it. On phones the grid and the preview are separate views with a back button.

The catalog is [data/agent-templates.json](../data/agent-templates.json), loaded on first open so the wizard's initial paint never pays for it. Every template carries `id`, `name`, `tagline`, `category`, `tags`, `scope`, `persona`, `greeting`, `prompts`, `tools` and `skills`. `tools` names real three.ws MCP tools, and each persona tells the model to say so plainly when a tool is not connected. Every persona states a Solana scope, carries no wallet address and names no third-party token or protocol; `tests/agent-templates.test.js` enforces all of that, plus the wizard's field limits. To add a template, append an object to the file and run that test.

Code: [src/create-agent-templates.js](../src/create-agent-templates.js) (search, tag ranking, merge rules, dialog) and `wireTemplates` in [src/create-agent.js](../src/create-agent.js). Tests: [tests/create-agent-templates.test.js](../tests/create-agent-templates.test.js), [tests/e2e/create-agent-templates.spec.js](../tests/e2e/create-agent-templates.spec.js).

---

## Then what

- **Put it on your site.** The printed snippet is the whole integration; attribute reference in [web-component.md](web-component.md).
- **Give it a brain and a voice.** [three.ws/create](https://three.ws/create) takes the same model and adds a personality, memory, and speech.
- **Show what it is doing.** [Glance](glance.md) puts the agent's live status on a home screen, in a README, or in Slack.
- **Let other agents hire it.** [three.ws/marketplace](https://three.ws/marketplace).

---

## Runnable example

[`examples/coach-leo/`](https://github.com/nirholas/three.ws/tree/main/examples/coach-leo) The smallest complete agent defined entirely as files: a manifest, a system prompt, and one installed skill. Copy it as the template for your own.

It is part of the curated set `npm run export:satellites` publishes as the public
three.ws examples repo, so it is installed, run, and link-checked before every release.
