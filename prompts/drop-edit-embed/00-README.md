# Drop-Edit-Embed — task stack

User flow this band ships:

```
[ user visits 3dagent.vercel.app ]
         │
         ▼
[ drops a .glb / .gltf ] ──── or ────► [ #model=<url> deep link ]
         │
         ▼
[ viewer loads — Editor auto-attaches ]
         │  tweaks materials, textures,
         │  toggles visibility, moves nodes
         ▼
[ clicks "📤 Publish as embed" ]
         │
         ▼
[ Publish modal ]
   ├── upload edited GLB to R2          (avatars/presign → PUT → /api/avatars)
   ├── mint a widget of type=turntable  (POST /api/widgets, is_public=true)
   └── show 3 snippets + copy buttons
         │
         ▼
[ user pastes into: ]
   ├── any HTML page  → iframe src="/w/<id>"  or  <agent-3d src="...">
   ├── Slack / Discord / X / iMessage → OG + Twitter card unfurl
   ├── WordPress / Ghost / Notion → oEmbed auto-expand
   └── SperaxOS chat → iframe if it allows HTML, link preview otherwise
```

## Why a new band

Most pieces already exist in the codebase:

- Viewer + drag-drop: `src/app.js`, `src/viewer.js`
- Editor (materials, textures, scene graph, GLB export): `src/editor/*`
- Upload: `api/avatars/presign.js` + `api/avatars/index.js` (R2 + `avatars` table)
- Widget CRUD: `api/widgets/index.js`, `api/widgets/[id].js`
- Widget page: `/w/<id>` via `api/widgets/page.js` + `api/widgets/view.js`
- Unfurl: `api/widgets/og.js` (Open Graph image), `api/widgets/oembed.js` (oEmbed)
- `<agent-3d>` web component: `src/element.js`, `dist-lib/agent-3d.js`
- Widget Studio: `public/studio/` (3-column picker)

The gap is the **hand-off** — today a user who drops+edits a GLB in the viewer has no one-click path from "I just edited this" to "here is a shareable link." They have to download, go to Studio, upload, generate. This stack closes that seam.

## Dispatch order

Run 01 → 02 → 03 → 04 first; those ship the happy path. 05 → 06 harden it. 07 → 08 verify.

| Prompt | Ships | Can parallel with |
|---|---|---|
| [01-editor-on-dropped-glb.md](./01-editor-on-dropped-glb.md) | Editor reliably attaches for drag-drop + `#model=` loads | — |
| [02-publish-client.md](./02-publish-client.md) | `src/editor/publish.js` — one function that uploads + mints widget | 01 |
| [03-publish-button-and-modal.md](./03-publish-button-and-modal.md) | "📤 Publish as embed" button in editor + share modal with 3 snippets | depends on 02 |
| [04-publish-auth-gate.md](./04-publish-auth-gate.md) | Signed-out users get sent to `/login?next=...` with their edits preserved | depends on 03 |
| [05-republish-existing.md](./05-republish-existing.md) | Loaded-from-a-widget re-edit → Update vs Create new | depends on 03 |
| [06-size-and-cors-guards.md](./06-size-and-cors-guards.md) | Block >25 MB, catch CORS-blocked remote GLBs with a useful error | depends on 02 |
| [07-widget-metadata.md](./07-widget-metadata.md) | Verify + polish OG card + oEmbed for `/w/<id>` | parallel with 01–06 |
| [08-smoke-test.md](./08-smoke-test.md) | E2E manual checklist — drop, edit, publish, paste in each surface | last |

## House rules for every prompt (inherits from `/CLAUDE.md`)

- One deliverable per prompt, one PR per prompt.
- No scope creep. If something outside the prompt needs fixing, note it in the reporting block — do not fix it.
- Cite exact file paths and line numbers. Don't invent APIs; read the existing code.
- Prefer editing existing files to creating new ones. New files only when the prompt names them.
- Run `node --check` on every modified JS, then `npm run verify` (prettier + vite build). Report both outputs.
- Respect `Files off-limits` in each prompt — parallel tasks may be editing them.
- If an unrelated bug shows up, note it in the reporting block. Don't fix it in the same PR.
- Never `forge script --broadcast`. On-chain is immutable.

## Reporting block (required at the end of every task)

```
### Files changed
- path/to/file.js (section X)
- path/to/new.js (created)

### Commands run
- node --check … → output
- npm run verify → output

### Manual verification
- <what you browser-tested, with exact URL + action>

### Skipped / deferred
- <anything deliberately not done>

### Unrelated bugs noticed
- <do not fix — just note>
```
