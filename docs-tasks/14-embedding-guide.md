# Agent Task: Write "Embedding Guide" Documentation

## Output file
`public/docs/embedding.md`

## Target audience
Developers and no-code builders who want to embed a three.ws or widget on their website, app, or platform. Covers all embedding methods from one-liner to advanced iframe.

## Word count
1500–2500 words

## What this document must cover

### 1. Overview of embedding options
Four ways to embed a three.ws:

| Method | Complexity | Control | Use case |
|--------|-----------|---------|---------|
| Web component | Low | Full | Same-origin or trusted cross-origin pages |
| iframe widget | Very low | Limited | Third-party pages, CMS embeds, sandboxed contexts |
| oEmbed | None (paste URL) | None | Notion, Substack, blog platforms |
| Claude Artifact | None | None | Claude.ai artifact context |

### 2. Method 1: Web component
The recommended approach for developers with control over their page.

```html
<!-- 1. Load the library -->
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>

<!-- 2. Place the element -->
<agent-3d
  agent-id="your-agent-id"
  style="width: 400px; height: 500px; display: block;"
></agent-3d>
```

**Advantages:**
- Loads faster (no iframe overhead)
- Full JS API available on the element
- Can be styled with CSS
- Can communicate events to parent page

**Sizing:**
The element uses its CSS `width` and `height`. Always set these or the element will collapse.
```css
agent-3d {
  width: 100%;
  max-width: 600px;
  height: 500px;
  border-radius: 12px;
  overflow: hidden;
}
```

**Lazy loading:**
The component loads the GL context only when it's scrolled into view. Elements "below the fold" don't impact initial page load performance.

### 3. Method 2: iframe widget
For third-party pages where you can't load external scripts, or CMS platforms with strict CSP.

```html
<iframe
  src="https://three.ws/agent-embed?id=your-agent-id"
  width="400"
  height="500"
  frameborder="0"
  allow="camera; microphone; xr-spatial-tracking"
  title="three.ws"
></iframe>
```

Iframe URL format:
- Agent embed: `/agent-embed?id=<agent-id>`
- Widget embed: `/widgets/view?id=<widget-id>`
- Model-only: `/embed?model=<glb-url>`
- On-chain agent: `/a-embed?chainId=<id>&agentId=<id>`

**The `allow` attribute:**
- `camera` — needed for AR mode
- `microphone` — needed for voice input
- `xr-spatial-tracking` — needed for WebXR AR

### 4. postMessage communication (iframe)
For hosts that need to communicate with the embedded agent:

**Host → Embed:**
```js
const iframe = document.getElementById('my-agent-iframe');

// Load a new model
iframe.contentWindow.postMessage({
  type: '3dagent:load',
  model: 'https://example.com/new-model.glb'
}, 'https://three.ws/');

// Speak
iframe.contentWindow.postMessage({
  type: '3dagent:speak',
  text: 'Hello from the host page!'
}, 'https://three.ws/');

// Take screenshot
iframe.contentWindow.postMessage({ type: '3dagent:screenshot' }, '*');
```

**Embed → Host:**
```js
window.addEventListener('message', e => {
  if (e.origin !== 'https://three.ws/') return; // always verify origin

  switch (e.data.type) {
    case '3dagent:ready':
      console.log('Agent loaded');
      break;
    case '3dagent:speak':
      console.log('Agent said:', e.data.text);
      break;
    case '3dagent:screenshot':
      const img = document.createElement('img');
      img.src = e.data.dataUrl;
      document.body.appendChild(img);
      break;
  }
});
```

### 5. Embed allow-list (CORS policy)
By default, embeds are allowed from any origin. To restrict which domains can embed your agent:

In your agent manifest:
```json
{
  "embed": {
    "allowedOrigins": [
      "https://yourwebsite.com",
      "https://app.yourwebsite.com"
    ]
  }
}
```

Or configure via the dashboard → Agent Settings → Embed Policy.

### 6. Method 3: oEmbed (paste-to-embed)
Many platforms (Notion, Substack, WordPress, Ghost, Loom, etc.) support oEmbed — you paste a URL and the platform automatically fetches a rich preview.

To embed via oEmbed:
1. Publish your widget (make it public in Widget Studio)
2. Get the widget URL: `https://three.ws/widgets/view?id=<widget-id>`
3. Paste the URL directly into Notion, Substack, etc.
4. The platform auto-fetches the oEmbed endpoint and renders an iframe

oEmbed endpoint:
```
GET https://three.ws/api/widgets/oembed?url=<widget-url>
```

### 7. Method 4: Claude Artifact
three.ws can be embedded inside Claude.ai artifacts — useful for AI-generated interactive demos.

The artifact bundle is a zero-dependency, self-contained file:
```html
<!-- In a Claude artifact -->
<script src="https://cdn.three.wsartifact.js"></script>
<agent-3d model="./avatar.glb"></agent-3d>
```

See `/src/artifact/` and `/specs/CLAUDE_ARTIFACT.md` for the artifact-specific API.

### 8. Embedding in popular frameworks

**React:**
```jsx
import { useEffect, useRef } from 'react';

export function AgentEmbed({ agentId }) {
  const ref = useRef();

  useEffect(() => {
    // Listen for events
    const el = ref.current;
    const handler = e => console.log('Agent spoke:', e.detail.text);
    el.addEventListener('agent-speak', handler);
    return () => el.removeEventListener('agent-speak', handler);
  }, []);

  return (
    <agent-3d
      ref={ref}
      agent-id={agentId}
      style={{ width: '400px', height: '500px', display: 'block' }}
    />
  );
}
```

**Next.js** (avoid SSR for the element):
```jsx
// Use dynamic import with ssr: false
import dynamic from 'next/dynamic';
const AgentEmbed = dynamic(() => import('./AgentEmbed'), { ssr: false });
```

**Webflow:**
In Webflow, use an Embed block with the iframe method. Custom code blocks can load the web component script.

**Squarespace:**
Use a Code block with the iframe HTML.

**Framer:**
Framer supports custom code components — use the web component approach.

**Shopify:**
Add the script tag to `theme.liquid`, then use `<agent-3d>` in product templates.

### 9. Sizing and layout
The element respects CSS sizing:

```css
/* Fixed size */
agent-3d { width: 400px; height: 500px; }

/* Full width, fixed height */
agent-3d { width: 100%; height: 60vh; }

/* Aspect ratio (use with padding trick) */
.agent-wrapper { position: relative; padding-top: 125%; /* 4:5 */ }
agent-3d { position: absolute; inset: 0; width: 100%; height: 100%; }
```

The canvas always fills the element. There are no intrinsic dimensions — set them explicitly.

### 10. Performance tips for embedded agents
- Use the iframe method for sites with many embeds (each iframe has its own GL context — watch memory on mobile)
- Web component shares the page's GL context limit — most browsers allow 8-16 contexts total
- Use `kiosk` attribute on static display embeds (no controls = faster initial render)
- For model-only embeds (no agent), omit `brain` attribute — no LLM client loads
- Enable `auto-rotate` only for turntable-style displays — it runs a continuous animation loop

### 11. Accessibility
- Add `title` to iframe embeds
- The 3D canvas is not screen-reader accessible by default — add `aria-label` describing the content
- Keyboard users can't navigate the 3D scene — provide fallback content for accessibility-sensitive contexts
- Respect `prefers-reduced-motion`: set `auto-rotate="false"` when the media query fires

```js
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelector('agent-3d').setAttribute('auto-rotate', !prefersReduced);
```

### 12. Embed analytics
The platform tracks embed impressions and interactions (widget views, chat starts, screenshots) via `/api/widgets/view`. No PII is collected. Opt out by self-hosting.

## Tone
Practical guide. Lots of code snippets. Tables for comparison. Cover all the weird cases (Next.js SSR, Webflow, iframe sandbox). Developers will follow this step by step.

## Files to read for accuracy
- `/src/element.js` — web component implementation
- `/specs/EMBED_SPEC.md`
- `/specs/EMBED_HOST_PROTOCOL.md`
- `/embed.html` — embed entry HTML
- `/agent-embed.html`
- `/a-embed.html`
- `/examples/minimal.html`
- `/examples/two-agents.html`
- `/api/widgets/view.js`
- `/api/widgets/oembed.js`
- `/src/artifact/entry.js`
- `/specs/CLAUDE_ARTIFACT.md`
