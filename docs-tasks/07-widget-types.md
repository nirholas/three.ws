# Agent Task: Write "Widget Types" Documentation

## Output file
`public/docs/widgets.md`

## Target audience
Developers and non-technical users who want to embed pre-built 3D experiences on their pages. Needs to explain each of the five widget types with configuration options, use cases, and code examples.

## Word count
2000–3000 words

## What this document must cover

### 1. What is a widget?
A widget is a pre-configured, embeddable view of a three.ws or model. Unlike the raw `<agent-3d>` element (which requires you to configure everything), widgets are opinionated — each one is built for a specific use case. You pick a widget type, supply your model URL and options, and get a polished embed.

```html
<agent-3d widget="turntable" model="./product.glb"></agent-3d>
```

### 2. The five widget types

For each widget: description, ideal use case, all configuration options (as attribute or JSON), full embed code example, and a screenshot description (what it looks like).

---

#### 2.1 Turntable
**Use case:** Product display, portfolio showcase, hero banner with a 3D model.

**What it does:**
- Auto-rotates the model around the Y axis (like a product on a display stand)
- Minimal UI — just the rotating model
- Optional caption/headline overlay
- Click-to-pause on hover

**Configuration:**
```html
<agent-3d
  widget="turntable"
  model="https://example.com/product.glb"
  auto-rotate-speed="0.5"
  kiosk
></agent-3d>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `auto-rotate-speed` | number | 1 | Rotation speed (1 = one full rotation per ~6s) |
| `kiosk` | boolean | false | Hide all controls |
| `exposure` | number | 1 | Renderer brightness |
| `preset` | string | venice | Environment map preset |
| `caption` | string | — | Overlay text under model |

**Best for:** Marketing pages, product listings, landing page heroes.

---

#### 2.2 Animation Gallery
**Use case:** Showcase all animations in a GLB — let users browse and preview clips.

**What it does:**
- Lists all animation clips in the loaded GLB as cards
- Click a card to play that clip
- Shows clip name and duration
- Optional loop/single-shot toggle
- Useful for character animation demos or motion libraries

**Configuration:**
```html
<agent-3d
  widget="animation-gallery"
  model="https://example.com/character.glb"
></agent-3d>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | URL | required | GLB with animations |
| `auto-play` | boolean | false | Play first clip on load |
| `loop` | boolean | true | Loop selected clip |

**Best for:** Animation portfolios, character demos, rigging showcases.

---

#### 2.3 Talking Agent
**Use case:** An AI-powered 3D character that responds to user messages. The full chat experience in widget form.

**What it does:**
- Shows the 3D avatar with the emotion/expression system active
- Chat input at the bottom (or voice input button)
- Agent responds using the LLM runtime
- Speech bubbles or transcript overlay
- Skills available based on agent manifest

**Configuration:**
```html
<agent-3d
  widget="talking-agent"
  agent-id="aria-guide"
  mode="floating"
></agent-3d>
```

Or with inline config:
```html
<agent-3d
  widget="talking-agent"
  model="./avatar.glb"
  brain
  skills='[{"url":"https://cdn.three.wsskills/help.json"}]'
></agent-3d>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agent-id` | string | — | Platform agent ID |
| `model` | URL | — | GLB avatar URL (if not using agent-id) |
| `brain` | boolean | false | Enable LLM |
| `mode` | string | inline | Layout mode |
| `skills` | JSON | — | Inline skill array |
| `voice` | boolean | true | Show mic button |
| `placeholder` | string | "Ask me anything…" | Chat input placeholder |

**Best for:** Customer support bots, AI companions, interactive product guides.

---

#### 2.4 ERC-8004 Passport
**Use case:** Display an on-chain agent identity card — like an NFT card but for AI agents.

**What it does:**
- Resolves the agent's on-chain identity (via ERC-8004 IdentityRegistry)
- Shows: agent name, creator address, registered chain, reputation score
- 3D avatar rotates behind the card UI
- Links to on-chain explorer and reputation page
- QR code for sharing

**Configuration:**
```html
<agent-3d
  widget="passport"
  agent-id="0x1234...abcd"
  chain-id="8453"
></agent-3d>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agent-id` | string | required | On-chain agent ID or address |
| `chain-id` | number | — | Chain ID (1=Ethereum, 8453=Base, etc.) |
| `registry` | address | default registry | Custom registry contract address |
| `show-reputation` | boolean | true | Show reputation score |
| `show-qr` | boolean | true | Show QR code |

**Best for:** NFT projects, DAO governance, agent marketplaces, on-chain identity profiles.

---

#### 2.5 Hotspot Tour
**Use case:** Guided tour of a 3D scene with annotated points of interest.

**What it does:**
- Loads a 3D scene (building, product, character, etc.)
- Displays numbered hotspot pins at configured 3D positions
- Clicking a hotspot: camera smoothly animates to that viewpoint
- Overlay card shows title, description, and optional image for each hotspot
- "Next / Prev" navigation
- Optional narration via TTS for each hotspot

**Configuration:**
```html
<agent-3d
  widget="hotspot-tour"
  model="./building.glb"
  hotspots='[
    { "id": 1, "label": "Lobby", "position": [0, 0.5, 2], "cameraTarget": [0, 0.5, 0], "description": "The main entrance." },
    { "id": 2, "label": "Rooftop", "position": [0, 5, 0], "cameraTarget": [0, 5, 2], "description": "360° city views." }
  ]'
></agent-3d>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | URL | required | GLB scene URL |
| `hotspots` | JSON | required | Array of hotspot objects |
| `auto-advance` | boolean | false | Auto-advance through hotspots |
| `advance-interval` | number | 5000 | Ms between auto-advances |
| `narrate` | boolean | false | TTS-narrate each hotspot description |

Hotspot object schema:
```json
{
  "id": 1,
  "label": "Name shown on pin",
  "position": [x, y, z],
  "cameraTarget": [x, y, z],
  "cameraPosition": [x, y, z],
  "description": "Overlay text",
  "image": "https://..."
}
```

**Best for:** Architecture visualizations, museum exhibits, product feature tours, educational content.

---

### 3. Widget Studio (no-code builder)
Users can build widget configs visually at https://three.ws/studio:
- Upload or link a GLB
- Select widget type
- Configure options via form
- Preview live
- Copy embed code or publish to the platform

### 4. Getting a widget embed code
After creating a widget in Studio, copy the embed snippet:
```html
<!-- Hosted iframe embed -->
<iframe
  src="https://three.ws/widgets/view?id=<widget-id>"
  width="400"
  height="500"
  frameborder="0"
  allow="camera;microphone"
></iframe>

<!-- Or web component (loads faster, no iframe overhead) -->
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-3d widget-id="<widget-id>"></agent-3d>
```

### 5. Publishing widgets
Widgets can be:
- **Private** — only accessible by the creator
- **Unlisted** — accessible by anyone with the URL
- **Public** — listed in the widget gallery at https://three.ws/widgets

Publish via Widget Studio or the API (`POST /api/widgets`).

### 6. oEmbed support
All public widgets support oEmbed for automatic rich previews in Notion, Twitter, Substack, etc.:
```
GET https://three.ws/api/widgets/oembed?url=https://three.ws/widgets/view?id=<id>
```

### 7. Widget API
Full widget CRUD via REST — see the API Reference documentation.

## Tone
User-friendly but precise. Product/marketing teams may read this alongside developers. Include use case motivation before the technical config. The widget type descriptions should be immediately scannable.

## Files to read for accuracy
- `/src/widget-types.js` (290 lines)
- `/src/widgets/animation-gallery.js`
- `/src/widgets/passport.js`
- `/src/widgets.js`
- `/api/widgets/` — widget API routes
- `/docs/WIDGETS.md`
- `/specs/STAGE_SPEC.md`
- `/public/studio/` — Widget Studio UI
- `/public/widgets/` — Widget gallery
