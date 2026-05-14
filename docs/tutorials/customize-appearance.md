# Customize size, position & background

A default embed lands in the bottom-right corner at a fixed size, with a transparent background, and a gentle idle rotation. That's a sensible starting point — it works on every site without tuning. But it is not what you want long-term. You want an agent that feels designed for your page: anchored where it belongs, sized for the layout, blended into the background, rotating at exactly the pace that suits your brand.

This tutorial walks through every `data-*` attribute the three.ws embed loader honours. It covers them one at a time, with real snippets you can copy. By the end you have an agent that looks like it shipped with your site, not like a widget bolted on after the fact.

**What you'll build:**
- A floating agent sized and positioned precisely where you want it
- A background that matches your site (transparent, branded, or a fixed colour)
- A rotation speed tuned to the mood of your page
- A pixel-perfect, brand-aligned embed snippet for any site stack
- A clear map of which attributes do what

**Prerequisites:** A page with the embed working from [Embed in 30 seconds](/tutorials/embed-in-30-seconds). You can write the attributes here straight into that page.

---

## Step 1 — How the loader reads your attributes

Every customisation in this tutorial is set as a `data-*` attribute on the embed script tag itself, not on a separate config object. The loader reads those attributes once, when the script first runs.

The general shape is always the same:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-size="large"
  data-position="bottom-left"
  data-background-color="transparent"
  data-rotation-speed="0.5"
></script>
```

Order doesn't matter. Capitalisation does: every attribute is lowercase, hyphenated. Spelling matters too — an unknown attribute is silently ignored, so you'll see no error if you typo one, just the default behaviour.

There is one tricky thing worth knowing up front: because attributes are read once at script load, changing them later via DOM manipulation does not re-render the agent. If you need to update appearance dynamically, the right tool is the JS API on the script element, which is covered briefly at the end of this tutorial.

---

## Step 2 — `data-size`: how big the widget appears

The simplest attribute, and the one most people want to change first. `data-size` accepts either a named preset or a CSS-style pixel value.

### Named presets

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-size="medium"
></script>
```

The available presets are:

- `small` — a compact 160 × 240 widget; good for unobtrusive helper bots on busy pages
- `medium` — the default, 220 × 320; a comfortable size for most content sites
- `large` — 320 × 460; gives the avatar more presence on a marketing page
- `xlarge` — 420 × 600; suitable when the agent *is* the hero element

If you have not set this attribute, `medium` is what you get.

### Explicit pixel value

If a preset doesn't fit your layout, set the width directly:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-size="280px"
></script>
```

The widget keeps the same aspect ratio (roughly 2:3 portrait), so you only need to set width. The height scales automatically.

You can also use percentages for inline embeds (covered in the next section). `data-size="60%"` means the widget takes 60% of its container width.

### What the size affects

Setting `data-size` changes three things at once: the container's CSS width, the canvas resolution, and the avatar's framing within that canvas. The avatar is always centred and proportioned so its head sits roughly one-third from the top. This means a smaller size doesn't crop the face — it just zooms out a little so the full body remains visible.

If you want to see how the size feels on a real layout before committing, drop the snippet into your page, refresh, and try `small`, `medium`, and `large` in sequence. Sizes look different on different content; trust the page, not the theory.

---

## Step 3 — `data-position`: where the widget anchors

There are four corner anchors plus one inline mode.

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-position="bottom-right"
></script>
```

The five accepted values:

- `bottom-right` — the default; floats above your page in the lower-right corner
- `bottom-left` — same behaviour, mirrored to the lower-left
- `top-right` — anchored to the upper-right
- `top-left` — anchored to the upper-left
- `inline` — the widget is *not* fixed; it flows with the rest of the page

### When to use each corner

The corners are all "floating" positions. The agent uses `position: fixed`, so it stays in the same place on screen as the visitor scrolls. The container has a small margin from the viewport edge and a soft drop shadow so it reads as a distinct element layered over your content.

- **Bottom-right** is the conventional support-widget position. Visitors expect to find help there. Use it when the agent is supplementary.
- **Bottom-left** works well when you have something else important on the right (a cookie banner, a chat tool, a sticky CTA).
- **Top-right** suits agents that introduce themselves immediately — they're hard to miss above the fold, and they don't compete with your hero CTA at the bottom.
- **Top-left** is rare but useful for documentation sites where the right margin is reserved for a table of contents.

### Inline mode

`data-position="inline"` is different. The widget is no longer floating; it sits where the script tag is rendered, in the natural document flow:

```html
<h1>About Us</h1>
<p>Meet our digital concierge.</p>

<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-position="inline"
  data-size="400px"
></script>

<p>Below, you'll find our services...</p>
```

In this mode the widget is a block-level element in the page. It contributes to the normal scroll height, sits in its parent column, and inherits the parent's text alignment. Use inline mode when the agent is a section of a page rather than a global helper — for example, on a product detail page where the agent represents a single product, or on a team page where each member has their own embedded agent.

You can centre an inline embed by wrapping it in a centred container:

```html
<div style="text-align:center; padding: 40px 0;">
  <script
    src="https://three.ws/cdn/agent-3d.js"
    data-agent-id="YOUR_AGENT_ID"
    data-position="inline"
  ></script>
</div>
```

---

## Step 4 — `data-background-color`: the canvas behind the agent

By default, the canvas behind the avatar is transparent, which means your page background shows through. That works for most setups, but some looks better with a solid or semi-transparent backdrop.

### Transparent (default)

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-background-color="transparent"
></script>
```

You don't need to set this explicitly — it is the default — but writing it out makes the intent clear when other developers read your code.

### Solid hex

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-background-color="#0a0a14"
></script>
```

Use a solid colour when your page has busy content behind the widget — a hero image, a video, a complex pattern — and you want the avatar to stand out without compositing tricks.

Both the three-digit and six-digit hex forms work: `#000`, `#0a0a14`, `#ffffff`. Names like `black` and `white` also work, but stick to hex for consistency.

### Semi-transparent

Eight-digit hex codes include alpha:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-background-color="#0a0a14cc"
></script>
```

The last two hex digits are alpha: `cc` is roughly 80% opacity. Use this for a glassy panel effect — visible structure behind the agent, but enough opacity that the avatar reads cleanly.

### Picking a colour that works

A few practical notes from putting agents on real sites:

- Dark pages almost always look best with a transparent background — the avatar lighting matches the page mood naturally.
- Light pages can go either way. Transparent works if the avatar is contrasty; a solid pale colour (like `#f6f6f9`) reads as more intentional.
- If you're using a brand colour, desaturate it 20–30% for the embed background. Pure brand hues compete with the avatar; the same hue toned down recedes appropriately.
- Avoid pure black `#000000` and pure white `#ffffff`. They look harsh next to a 3D-shaded avatar. A near-black like `#08080c` or a near-white like `#fafafa` are easier on the eye.

---

## Step 5 — `data-rotation-speed`: the idle animation pace

Out of the box, the agent rotates slowly while idle. This is a polite "I am alive" signal — it tells visitors the page isn't frozen, and gives the avatar presence without demanding attention.

You can tune that rotation:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-rotation-speed="0.5"
></script>
```

The value is a multiplier on the default speed. Useful values:

- `0` — no idle rotation. The agent stands still until interacted with. Use this for serious or professional contexts where motion is a distraction.
- `0.3` — a subtle, slow turn. Reads as "calm and attentive".
- `1` — the default. A steady, easy rotation.
- `2` — twice as fast. The agent feels playful, energetic.
- `4` — fast spinning. Almost always too much; use only on playful or marketing pages where you want grabbed attention.

Anything above `4` is allowed but rarely a good idea — it competes with the rest of your page and triggers motion sensitivity for some visitors. If your site has a "reduce motion" toggle, consider setting `data-rotation-speed="0"` when the user has opted out of motion.

You can pair rotation speed with size and position to build a coherent feel:

- "Quiet helper" — `data-size="small"`, `data-position="bottom-right"`, `data-rotation-speed="0.3"`
- "Playful mascot" — `data-size="large"`, `data-position="bottom-left"`, `data-rotation-speed="2"`
- "Hero element" — `data-size="xlarge"`, `data-position="inline"`, `data-rotation-speed="0.5"`

---

## Step 6 — `data-greeting` and `data-name`: the small visible details

Two more attributes worth covering here because they're frequently used alongside the visual ones, even though their effects are textual rather than purely visual.

### `data-name`

Overrides the name shown in the agent's nameplate label.

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-name="Iris"
></script>
```

Useful when one underlying agent serves multiple sites and you want the visible label to differ. For example, the same agent might appear as "Iris" on your customer-facing site and "Internal Helper" on a private team page.

### `data-greeting`

Sets the first thing the agent says aloud after it's ready.

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-greeting="Welcome to our site. Click me to ask anything."
></script>
```

The greeting is spoken with the agent's configured TTS voice and shown as a speech bubble. We cover this attribute in much more depth — including how to handle browser autoplay restrictions and how to subtitle the greeting for accessibility — in the dedicated tutorial: [Add a greeting and first speech line](/tutorials/greeting-and-first-speech).

---

## Step 7 — Putting it all together: a branded SaaS embed

To bring this from theory to a real example, here is a complete, branded embed for a hypothetical productivity SaaS called "Lumen". The brand colours are a dark indigo and a warm cream; the brand voice is calm and professional.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lumen — modern project tools</title>
  <style>
    body {
      margin: 0;
      font-family: 'Inter', system-ui, sans-serif;
      background: #fafaf6;
      color: #1a1a2e;
    }
    .hero {
      max-width: 720px;
      margin: 120px auto;
      padding: 0 24px;
    }
    h1 { font-size: 3rem; line-height: 1.1; margin: 0 0 16px; color: #1a1a2e; }
    p  { font-size: 1.15rem; line-height: 1.6; color: #444; max-width: 540px; }
    .cta {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 28px;
      background: #2a2a4d;
      color: #fafaf6;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <main class="hero">
    <h1>Project tools that get out of the way.</h1>
    <p>
      Lumen helps modern teams ship faster without the meeting churn. Plan,
      track, and deliver from one calm interface.
    </p>
    <a class="cta" href="/signup">Try Lumen free</a>
  </main>

  <script
    src="https://three.ws/cdn/agent-3d.js"
    data-agent-id="YOUR_AGENT_ID"
    data-name="Lumi"
    data-size="medium"
    data-position="bottom-right"
    data-background-color="#1a1a2e0d"
    data-rotation-speed="0.4"
    data-greeting="Hi, I'm Lumi. Click me if you have a question about Lumen."
  ></script>
</body>
</html>
```

The agent here is named to fit the brand ("Lumi" — short, soft, matches "Lumen"). The position is the conventional bottom-right where SaaS visitors expect to find help. The size is `medium` — present but not dominating the hero. The background is a very pale indigo with `0d` alpha (about 5% opacity), which gives the widget a barely-perceptible tinted panel against the cream page; this reads as polished without being a literal coloured box. The rotation is slowed to `0.4` to match the calm brand voice. The greeting is one sentence that explains who Lumi is and invites action.

Compare this to a more playful brand. Imagine a children's learning app, "Sparrow", with bright colours and a cheerful tone:

```html
<script
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
  data-name="Pip"
  data-size="large"
  data-position="bottom-left"
  data-background-color="transparent"
  data-rotation-speed="1.6"
  data-greeting="Hi! I'm Pip. Wanna play a learning game?"
></script>
```

Same attribute set, completely different feel. The point is that the four visual attributes — size, position, background, rotation — combine to express your brand without you writing a single line of CSS or JavaScript.

---

## Step 8 — Programmatic updates after load

A note for engineers: the script element itself exposes a small JS API for cases where you need to interact with the agent after it has loaded. The customisation attributes above are read once, but you can still trigger animations and speech dynamically.

```html
<script
  id="agent-script"
  src="https://three.ws/cdn/agent-3d.js"
  data-agent-id="YOUR_AGENT_ID"
></script>

<script>
  const agentScript = document.getElementById('agent-script');

  agentScript.addEventListener('agent:ready', () => {
    // The agent is fully loaded and visible
    agentScript.playAnimationByHint('wave');
  });

  // Trigger speech from a button somewhere on the page
  document.querySelector('#help-button').addEventListener('click', () => {
    agentScript.speak('Sure, let me help you with that.');
  });

  // Play a specific named animation by exact match
  document.querySelector('#celebrate-button').addEventListener('click', () => {
    agentScript.playAnimation('jump_celebrate');
  });
</script>
```

The methods on the script element are:

- `playAnimation(name)` — plays an animation clip by exact name. The clip names depend on which avatar is paired; you can list them in the editor.
- `playAnimationByHint(hint)` — fuzzy-matches a partial name. Useful when you don't know the exact clip but you know the intent: `'wave'`, `'talk'`, `'yes'`, `'no'`, `'point'`, `'idle'`.
- `speak(text)` — makes the agent say the given text using its TTS voice.

These are independent of the appearance attributes. You can mix them freely — set size and position declaratively, then drive animations and speech from your page's event flow.

---

## What you learned

You now know the full set of visual customisation attributes the embed loader honours:

- `data-size` controls dimensions, with named presets and explicit pixel values
- `data-position` controls anchor: four corners plus inline mode
- `data-background-color` controls the canvas backdrop, transparent or any hex with optional alpha
- `data-rotation-speed` controls the idle animation pace
- `data-name` overrides the visible nameplate
- `data-greeting` sets the first spoken message
- The script element itself exposes `playAnimation`, `playAnimationByHint`, and `speak` for runtime control

Most production embeds use four or five of these together. The combination is what makes an agent feel like part of the page rather than a widget glued on.

---

## Next steps

- [Pick and swap an avatar in Studio](/tutorials/swap-avatar-in-studio) — change the agent's body without touching your snippet
- [Add a greeting and first speech line](/tutorials/greeting-and-first-speech) — go deeper on the spoken introduction, autoplay, and accessibility
- [Embed in 30 seconds](/tutorials/embed-in-30-seconds) — revisit the one-line embed if you skipped any setup
- [Share your agent](/tutorials/share-your-agent) — generate a public URL, QR code, and social previews
- [Embed on a website](/tutorials/embed-on-website) — the full embed reference including framework-specific guidance
- [Build your first agent](/tutorials/first-agent) — drop down a level into manifests and skills
