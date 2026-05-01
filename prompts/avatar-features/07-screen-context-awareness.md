# Feature: Screen / Context Awareness

## Goal
The avatar can "see" what the user is looking at — a shared canvas, a 3D model on screen, a block of code — and reference it in conversation. "The error in line 42 there" instead of "the error you mentioned." Requires a screen capture or DOM snapshot pipeline feeding context into the LLM prompt.

## Context

**`src/runtime/index.js`** — the tool loop. `MAX_TOOL_ITERATIONS = 8`. This is where the LLM system prompt is assembled and where context can be injected. Find where `messages` or the system prompt is built.

**`src/runtime/tools.js`** — `BUILTIN_TOOLS` array + `BUILTIN_HANDLERS`. Tool handlers have signature `async (args, ctx) => ({ ok: true, ... })`. The `ctx` object includes `viewer`, `memory`, `llm`, `speak`, `fetch`.

**`src/agent-skills.js`** — built-in skills. A `look_at_screen` tool could live here or in `runtime/tools.js`.

**`src/runtime/scene.js`** — `SceneController`. Has access to the Three.js renderer via `viewer.renderer`. `renderer.domElement` is the canvas.

## What to build

### 1. Add a `captureContext()` utility in `src/runtime/screen-context.js`

Three capture modes, tried in order:

**Mode A: Three.js canvas snapshot (always available)**
```js
async function captureCanvas(renderer) {
    // renderer.render() should have just run — read pixels
    return renderer.domElement.toDataURL('image/jpeg', 0.6);
}
```

**Mode B: Visible text DOM snapshot (no permissions needed)**
```js
function captureVisibleText() {
    // Walk document.body, extract text from visible elements
    // Skip hidden (display:none, visibility:hidden, off-viewport)
    // Return first 2000 chars of visible text content
}
```

**Mode C: Screen capture (requires user permission, one-time)**
```js
async function captureScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    const bitmap = await imageCapture.grabFrame();
    track.stop();
    // Convert bitmap to base64 via OffscreenCanvas
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
}
```

Export:
```js
export async function captureContext(renderer, { mode = 'canvas' } = {}) {
    if (mode === 'canvas') return { type: 'image', data: await captureCanvas(renderer) };
    if (mode === 'text') return { type: 'text', data: captureVisibleText() };
    if (mode === 'screen') return { type: 'image', data: await captureScreen() };
}
```

### 2. Add a `see_screen` built-in tool in `src/runtime/tools.js`

```js
{
    name: 'see_screen',
    description: 'Capture what is currently visible on screen and describe it to inform your response.',
    input_schema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['canvas', 'text', 'screen'],
                description: 'canvas=3D viewport only, text=page text, screen=full screen (requires permission)',
            }
        },
        required: [],
    }
}
```

Handler in `BUILTIN_HANDLERS`:
```js
see_screen: async (args, ctx) => {
    const { captureContext } = await import('./screen-context.js');
    const result = await captureContext(ctx.viewer.renderer, { mode: args.mode ?? 'canvas' });
    if (result.type === 'image') {
        // Return base64 for inclusion in next LLM message as image content block
        return { ok: true, imageData: result.data, description: 'Screen captured.' };
    }
    return { ok: true, text: result.data };
},
```

### 3. Inject screen context into the LLM message

In `src/runtime/index.js`, after a `see_screen` tool result comes back, include the image as a vision content block in the next user message sent to the LLM:

```js
// If tool result contains imageData, add as image content block
if (toolResult.imageData) {
    nextUserContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: toolResult.imageData.split(',')[1] }
    });
}
```

This requires the LLM provider to support vision (Claude claude-sonnet-4-6+ does via Anthropic API).

### 4. Auto-capture on model load (optional enhancement)

In `src/agent-avatar.js`, `_onLoadEnd()` already fires when a GLB loads. After load, auto-trigger a canvas capture and store it as context in memory:

```js
_onLoadEnd(action) {
    if (!action.payload?.error) {
        // Capture 3D scene state for reference
        setTimeout(() => {
            captureContext(this.viewer.renderer, { mode: 'canvas' }).then(ctx => {
                this.protocol.emit(ACTION_TYPES.REMEMBER, {
                    type: 'scene_snapshot',
                    content: ctx.data,
                    uri: action.payload.uri,
                });
            });
        }, 500); // wait one render frame
    }
}
```

### 5. Privacy gate

Screen capture (`mode: 'screen'`) must only trigger on explicit user request or tool call — never automatically. Canvas and text modes are safe to use automatically since they only capture the app itself.

## Testing
- Load a GLB, ask "what color is the model?"
- The `see_screen` tool should fire, capture the canvas, and the LLM should correctly describe the visible model color
- Test `mode: 'text'` on a page with visible text content

## Conventions
- ESM only, tabs 4-wide
- `ImageCapture` API is not available in all browsers — wrap in try/catch and return `{ ok: false, error: 'Screen capture not supported' }` on failure
- Base64 image payloads are large — don't store in protocol history or memory by default
- Only `mode: 'screen'` requires user permission — document this clearly in the tool description
