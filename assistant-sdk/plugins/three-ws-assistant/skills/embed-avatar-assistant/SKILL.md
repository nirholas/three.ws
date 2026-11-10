---
name: embed-avatar-assistant
description: Add the three.ws 3D avatar assistant widget (floating launcher, chat mode, speak mode) to any website with one script tag or the @three-ws/assistant npm package, then drive it from page code. Use when a user wants an animated avatar chatbot or a talking avatar on a site.
---

# Embed the three.ws avatar assistant

The widget is a small host-side loader. The avatar, chat and speech run in an iframe hosted on three.ws (`/assistant-frame`), so the page never sees model keys. Chat uses the platform's free model chain by default (visitors can switch to their own Groq or OpenRouter key); speak mode uses browser text-to-speech with no model.

## Install

One tag, no build:

```html
<script src="https://three.ws/assistant/v1.js" async
  data-avatar="/avatars/selfie-girl.glb"
  data-name="Atelier AI"
  data-greeting="Ask anything about Atelier."
  data-context="Atelier is a design studio for 3D artists."
  data-bg="transparent"
  data-accent="#f97316"></script>
```

Or npm:

```bash
npm install @three-ws/assistant
```

```js
import ThreeAssistant from '@three-ws/assistant';
ThreeAssistant.init({ avatar: '/avatars/selfie-girl.glb', name: 'Atelier AI', mode: 'both' });
```

## Options (config key or `data-*` attribute)

- `avatar`: an avatar id, `/avatars/*.glb`, or a GLB, GLTF or VRM URL on an allow-listed host (three.ws, R2, Ready Player Me). `agent`: a three.ws agent id whose avatar is used instead.
- `mode`: `chat`, `speak` or `both` (default). `name` (60 chars), `greeting` (200), `context` (500, what the chatbot should know about the site).
- `bg`: `transparent` (default), a `#hex`, a preset (`ember`, `ocean`, `violet`, `forest`, `dusk`, `slate`) or `gradient:#a,#b,angle`. `accent`: `#hex`. `position`: `right` or `left`.
- `voice="false"` starts muted, `badge="false"` hides the attribution badge, `open` starts open, `origin` overrides the frame host (config key only), `data-manual` stops auto-mount on the one-tag build.

Invalid values fall back to a safe default inside the frame.

## Page API

```js
ThreeAssistant.init(config);          // replaces any existing instance
ThreeAssistant.open(); ThreeAssistant.close(); ThreeAssistant.toggle();
ThreeAssistant.say('Welcome to the sale!');   // opens and speaks the line
ThreeAssistant.setMode('speak');      // only when mounted with mode 'both'
ThreeAssistant.destroy();
```

Named exports: `init`, `say`, `createAssistant({ origin })`, `VERSION`. Events fire on `window` as `three-assistant` with `detail.type` of `ready`, `open`, `close`, `message`, `speak:start`, `speak:end` or `error`.

## Worked example

```js
window.addEventListener('three-assistant', (e) => {
  if (e.detail.type === 'message') console.log(e.detail.payload.role, e.detail.payload.content);
});
ThreeAssistant.init({ avatar: '/avatars/selfie-girl.glb', name: 'Shop Guide', context: 'We sell ceramic mugs.' });
document.querySelector('#sale').addEventListener('click', () => ThreeAssistant.say('Mugs are 20 percent off today.'));
```

Keep `context` to public site facts; it is sent to the chat model.
