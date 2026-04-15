# Task 01 — `@3dagent/embed` host SDK package

## Why

Every host (LobeHub, Claude Artifact, a third-party chat) needs the same surface area:
```js
import { mountAgent } from '@3dagent/embed';
const handle = mountAgent(element, { agentId: 'agt_abc' });
handle.say('Hello');
handle.destroy();
```

A tiny, dependency-free package.

## Read first

- [src/element.js](../../src/element.js) — web component
- [src/lib.js](../../src/lib.js) — CDN library export surface
- [vite.lib.config.js](../../vite.lib.config.js) if it exists, or whatever `npm run build:lib` uses
- `dist-lib/` — current output

## Build this

### 1. Package layout

New directory `packages/embed/` (yes, we adopt a flat monorepo layout here):

```
packages/embed/
  package.json        // name: "@3dagent/embed", type: "module"
  src/
    index.js          // public API
    agent.js          // per-agent handle + postMessage bridge
    types.d.ts        // hand-written TS declaration
  README.md
  LICENSE             // MIT, matches repo
```

Root `package.json` stays the app's. Add `workspaces: ["packages/*"]` only if the existing tooling tolerates it — if not, skip workspaces; build the package standalone.

### 2. Public API

```ts
export interface AgentHandle {
	say(text: string): void;
	playClip(name: string): void;
	setExpression(name: string, weight: number): void;
	on(event: 'ready' | 'speak' | 'action' | 'error', cb: (e: any) => void): () => void;
	destroy(): void;
}

export interface MountOptions {
	agentId?:       string;
	agentAddress?:  string;
	agentName?:     string;
	src?:           string;          // manifest URL alternative
	origin?:        string;          // default 'https://3dagent.vercel.app'
	transparentBg?: boolean;
	kiosk?:         boolean;
	width?:         string;          // default '100%'
	height?:        string;          // default '100%'
}

export function mountAgent(target: HTMLElement, opts: MountOptions): AgentHandle;
```

### 3. Implementation

The package creates an iframe (`origin + '/agent/' + id + '/embed'`) inside `target` and bridges via `postMessage`. The bridge vocabulary already exists in [public/agent/embed.html](../../public/agent/embed.html) — reuse it verbatim.

Events (`event.data.type`):
- `ready` — iframe loaded, agent mounted
- `speak` — `{ text, sentiment }`
- `action` — `{ type, payload }`
- `error` — `{ message, code }`

Imperative methods post messages:
- `say(text)` → `{ type: 'say', text }`
- `playClip(name)` → `{ type: 'play-clip', name }`
- `setExpression(name, weight)` → `{ type: 'expression', name, weight }`

### 4. Security

Verify `event.origin === opts.origin` in every listener. Drop events from other origins silently.

### 5. Size budget

Whole package: **≤ 3 KB gzipped**. If you exceed, you've over-engineered.

### 6. Build + publish

- Script: `packages/embed/build.mjs` — esbuild ESM bundle, no minify is fine.
- Output: `packages/embed/dist/index.js`.
- Publish script in README: `cd packages/embed && npm publish --access public`.
- Don't publish in this task — just prep. User approves `npm publish` separately.

### 7. CDN bundle

Also produce an IIFE build at `packages/embed/dist/embed.iife.js` and host under `/dist-lib/embed.iife.js` (copy as part of the main `npm run build:all` step) so hosts without a bundler can do:

```html
<script src="https://3dagent.vercel.app/dist-lib/embed.iife.js"></script>
<script>
  window.Agent3D.mountAgent(document.getElementById('stage'), { agentAddress: '0xabc…' });
</script>
```

### 8. Demo file

`packages/embed/demo.html` — a static HTML page that imports the ESM build and mounts an agent. Good smoke test.

## Don't do this

- Do not take any runtime deps — zero.
- Do not use JSX / TSX. Plain JS + `.d.ts`.
- Do not require a build step for consumers. ESM import → works.
- Do not leak `window` globals beyond `Agent3D`.

## Acceptance

- [ ] `cd packages/embed && node build.mjs` produces both bundles.
- [ ] `packages/embed/demo.html` mounts an agent against prod (`3dagent.vercel.app`).
- [ ] Gzipped bundle < 3 KB.
- [ ] `.d.ts` types load in VSCode intellisense.
- [ ] `npm run build` at root still works.

## Reporting

- Gzipped size (bytes)
- Any API shape questions (decide + note, don't ask)
- The full `index.js` + `agent.js` content
- Demo screenshot
