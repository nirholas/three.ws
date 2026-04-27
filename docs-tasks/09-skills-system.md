# Agent Task: Write "Skills System" Documentation

## Output file
`public/docs/skills.md`

## Target audience
Developers who want to extend an agent's capabilities — either using built-in skills or authoring custom ones. Assumes familiarity with JavaScript and JSON.

## Word count
2000–3000 words

## What this document must cover

### 1. What are skills?
Skills are modular, installable capabilities for agents. A skill defines:
- One or more **tools** that the LLM can invoke (with typed parameters)
- **Handlers** that execute when a tool is called (JavaScript)
- A **manifest** that describes the skill and its dependencies

Skills separate *what an agent can do* from *who the agent is*. The same wave skill can be installed in any agent.

### 2. Built-in skills
These skills come pre-installed in all agents:

| Skill | What it does |
|-------|-------------|
| `greet` | Wave and say hello on load |
| `present-model` | Describe the loaded 3D model (name, animations, polygon count) |
| `validate-model` | Run glTF validation and report issues |
| `remember` | Store user-provided information to memory |
| `think` | Surface internal reasoning as a thought bubble |
| `sign-action` | Sign the current action with the connected wallet |
| `help` | List available skills and commands |

### 3. Installing a skill from the registry
Skills are installed via the agent manifest:
```json
{
  "skills": [
    { "url": "https://cdn.three.wsskills/wave.json" },
    { "url": "https://cdn.three.wsskills/validate-model.json" }
  ]
}
```

Or at runtime via the web component:
```html
<agent-3d
  agent-id="my-agent"
  skills='[{"url":"https://cdn.three.wsskills/wave.json"}]'
></agent-3d>
```

### 4. Skill manifest format
A skill is described by a JSON manifest:

```json
{
  "name": "weather",
  "version": "1.0.0",
  "description": "Tell the user the current weather",
  "author": "Your Name",
  "license": "MIT",
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "City name, e.g. 'San Francisco'"
          }
        },
        "required": ["city"]
      }
    }
  ],
  "handlers": "./handlers.js",
  "dependencies": [
    { "url": "https://cdn.three.wsskills/wave.json" }
  ]
}
```

**Field reference:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique skill identifier |
| `version` | string | yes | Semver |
| `description` | string | yes | Human-readable purpose |
| `tools` | array | yes | Tool definitions (JSON Schema) |
| `handlers` | URL/string | yes | Handler module URL or inline code |
| `dependencies` | array | no | Other skill manifests to install first |
| `author` | string | no | Creator name |
| `license` | string | no | SPDX license |

### 5. Writing a handler
Handlers are JavaScript modules. Each export matches a tool name:

```js
// handlers.js
export async function get_weather({ city }, ctx) {
  const res = await ctx.fetch(`https://api.weather.com/v1/current?city=${encodeURIComponent(city)}`);
  const data = await res.json();
  return {
    ok: true,
    temperature: data.temp,
    condition: data.condition,
    summary: `${city}: ${data.temp}°F, ${data.condition}`
  };
}
```

**Handler signature:**
```js
async function toolName(args, context) {
  // args: validated parameters from tool call
  // context: { viewer, memory, llm, speak, listen, fetch, loadGLB, loadClip, loadJSON, call }
  return { ok: true, ...result };
}
```

**Context object:**
- `ctx.viewer` — access to the three.js scene (camera, scene, renderer)
- `ctx.memory` — read/write agent memory
- `ctx.speak(text)` — make the agent say something
- `ctx.fetch(url)` — network requests (respects CORS proxy)
- `ctx.loadGLB(url)` — load a new GLB model
- `ctx.loadClip(url)` — load an animation clip
- `ctx.call(toolName, args)` — call another tool (cross-skill)
- `ctx.llm` — direct LLM access for nested reasoning

### 6. Skill trust and security
The skill registry enforces three trust modes:

| Mode | Behavior |
|------|---------|
| `any` | All skills from any URL are allowed |
| `owned-only` | Only skills where `creator.address` matches the agent owner's wallet |
| `whitelist` | Only skills explicitly listed in a configured allowlist |

Default is `owned-only` for agents with a registered identity.

**Skill sandboxing:** Handlers run in a restricted context via ERC-7710 delegation. They can only access APIs explicitly granted. A weather skill cannot access the wallet signing API unless the user grants it.

### 7. Skill dependencies
Skills can declare dependencies on other skills:
```json
{
  "name": "full-agent-kit",
  "dependencies": [
    { "url": "https://cdn.three.wsskills/wave.json" },
    { "url": "https://cdn.three.wsskills/validate-model.json" }
  ],
  "tools": []
}
```
The registry resolves dependencies recursively. Circular dependencies are detected and rejected.

### 8. Bundled base URL
When a skill manifest is loaded from a CDN, relative URLs in the skill (like `./handlers.js`) are resolved against the manifest's URL (`bundleBase`):

```json
{
  "handlers": "./handlers.js"  // resolved to: https://cdn.example.com/skills/weather/handlers.js
}
```

### 9. The `coach-leo` example skill
Reference the included example in `/examples/coach-leo/`:
- `manifest.json` — full agent manifest using custom skills
- `instructions.md` — personality prompt
- `SKILL.md` — skill documentation

Show how a real skill is structured end-to-end.

### 10. The `wave` example skill
Reference `/examples/skills/wave/`:
```
wave/
  manifest.json    -- skill manifest
  handlers.js      -- triggers wave gesture
  tools.json       -- tool definitions
  SKILL.md         -- documentation
```

Walk through the wave skill as a minimal working example.

### 11. Publishing a skill
Skills can be published:
- As static files on any CDN (GitHub Releases, Vercel, S3)
- Via npm as part of a package
- Via the three.ws platform (coming soon)

Convention: name the manifest `manifest.json` and co-locate `handlers.js` in the same directory.

### 12. Skill lifecycle events
When a skill runs:
1. `perform-skill` event fires on the agent protocol bus `{ skill: name, args }`
2. Handler executes
3. `skill-done` event fires `{ skill: name, result }`

Listen to these in the host page:
```js
el.addEventListener('skill-done', e => {
  console.log('Skill completed:', e.detail.skill, e.detail.result);
});
```

### 13. Calling skills programmatically
```js
const el = document.querySelector('agent-3d');
const result = await el.agent.skills.execute('get_weather', { city: 'Berlin' });
```

## Tone
Developer-focused. Code-heavy. Walk through a complete example. Be precise about the context object and what's available. The example skills in `/examples/` should be used as real references.

## Files to read for accuracy
- `/src/agent-skills.js` (449 lines)
- `/src/skills/index.js`
- `/src/runtime/tools.js`
- `/specs/SKILL_SPEC.md`
- `/examples/skills/wave/` — all files in this directory
- `/examples/coach-leo/` — all files in this directory
- `/specs/PERMISSIONS_SPEC.md`
