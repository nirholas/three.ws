# Agent Task: Write "Widget Studio Guide" Documentation

## Output file
`public/docs/widget-studio.md`

## Target audience
Non-technical users and developers who want to create embeddable 3D widgets without writing code. The Widget Studio is the no-code interface.

## Word count
1200–2000 words

## What this document must cover

### 1. What is Widget Studio?
Widget Studio is the visual builder for creating embeddable three.ws widgets. No code required — configure your widget through a form, preview it live, and copy the embed code.

Access: https://three.ws/studio

### 2. Getting started
1. Go to https://three.ws/studio
2. Sign in (required to save and publish)
3. Click "New Widget"
4. Choose your widget type

Or start from an existing agent:
1. Go to your agent's page
2. Click "Create Widget"
3. Widget Studio opens with your agent pre-selected

### 3. Step-by-step walkthrough

**Step 1: Choose a widget type**
Five types in the gallery:
- **Turntable** — auto-rotating product display
- **Talking Agent** — AI conversation widget
- **Animation Gallery** — browse animations
- **ERC-8004 Passport** — on-chain identity card
- **Hotspot Tour** — annotated scene tour

Click on the type that fits your use case. A brief description and preview animation appears.

**Step 2: Connect your 3D model**
Two options:
- Upload a GLB file (drag-and-drop area, max 50MB)
- Enter a URL to an existing GLB
- Or select from your saved agents

For the Passport widget: enter your on-chain agent ID instead.

The preview viewport updates in real time as you change settings.

**Step 3: Configure the widget**
Each widget type has specific settings. Common settings across all types:
- **Title** — shown in the widget header (optional)
- **Background color** — the canvas background
- **Environment preset** — lighting: Venice Sunset, Footprint Court, or Neutral Room
- **Width / Height** — default embed dimensions

**Turntable-specific:**
- Rotation speed (0.1x to 3x)
- Rotation axis (Y default, X or Z optional)
- Auto-pause on hover toggle
- Caption text

**Talking Agent-specific:**
- Agent ID or inline personality prompt
- Enable/disable voice input
- Chat input placeholder text
- Initial greeting message

**Animation Gallery-specific:**
- Auto-play on load
- Loop each clip
- Clip filter (hide clips by name prefix)

**Hotspot Tour-specific:**
- Add hotspots via click-to-place on the 3D model
- Each hotspot: title, description, optional image URL
- Auto-advance toggle with interval (seconds)

**Step 4: Style customization**
- Primary color (used for buttons, highlights)
- Font family (system | serif | monospace)
- Rounded corners (0px to 24px)
- Show/hide branding ("Powered by three.ws")

**Step 5: Preview**
The right panel shows a live preview of your widget at the configured dimensions. Try:
- Resizing the preview (drag the corner)
- Testing at mobile size
- For Talking Agent: send a test message

**Step 6: Save and publish**
- **Save as Draft** — stored in your account, not publicly accessible
- **Publish (Unlisted)** — live, accessible via URL, not in the gallery
- **Publish (Public)** — live and listed in the public widget gallery

After publishing: the embed code panel slides up.

### 4. Copying the embed code
Two embed options:

**Web component (recommended for developers):**
```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-3d widget-id="abc123" style="width:400px;height:500px"></agent-3d>
```

**iframe (works everywhere):**
```html
<iframe
  src="https://three.ws/widgets/view?id=abc123"
  width="400"
  height="500"
  frameborder="0"
  allow="camera;microphone"
></iframe>
```

Click "Copy" next to either snippet. The code is immediately ready to paste.

### 5. Widget gallery
Public widgets appear at https://three.ws/widgets. Browse to:
- Find inspiration
- Copy embed codes for community widgets
- Discover what other creators have built

Filter by widget type, search by name, sort by popularity or recency.

### 6. Managing your widgets
In your dashboard (https://three.ws/dashboard → Widgets):
- See all your widgets with preview thumbnails
- Edit widget settings
- Change visibility
- View embed code
- Delete widgets
- See impression counts

### 7. Widget analytics
Every widget tracks:
- Total impressions (views)
- Unique visitors
- Average session length
- For Talking Agent: conversation count, messages per session

View analytics in the dashboard → select a widget → Analytics tab.

### 8. Hotspot tour builder (detailed)
The hotspot builder deserves extra explanation:

1. Load your 3D scene
2. Click "Add Hotspot" in the toolbar
3. Click anywhere on the 3D model — a pin appears
4. Fill in the hotspot form:
   - Label (shown on the pin)
   - Title (shown in the overlay card)
   - Description (paragraph text)
   - Optional image URL
   - Camera position override (or use "Capture current camera")
5. Drag pins to reposition
6. Set the tour order (drag cards to reorder)
7. Preview the tour with the Play button

Tips:
- Position the camera before capturing — this is how users will see each hotspot
- Keep descriptions under 100 words for clean display
- Use consistent image dimensions for a polished look

### 9. Publishing to oEmbed platforms
Once your widget is published, paste the widget URL into:
- **Notion** — paste URL, press Enter → becomes an embedded viewer
- **Substack** — embed block → paste URL
- **Ghost CMS** — HTML card or oEmbed block
- **WordPress** — Gutenberg embed block → paste URL

The oEmbed protocol handles the rest automatically.

### 10. Troubleshooting
- Widget preview is blank: check that your GLB URL is accessible (CORS must allow three.ws)
- Can't save: make sure you're signed in
- Hotspot pins disappear after save: known issue with very large scenes — try reducing the model
- Talking Agent doesn't respond: LLM requires an API key configured in agent settings

## Tone
Friendly how-to guide. Non-technical readers first — keep jargon minimal. Screenshots are ideal here (describe them clearly so the agent knows to include "See the screenshot below" notes or similar). Step numbers are helpful.

## Files to read for accuracy
- `/public/studio/` — Widget Studio UI source
- `/src/widget-types.js` — widget type definitions
- `/src/widgets/` — widget implementations
- `/api/widgets/index.js` — widget CRUD API
- `/api/widgets/view.js` — widget viewer
- `/docs/WIDGETS.md`
- `/src/editor/publish-modal.js`
