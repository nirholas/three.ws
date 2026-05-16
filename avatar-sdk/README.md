# @three-ws/avatar

The official three.ws SDK for 3D avatars on the web. Drop-in replacement for the Ready Player Me SDK now that RPM was acquired and is no longer accepting new accounts.

What ships in this package:

- **`<agent-3d>` web component** — declarative avatar viewer with built-in chat / voice loop, emotion morphs, audio-driven viseme lipsync, AR Quick Look (iOS) and WebXR (Android / Quest).
- **`AvatarCreator`** — programmatic iframe modal that opens three.ws's avatar pipelines (in-browser builder + photo-to-avatar). Resolves with a GLB Blob.
- **`saveBlob()`** — uploads a freshly-created GLB to the hosted three.ws backend (R2 storage, auto-thumbnail, USDZ companion auto-generation, half-body variant for VR).

## Install

```bash
npm install @three-ws/avatar three
```

`three` is a peer dependency.

## Use the web component

```html
<script type="module">
  import '@three-ws/avatar';
</script>

<agent-3d avatar-id="00000000-1111-2222-3333-444444444444"></agent-3d>
```

Or with a direct GLB URL:

```html
<agent-3d src="https://example.com/my-avatar.glb"></agent-3d>
```

## Open the avatar creator

```js
import { AvatarCreator, saveBlob } from '@three-ws/avatar/creator';

const creator = new AvatarCreator({
  onExport: async (glbBlob) => {
    const avatar = await saveBlob(glbBlob, {
      bearerToken: 'YOUR_THREE_WS_TOKEN',
      name: 'My Avatar',
      visibility: 'public',
    });
    console.log('Saved:', avatar.url);
  },
});

creator.open();
```

To re-open a previously created avatar for editing, first call your backend's `/api/avatars/:id/session` (three.ws issues an edit-mode session URL) and pass it as `avaturnSessionUrl` to the constructor.

## What this gives you that Ready Player Me did

| RPM feature | three.ws equivalent |
|---|---|
| Photo → 3D avatar | three.ws Selfie pipeline |
| In-browser avatar editor | three.ws Studio at [studio.three.ws](https://studio.three.ws) |
| Hosted CDN | three.ws-managed R2 + presigned uploads (free public tier) |
| ARKit `viseme_*` morphs | Loaded automatically into the runtime |
| Mixamo-compatible humanoid rig | Yes — same skeleton naming conventions |
| Animation library | 50+ Mixamo clips bundled (idle, wave, nod, dance, …) |
| iOS Quick Look USDZ | Auto-generated on first upload — no external converter |
| Half-body variant | Auto-generated for VR seats; runtime collapse also supported |
| Web component embed | `<agent-3d>` |
| React component | `<agent-3d>` works in React 18+ via the JSX intrinsic |

## License

Apache-2.0. See `LICENSE` in the repo root.
