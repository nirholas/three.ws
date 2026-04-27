# Agent Task: Write "Editor Guide" Documentation

## Output file
`public/docs/editor.md`

## Target audience
Users who want to edit an agent's 3D model, materials, textures, and publish their agent to the platform. Both non-technical users (using the UI) and developers (using the programmatic API).

## Word count
1500–2500 words

## What this document must cover

### 1. Accessing the editor
Two ways to access the editor:

**Edit an existing agent:**
`https://3dagent.vercel.app/agent-edit?agent=<agent-id>` (requires authentication)

**Open the general editor:**
`https://3dagent.vercel.app/app` — drag and drop any GLB file

### 2. The editor layout
Describe the main UI regions:
- **Left panel** — Scene Explorer (hierarchy tree of all nodes, meshes, cameras, lights)
- **Center** — 3D viewport (three.js canvas with editing enabled)
- **Right panel** — Inspector (properties of selected object: material, transform, animation)
- **Bottom toolbar** — validation status, animation controls, screenshot, publish buttons
- **Top bar** — agent name, save/publish/register buttons

### 3. Scene Explorer
`scene-explorer.js` provides a tree view of the scene graph:
- Expand/collapse nodes
- Click a node to select it (highlights in viewport)
- Shows: meshes, bones, cameras, lights, empty nodes
- Filter by type (meshes only, animated nodes only)
- Useful for diagnosing complex scenes with many objects

### 4. Material editor
`material-editor.js` lets you edit material properties:
- **Base color** — color picker + opacity
- **Metalness** (0=plastic, 1=metal)
- **Roughness** (0=mirror, 1=matte)
- **Emissive color** — self-illumination
- **Normal strength** — bump map intensity
- **Double-sided** toggle
- **Wireframe** toggle (preview only, not saved)
- **Alpha mode** — Opaque / Mask (cutout) / Blend (transparent)

Changes are applied to the in-memory glTF — use "Save" to persist.

### 5. Texture inspector
`texture-inspector.js` shows all textures in the loaded GLB:
- Thumbnail preview for each texture
- Resolution, format (PNG/JPG/KTX2)
- Which material slots use each texture
- Upload replacement texture (drag-and-drop or file picker)
- Download texture as PNG

Texture replacement is non-destructive — the original GLB is unchanged until you export.

### 6. Morph target sliders
If the model has morph targets (blend shapes), sliders appear in the inspector:
- Range: 0.0 (rest) to 1.0 (full deformation)
- Real-time preview in viewport
- Useful for testing facial expressions before linking to the emotion system
- Label names match what the agent emotion system expects

### 7. Animation controls
The animation panel (from `animation-panel.jsx`):
- Lists all clips in the GLB
- Play/pause each clip
- Speed control per clip
- "Play All" sequences through all clips
- Duration display

During editing, animations continue to run — this helps you preview how the avatar looks in motion while adjusting materials.

### 8. Manifest builder
`manifest-builder.js` is the most complex part of the editor — it generates the agent manifest JSON:

**Tab 1: Identity**
- Agent name
- Description
- Creator info

**Tab 2: Avatar**
- GLB URL (current file or custom URL)
- Thumbnail (auto-captured from viewport)
- Environment preset selection
- Camera position override

**Tab 3: Personality**
- System prompt textarea
- Tone selector (friendly/professional/playful/formal)
- Voice selection (for TTS)
- Domain hint

**Tab 4: Skills**
- Add/remove skills from URL
- Built-in skill toggles (wave, validate, remember, etc.)
- Custom skill JSON

**Tab 5: Memory**
- Mode selector (local/ipfs/encrypted-ipfs/none)
- IPFS provider selection
- Encryption key input

**Tab 6: Embed**
- Allowed origins (comma-separated)
- Default display mode
- Primary color picker

Clicking "Generate Manifest" produces the JSON → copy or publish directly.

### 9. Save and publish flow
**Save locally:**
`edit-persistence.js` saves edits to localStorage. On reload, edits are restored automatically. Status shown in toolbar.

**Save to account:**
"Save to Account" button → `save-back.js` → uploads modified GLB + manifest to your account. Requires authentication.

**Publish:**
`publish-modal.js` → `publish.js`:
1. Confirm agent name and description
2. Select visibility (private/unlisted/public)
3. Upload to platform storage
4. Manifest pinned to IPFS (if configured)
5. Agent appears in dashboard

**Export GLB:**
`glb-export.js` — download the current GLB with your edits applied (modified materials, removed unused assets).

### 10. Applying overrides
`apply-overrides.js` applies saved material/texture overrides to a freshly loaded GLB. This means:
- The original GLB file is never modified
- Edits are stored as a "diff" (overrides object)
- When loading, overrides are applied on top of the original
- You can always reset to the original

### 11. Editor session
`session.js` tracks the current editor session:
- Which GLB is loaded
- Auth state
- Unsaved changes (dirty flag)
- Last save timestamp

The dirty flag triggers a "Unsaved changes" warning if you try to navigate away.

### 12. Edit mode URL routing
Access specific agents in edit mode via URL:
- `https://3dagent.vercel.app/agent/<id>/edit` — public agent edit (owner only)
- `https://3dagent.vercel.app/app?agent=<id>` — app with agent loaded in edit mode
- `https://3dagent.vercel.app/agent-edit?agent=<id>` — full editor for authenticated users

### 13. Programmatic editing (advanced)
The editor exposes a JS API for programmatic modifications:
```js
const viewer = document.querySelector('agent-3d').viewer;

// Change material color
const mesh = viewer.scene.getObjectByName('Body');
mesh.material.color.setHex(0xff6600);

// Add a morph target influence
mesh.morphTargetInfluences[0] = 0.5;

// Export modified GLB
const glbData = await viewer.exportGLB();
```

## Tone
Practical guide. Screen-by-screen explanation. Developers and 3D artists both use this. Include the "why" for non-obvious features like overrides.

## Files to read for accuracy
- `/src/editor/index.js`
- `/src/editor/embed-editor.js` (24494 bytes)
- `/src/editor/manifest-builder.js` (52317 bytes — skim structure)
- `/src/editor/scene-explorer.js`
- `/src/editor/texture-inspector.js`
- `/src/editor/material-editor.js`
- `/src/editor/glb-export.js`
- `/src/editor/publish-modal.js`
- `/src/editor/publish.js`
- `/src/editor/regenerate-panel.js`
- `/src/editor/save-back.js`
- `/src/editor/edit-persistence.js`
- `/src/editor/apply-overrides.js`
- `/src/editor/session.js`
- `/src/components/animation-panel.jsx`
- `/specs/EDITOR_SPEC.md`
- `/agent-edit.html`
