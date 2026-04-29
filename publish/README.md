# three.ws

3D AI agent platform for the browser. Load any GLB/glTF avatar, give it an LLM brain with memory, emotions, and tool use, then embed it anywhere as a web component.

- Repo: https://github.com/nirholas/three.ws
- License: Apache-2.0

## Install

```bash
npm install three.ws
```

## Use as an ES module

```js
import 'three.ws';

// Use the web component anywhere in your HTML:
// <agent-3d src="/path/to/avatar.glb"></agent-3d>
```

## Use via CDN

```html
<script type="module" src="https://unpkg.com/three.ws"></script>
<agent-3d src="/path/to/avatar.glb"></agent-3d>
```

Or the UMD build:

```html
<script src="https://unpkg.com/three.ws/agent-3d.umd.cjs"></script>
```

See the repo for full documentation, the character studio, and the embeddable widget gallery.
