# Agent Task: Write "Quick Start" Documentation

## Output file
`public/docs/quick-start.md`

## Target audience
A developer who wants to go from zero to a working three.ws on their page in under 10 minutes. They have basic HTML/JS knowledge. They may or may not have a 3D model yet.

## Word count
1200–2000 words

## What this document must cover

### 1. Prerequisites
- A modern browser (Chrome 90+, Firefox 89+, Safari 15+)
- A GLB/glTF file (or use one of the provided sample models)
- Optional: Node.js 18+ for local dev server

### 2. Option A — CDN drop-in (zero build step)
Show the absolute fastest path. Complete working HTML file:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>My three.ws</title>
  <style>
    agent-3d { width: 400px; height: 500px; display: block; }
  </style>
</head>
<body>
  <script type="module" src="https://cdn.three.wsagent-3d.js"></script>
  <agent-3d model="https://cdn.three.wsmodels/sample-avatar.glb"></agent-3d>
</body>
</html>
```
Explain each part. Note that the web component lazy-loads when visible (IntersectionObserver).

### 3. Option B — npm install
```bash
npm install @3dagent/sdk
```
Show how to import and use in a Vite/React/plain-JS project.

### 4. Loading your own model
Explain accepted formats:
- GLB (binary glTF) — recommended
- glTF 2.0 (JSON + separate assets)
- Draco-compressed meshes (supported)
- KTX2 compressed textures (supported)

Show the `model` attribute with a local file URL.

### 5. Adding an AI agent brain
Minimal example with `brain` mode:
```html
<agent-3d
  model="./avatar.glb"
  agent-id="my-agent"
  mode="inline"
></agent-3d>
```
Explain what `agent-id` does (loads the agent manifest from the API or local config).

### 6. Using a pre-built widget
Shortest path to an animated turntable banner:
```html
<agent-3d widget="turntable" model="./product.glb"></agent-3d>
```
Mention all five widget types briefly, link to Widget docs.

### 7. Running the dev server (for contributors/self-hosters)
```bash
git clone https://github.com/3dagent/3dagent
cd 3dagent
npm install
cp .env.example .env  # fill in API keys
npm run dev
```
Open http://localhost:5173. Note which env vars are required vs optional.

### 8. First steps after loading
- Try dragging/orbiting the model
- Click "Animations" tab to play clips
- Open the editor to tweak materials
- Link a wallet to create an identity

### 9. Common gotchas
- CORS: GLB files must be served with permissive CORS headers if cross-origin
- File size: very large models (>50MB) may be slow — use Draco compression
- HTTPS: camera/mic access for voice requires HTTPS
- CSP: if running in an iframe with strict CSP, use the `agent-embed.html` iframe variant

### 10. Next steps
Link to:
- Embed Guide
- Widget Types
- Agent System
- Uploading to the Platform

## Tone
Step-by-step, precise. Every command should be copy-paste ready. Acknowledge things that can go wrong and how to fix them. Keep it tight — developers will skim this.

## Files to read for accuracy
- `/src/element.js` — web component attributes (`model`, `agent-id`, `widget`, `mode`, `skills`)
- `/src/lib.js` — CDN export
- `/examples/minimal.html` — working example
- `/examples/web-component.html` — web component example
- `/.env.example` — required env vars
- `/vite.config.js` — build setup
- `/docs/SETUP.md` — setup instructions
- `/docs/DEVELOPMENT.md` — dev guide
- `/package.json` — scripts and dependencies
