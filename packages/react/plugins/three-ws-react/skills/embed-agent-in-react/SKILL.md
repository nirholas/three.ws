---
name: embed-agent-in-react
description: Embed a three.ws 3D agent in a React app with the @three-ws/react Agent3D component and drive it through its ref. Use when a React or Next.js page should show or control a three.ws avatar.
---

# Embedding agents with @three-ws/react

`Agent3D` renders the three.ws walk embed in an iframe and exposes an imperative handle for live control. `WalkEmbed` is an alias.

## Install

```
npm install @three-ws/react
```

Peer dependencies: `react` and `react-dom` 17 or newer. Node 20 or newer to build.

## Props

Required: `agentId` (the three.ws agent id). Optional: `avatarId`, `controls` (`joystick` | `keyboard` | `none`, default `joystick`), `background` (`transparent` or a hex like `#1b1b1b`), `environment` (for example `studio`), `autoplay`, `ground` (default true), `orbit` (default true), `speed` (0.3 to 3), `width` (default `100%`), `height` (default `600px`), `baseUrl` (self-host, default `https://three.ws`), `onLoad()`, `onError(err)`, `className`, `style`, `title`.

## Ref handle (`Agent3DHandle`)

`setAvatar(id)`, `setMotion('idle' | 'walk' | 'run')`, `setEnvironment(env)`, `setSpeed(n)`, `narrate(text)` (speech bubble), `resetPose()`, `sendMessage(msg)`, and the read-only `iframe`.

## Example

```jsx
import { useRef } from 'react';
import { Agent3D } from '@three-ws/react';

export function Hero({ agentId }) {
  const ref = useRef(null);
  return (
    <Agent3D
      ref={ref}
      agentId={agentId}
      controls="keyboard"
      background="transparent"
      height={480}
      onLoad={() => ref.current?.narrate('Hello, I am live.')}
      onError={(err) => console.error(err)}
    />
  );
}
```

## Notes

- The component is client-side. In Next.js, mark the file `'use client'`.
- Wait for `onLoad` before calling handle methods that expect a ready scene.
- The agent id comes from a three.ws agent page. To create an agent, use the three.ws site or its own tooling, this package only embeds.
