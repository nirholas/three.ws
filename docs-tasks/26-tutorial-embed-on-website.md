# Agent Task: Write Tutorial — "Embed a three.ws on Your Website"

## Output file
`public/docs/tutorials/embed-on-website.md`

## Target audience
Developers and no-code builders who have a website and want to add a three.ws to it. Multiple paths covered: code-based embedding and platform-generated snippets.

## Word count
1500–2000 words

## What this tutorial must cover

### Learning objectives
By the end, the reader will know how to:
- Add a three.ws to a static HTML page
- Add it to a React/Next.js app
- Add it to WordPress, Webflow, or Squarespace (no-code)
- Use the iframe widget (simplest path for non-developers)
- Control when/how the agent appears

### Path 1: Get your embed code (no-code)
The fastest path — no coding required:
1. Go to https://three.ws/studio
2. Select an agent or create a new one
3. Pick a widget type (Talking Agent is most popular)
4. Click "Get Embed Code"
5. Copy the iframe snippet or web component snippet

Show both snippets side by side with explanation:
- **iframe** — works everywhere, more secure sandboxing, slightly slower to load
- **web component** — faster, more control, requires script tag on page

### Path 2: Plain HTML
Complete working example for a static site:
```html
<!-- Add to your <head> -->
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>

<!-- Add where you want the agent to appear -->
<agent-3d
  agent-id="your-agent-id"
  mode="floating"
></agent-3d>
```

The `mode="floating"` makes the agent appear as a floating bubble (bottom-right corner) — good for customer support style placement.

Explain each placement style:
- `mode="inline"` — embedded in page flow, takes up space
- `mode="floating"` — fixed position overlay, always visible
- `mode="section"` — full-width marketing section

### Path 3: React / Next.js
```jsx
// 1. Install the package
// npm install @3dagent/sdk

// 2. Create a component
// components/Agent3D.jsx
'use client'; // Next.js app router
import { useEffect, useRef } from 'react';
import '@3dagent/sdk'; // registers <agent-3d>

export default function Agent3D({ agentId, mode = 'floating' }) {
  const ref = useRef();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleSpeak = (e) => {
      console.log('Agent said:', e.detail.text);
    };
    el.addEventListener('agent-speak', handleSpeak);
    return () => el.removeEventListener('agent-speak', handleSpeak);
  }, []);

  return (
    <agent-3d
      ref={ref}
      agent-id={agentId}
      mode={mode}
      style={{ width: '400px', height: '500px', display: 'block' }}
    />
  );
}

// 3. Use it
import Agent3D from '@/components/Agent3D';
export default function Page() {
  return (
    <main>
      <h1>Welcome</h1>
      <Agentthree.wsId="your-agent-id" mode="floating" />
    </main>
  );
}
```

Next.js-specific note: The `<agent-3d>` element uses browser APIs — it must be a client component (`'use client'`) or dynamically imported with `ssr: false`.

### Path 4: Webflow
Webflow supports custom HTML via Embed blocks:
1. In Webflow designer, add an "Embed" block where you want the agent
2. Paste the iframe embed code OR the web component code
3. For the web component, also add a Code Embed in the `<head>` section with the `<script>` tag
4. Preview → agent should appear

For the floating mode (appears site-wide):
1. In Webflow project settings → Custom Code → Head Code
2. Paste: `<script type="module" src="https://cdn.three.wsagent-3d.js"></script>`
3. In Body Code (before `</body>`): paste the `<agent-3d mode="floating" agent-id="...">` tag
4. Publish → agent appears on all pages

### Path 5: WordPress
**With a plugin (easiest):**
1. Install "Insert Headers and Footers" plugin
2. In Settings → Insert Headers and Footers → Scripts in Header:
   Add the `<script>` tag
3. Edit the page/post where you want the agent
4. Switch to "Code editor" (HTML block)
5. Paste the `<agent-3d>` element

**With a child theme (advanced):**
Add to `functions.php`:
```php
function add_3dagent_script() {
    echo '<script type="module" src="https://cdn.three.wsagent-3d.js"></script>';
}
add_action('wp_head', 'add_3dagent_script');
```

Then use a Custom HTML block in the editor with the `<agent-3d>` element.

### Path 6: Squarespace
1. Go to Pages → Edit → Add Block → Code
2. Paste the complete snippet (script + element together):
```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-three.ws-id="your-id" style="width:100%;height:500px"></agent-3d>
```

For floating mode across all pages: Settings → Advanced → Code Injection → Footer, paste:
```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-three.ws-id="your-id" mode="floating"></agent-3d>
```

### Controlling when the agent appears
Show/hide based on scroll position:
```js
const agent = document.querySelector('agent-3d');
// Show agent after user scrolls past fold
window.addEventListener('scroll', () => {
  agent.style.display = window.scrollY > 500 ? 'block' : 'none';
});
```

Show agent only on certain pages:
```js
// Only show on /contact page
if (window.location.pathname === '/contact') {
  document.getElementById('agent-container').style.display = 'block';
}
```

Trigger agent greeting when user stays on page for 30 seconds:
```js
setTimeout(() => {
  document.querySelector('agent-3d').sendMessage('__auto-greet');
}, 30000);
```

### Customizing the appearance
CSS can style the container but not internals (shadow DOM boundary):
```css
agent-3d {
  border-radius: 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  /* Width and height control the canvas size */
  width: 400px;
  height: 600px;
}

/* Position the floating agent */
agent-3d[mode="floating"] {
  bottom: 24px;
  right: 24px;
}
```

### Troubleshooting common issues
- Agent doesn't appear → check console for 404 on agent-3d.js
- Agent appears blank → check that model URL is accessible (CORS)
- Floating agent hidden behind other elements → add `z-index: 9999` to parent
- Agent too small → set explicit `width` and `height`
- Next.js hydration error → add `'use client'` to the component

## Tone
Practical and encouraging. Cover the paths readers actually need. The no-code paths (Webflow, WordPress) should require zero JavaScript knowledge. Troubleshooting at the end for every path.

## Files to read for accuracy
- `/src/element.js` — mode options and behavior
- `/specs/EMBED_SPEC.md`
- `/examples/minimal.html`
- `/examples/web-component.html`
- `/embed.html` — iframe entry
