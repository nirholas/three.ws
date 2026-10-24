---
name: build-an-agent-skill
description: Write a real three.ws agent skill bundle (manifest.json + SKILL.md + tools.json + handlers.js) that gives a 3D agent a new capability, then install it on an agent and test it. Use when you or the user want to build, write, author, or code a custom skill, capability, tool, or ability for a three.ws agent or an <agent-3d> embed ("give my agent a new skill", "make my agent able to check the weather", "write a custom tool for my avatar", "add a gesture skill"). Covers the four-file bundle layout, the handler context API, the sandbox limits, trust policy, and how to install the bundle.
when_to_use: The user wants an agent to be able to DO something new. To then charge for it, use sell-an-agent-skill. To create the agent itself first, use create-a-three-ws-agent. This is not about Claude skills: it is the three.ws in-app skill format that runs inside the agent runtime.
license: MIT
metadata:
  category: platform/agents
  cross-platform-safe: false
  pack: three-ws-skills
---

# Build a three.ws agent skill

A three.ws skill is a directory served from any URL. The agent runtime fetches it,
injects its instructions into the system prompt, exposes its tools to the LLM, and runs
its handlers in a Web Worker sandbox. Because a skill is just files behind a URL, the
same bundle installs into every agent without copying code.

Do not confuse this with the Claude skill you are reading: that one teaches an external
model how to use three.ws. This one teaches a three.ws agent a new capability.

## The four files

| File | Required | Purpose |
| --- | --- | --- |
| `manifest.json` | yes | Identity, version, what it provides, config defaults |
| `SKILL.md` | yes | Instructions injected into the agent's system prompt |
| `tools.json` | yes, if it exposes tools | JSON Schema tool definitions the LLM can call |
| `handlers.js` | no | ES module implementing each tool |

A bundle with no `handlers.js` is valid and always trusted: it is a declarative skill
that only shapes behavior (an accent, a house style, a refusal policy).

Assets (`clips/`, `morphs/`, `prompts/`, `assets/`) sit beside those files and are
resolved against `ctx.skillBaseURI`.

## A complete, working bundle

Copy this shape. The repo's starter is [`examples/skills/wave/`](https://github.com/nirholas/three.ws/tree/main/examples/skills/wave)
and the runtime contract is [docs/skills.md](https://three.ws/docs/skills).

`manifest.json`

```json
{
  "spec": "skill/0.1",
  "name": "weather-report",
  "version": "0.1.0",
  "description": "Look up the current temperature and wind for any named place and say it out loud.",
  "license": "MIT",
  "tags": ["weather", "voice"],
  "requires": { "runtime": ">=0.1.0", "capabilities": [] },
  "provides": { "tools": ["reportWeather"], "triggers": [] },
  "config": { "units": "metric" }
}
```

`tools.json`

```json
{
  "tools": [
    {
      "name": "reportWeather",
      "description": "Report the current temperature and wind speed for a named place, and speak the result.",
      "input_schema": {
        "type": "object",
        "properties": {
          "place": { "type": "string", "description": "City, town, or landmark name" }
        },
        "required": ["place"]
      }
    }
  ]
}
```

`handlers.js`

```js
// Two chained ctx.fetch calls against Open-Meteo: free, no API key, CORS open.
export async function reportWeather(args, ctx) {
  const place = String(args?.place || '').trim();
  if (!place) return { ok: false, error: 'place is required' };

  const geo = await ctx.fetch(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`,
  );
  if (!geo.ok) return { ok: false, error: `geocoding failed (${geo.status})` };
  const hit = (await geo.json())?.results?.[0];
  if (!hit) return { ok: false, error: `no place called "${place}"` };

  const imperial = ctx.skillConfig?.units === 'imperial';
  const query = new URLSearchParams({
    latitude: String(hit.latitude),
    longitude: String(hit.longitude),
    current: 'temperature_2m,wind_speed_10m',
    ...(imperial ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph' } : {}),
  });
  const res = await ctx.fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!res.ok) return { ok: false, error: `forecast failed (${res.status})` };

  const { current, current_units: u } = await res.json();
  const line =
    `It is ${current.temperature_2m}${u.temperature_2m} in ${hit.name}, ` +
    `wind ${current.wind_speed_10m} ${u.wind_speed_10m}.`;

  await ctx.speak(line);
  ctx.memory.note('weather-report', { place: hit.name, ...current });

  return { ok: true, data: { place: hit.name, ...current }, sentiment: 0.2 };
}
```

`SKILL.md` (the agent-facing instructions, not this file)

```markdown
# Weather report

When the user asks about the weather, temperature, or wind at a named place, call
`reportWeather` with that place name. Never guess the numbers: if the tool returns an
error, say you could not reach the weather service.
```

One exported function per tool name in `provides.tools`, matching `tools.json`. Return
`{ ok: true, ... }` on success and `{ ok: false, error: 'message' }` on failure; the
runtime surfaces the error to the LLM and fires a `skill-error` event instead of
crashing the agent. A numeric `sentiment` between -1 and 1 drives the avatar's empathy
layer (positive blends a celebration, negative blends concern).

## The handler context

`ctx` is the only way a handler reaches the outside world:

| Group | Calls |
| --- | --- |
| Scene | `ctx.viewer.play(clip, { blend })`, `stop`, `setExpression`, `lookAt`, `moveTo`, `playAnimationByHint(hint, { duration_ms })` |
| LLM | `ctx.llm.complete(prompt, opts)`, `ctx.llm.embed(text)` |
| Memory | `ctx.memory.read/write/note`, `ctx.memory.recall(query)` (substring search, not embeddings) |
| Assets | `ctx.loadClip(uri)`, `ctx.loadGLB(uri)`, `ctx.loadJSON(uri)`, `ctx.skillBaseURI` |
| Network | `ctx.fetch(uri, opts)` (normal CORS rules apply) |
| Other skills | `ctx.call(toolName, args)`, which crosses skill boundaries into built-ins like `speak` |
| User | `ctx.speak(text)`, `ctx.listen(opts)` |

`ctx.skillBaseURI` always ends in `/`, so resolve bundled assets with
`new URL('./clips/wave.glb', ctx.skillBaseURI).href`. Every individual `ctx.*` call
times out after 30 seconds.

## Sandbox limits that change how you write the handler

Handlers run in a Web Worker with no DOM. They **cannot** touch `document`, `window`,
`navigator`, `location`, cookies or storage, **cannot** use `import` statements inside
`handlers.js` (the blob module has no base URL for relative imports), and **cannot**
make network calls outside `ctx.fetch` / `ctx.loadJSON`.

Everything a skill actually needs stays available through `ctx.*`. Write one
self-contained module, no bundler, no dependencies.

A skill that genuinely needs main-thread Three.js or per-frame work sets
`"sandboxPolicy": "trusted-main-thread"` in its manifest, and that opt-out is honored
only for skills that pass the agent's `owned-only` or `whitelist` trust check. Skills
loaded under `any` trust stay sandboxed no matter what the manifest says.

## Trust

The registry enforces a per-agent trust policy: `owned-only` (default, `manifest.author`
must match the owner's wallet), `whitelist` (a list of publisher wallets), or `any`
(kiosks and demos). Under `owned-only`, a mismatched `author` makes `install()` throw
before any handler code is fetched. When the manifest carries `integrity` hashes, they
are verified before execution.

Set `author` to the owner's wallet address when the skill is meant to run on that
owner's agents.

## Install it

Host the directory anywhere that serves the files over HTTPS (or pin it to IPFS or
Arweave: `ipfs://` and `ar://` URIs resolve through a gateway chain). Then reference it.

From the agent manifest, with a pinned version range:

```json
{
  "skills": [{ "uri": "https://your-site.com/skills/weather-report/", "version": "^0.1.0" }]
}
```

Or from the embed, comma separated (the attribute cannot pin versions):

```html
<agent-3d
  agent-id="<your agent id>"
  skills="https://your-site.com/skills/weather-report/"
></agent-3d>
```

A skill can depend on other skills through `dependencies` (a map of skill URI to version
range). The registry installs them recursively first, detects circular dependencies, and
never re-fetches an already-installed URI.

## Test it for real

1. Serve the bundle locally (`npx -y serve .` or any static server) and embed the agent
   on a page with `skills="http://localhost:3000/skills/weather-report/"`.
2. Listen to the element events and watch the round trip:

```js
const el = document.querySelector('agent-3d');
el.addEventListener('skill:tool-start', (e) => console.log('start', e.detail));
el.addEventListener('skill:tool-called', (e) => console.log('called', e.detail));
```

3. Or bypass the LLM and call the tool directly in the console of the three.ws app:

```js
await window.VIEWER.agent_skills.perform('reportWeather', { place: 'Bondi Beach' });
```

4. Confirm all three lifecycle events fire on the protocol bus: `perform-skill`,
   then `skill-done` (or `skill-error` with the message you returned).

Verify the failure path too. A handler whose upstream is down must return
`{ ok: false, error }`, not throw an unhandled rejection.

## Next

- **Charge for it**: `sell-an-agent-skill` publishes the skill to the marketplace and
  prices it per call in $THREE, with the author's share routed to their own wallet.
- **Reference**: [docs/skills.md](https://three.ws/docs/skills) for the full runtime
  contract, [three.ws/tutorials/custom-skill](https://three.ws/tutorials/custom-skill)
  for a guided build, and `examples/skills/` in the repo for working bundles.
