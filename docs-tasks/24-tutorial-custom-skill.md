# Agent Task: Write Tutorial — "Build a Custom Skill"

## Output file
`public/docs/tutorials/custom-skill.md`

## Target audience
Developers who want to extend an agent's capabilities with a custom skill. They're comfortable with JavaScript. By the end, they'll have a working skill that an agent can use.

## Word count
2000–3000 words

## What this tutorial must cover

### Learning objectives
By the end, the reader will have:
- A working custom skill that queries an external API
- The skill installed in an agent
- Understanding of the skill manifest format, handlers, tools, and context API

### The skill we're building
**Weather skill** — when a user asks about the weather, the agent queries a weather API and responds naturally.

Example conversation:
> User: "What's the weather like in Tokyo?"
> Agent: [calls get_weather({ city: "Tokyo" })]
> Agent: "Tokyo is currently 22°C with partly cloudy skies. Perfect for a walk!"

### Step 1: Create the skill directory structure
```
weather-skill/
  manifest.json      -- skill definition
  handlers.js        -- tool implementations
  README.md          -- documentation (optional)
```

### Step 2: Write the tool definition (manifest.json)
```json
{
  "name": "weather",
  "version": "1.0.0",
  "description": "Get current weather for any city",
  "author": "Your Name",
  "license": "MIT",
  "permissions": ["call-external-api"],
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather conditions for a city. Use this when the user asks about weather.",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "The city name, e.g. 'Tokyo' or 'New York'"
          },
          "units": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "default": "celsius",
            "description": "Temperature units"
          }
        },
        "required": ["city"]
      }
    }
  ],
  "handlers": "./handlers.js"
}
```

Explain each field:
- `name` — unique identifier (used to reference the skill)
- `tools` — what the LLM sees and can invoke
- `parameters` — JSON Schema for the tool's arguments
- `handlers` — URL of the handler module (relative to manifest)
- `permissions` — what capabilities this skill needs

### Step 3: Write the handler (handlers.js)
```js
// handlers.js

const WEATHER_API_BASE = 'https://wttr.in';

export async function get_weather({ city, units = 'celsius' }, ctx) {
  // Check permission (best practice)
  const allowed = await ctx.permissions?.check('call-external-api');
  if (allowed === false) {
    return { ok: false, error: 'Permission denied: this skill needs call-external-api permission' };
  }

  try {
    // wttr.in is a free weather API, no key needed
    const format = units === 'celsius' ? '%C+%t+%w+%p' : '%C+%f+%w+%p';
    const url = `${WEATHER_API_BASE}/${encodeURIComponent(city)}?format=${encodeURIComponent(format)}&lang=en`;

    const res = await ctx.fetch(url);
    if (!res.ok) {
      return { ok: false, error: `Weather service returned ${res.status}` };
    }

    const text = (await res.text()).trim();
    const [condition, temp, wind, precipitation] = text.split('+');

    return {
      ok: true,
      city,
      condition: condition || 'Unknown',
      temperature: temp || 'N/A',
      wind: wind || 'calm',
      precipitation: precipitation || '0mm',
      summary: `${city}: ${condition}, ${temp}, wind ${wind}`
    };
  } catch (err) {
    return { ok: false, error: `Failed to fetch weather: ${err.message}` };
  }
}
```

Walk through the code:
- Handler function name matches tool name
- First arg is validated parameters from the LLM
- Second arg is the context object
- Return `{ ok: true, ...data }` for success
- Return `{ ok: false, error: "..." }` for failure
- `ctx.fetch` is the safe network access method

### Step 4: Host the skill
Skills must be accessible via HTTPS. Options:

**GitHub Pages (free):**
```bash
mkdir weather-skill && cd weather-skill
git init && git add . && git commit -m "add weather skill"
gh repo create weather-skill --public
git push -u origin main
# Enable Pages: Settings → Pages → Deploy from branch
# URL: https://yourusername.github.io/weather-skill/manifest.json
```

**Vercel (simplest):**
```bash
npx vercel
# Done in 30 seconds
# URL: https://weather-skill-abc.vercel.app/manifest.json
```

**Local testing with ngrok:**
```bash
# Serve locally
npx serve .
# In another terminal:
npx ngrok http 3000
# Use the ngrok URL for testing
```

### Step 5: Install the skill in an agent
**Via the agent manifest:**
```json
{
  "name": "My Agent",
  "skills": [
    {
      "url": "https://yourusername.github.io/weather-skill/manifest.json"
    }
  ]
}
```

**Via the web component attribute:**
```html
<agent-3d
  model="./avatar.glb"
  skills='[{"url":"https://yourusername.github.io/weather-skill/manifest.json"}]'
></agent-3d>
```

**Via the editor:**
1. Open your agent in the editor
2. Go to Skills tab in the manifest builder
3. Paste the manifest URL
4. Click "Add Skill"
5. Save

### Step 6: Test the skill
With the agent running, type: "What's the weather in Tokyo?"

The agent should:
1. Call `get_weather({ city: "Tokyo" })` (you'll see this in DevTools → Network)
2. Receive the weather data
3. Respond naturally: "Tokyo is currently 18°C with overcast skies..."

If it doesn't work:
- Check DevTools console for errors
- Verify the manifest URL returns valid JSON (open it directly)
- Verify CORS headers allow your page's origin to fetch the manifest
- Check that the handler function name exactly matches the tool name

### Step 7: Improve the tool description
The LLM decides when to call your tool based on its `description`. Make it precise:

Bad: `"Get weather"`
Good: `"Get current weather conditions and temperature for a specific city. Use this when the user asks about weather, temperature, climate, or what to wear."`

The description is prompt-engineered — more context = better LLM decisions on when to invoke.

### Step 8: Add a second tool to the skill
Extend the skill with a forecast tool:
```json
{
  "name": "get_forecast",
  "description": "Get a 3-day weather forecast for a city",
  "parameters": {
    "type": "object",
    "properties": {
      "city": { "type": "string" },
      "days": { "type": "number", "minimum": 1, "maximum": 7, "default": 3 }
    },
    "required": ["city"]
  }
}
```

And the handler:
```js
export async function get_forecast({ city, days = 3 }, ctx) {
  // implementation...
}
```

One skill can have multiple tools — the LLM picks the right one based on context.

### Step 9: Using the context object
The context provides powerful capabilities for advanced skills:

```js
export async function my_tool(args, ctx) {
  // Store something to memory
  await ctx.memory.write('long-term', 'last-city', { city: args.city });

  // Read from memory
  const history = await ctx.memory.read('long-term', 'weather-history');

  // Make the agent speak something specific
  await ctx.speak(`Fetching weather for ${args.city}...`);

  // Load a different 3D model
  await ctx.loadGLB('https://example.com/weather-model.glb');

  // Call another tool
  const result = await ctx.call('get_weather', { city: args.city });

  return { ok: true };
}
```

### Step 10: Publishing your skill to the community
Skills are just static files — share your manifest URL in:
- The three.ws Discord #skills channel
- GitHub as a topic: `3dagent-skill`
- The community skill registry (coming soon)

Good skills to contribute:
- Domain-specific knowledge (legal, medical, cooking)
- Integrations (Spotify, GitHub, Notion)
- Game mechanics (RPG stats, dice rolling)
- Financial tools (prices, DCA strategies)

## Tone
Tutorial style — narrative, encouraging, builds understanding step by step. Show the full file contents, not snippets. The reader should be able to follow along exactly.

## Files to read for accuracy
- `/examples/skills/wave/` — complete example skill
- `/examples/coach-leo/` — full agent with skills
- `/src/skills/index.js` — skill registry
- `/src/agent-skills.js` — skill execution
- `/src/runtime/tools.js` — context object shape
- `/specs/SKILL_SPEC.md` — skill format spec
