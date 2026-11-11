# three.ws in PowerPoint

PowerPoint in Microsoft 365 plays interactive glTF 3D models. In a slideshow
the audience can drag a model to rotate it, Morph transitions animate between
camera angles, and animated models play. three.ws puts any Forge model on a
slide in one click:

- **PowerPoint export.** The Forge export menu, the Forge Studio export menu
  and the model page (`/m/:id`) each have a **PowerPoint** item. It downloads
  a one-slide `.pptx` with the prompt as the title and the model embedded as
  an interactive 3D object.
- **The PowerPoint add-in.** "three.ws 3D Models" opens a task pane from the
  Insert tab. Sign in with your three.ws account, pick one of your models (or
  describe a new one and generate it free), and the slide is inserted into the
  open presentation after the current slide.

## How it works

```
Forge model (GLB, meshopt + WebP)
  -> api/_lib/office-glb.js      Office-safe GLB pass
  -> api/_lib/pptx-writer.js     one-slide PresentationML deck
  -> GET /api/forge/export-pptx  streams the .pptx
       -> Forge / model page menu item: download
       -> add-in: PowerPoint.run(ctx => ctx.presentation.insertSlidesFromBase64(...))
```

### The endpoint

| Request | What it returns |
|---|---|
| `GET /api/forge/export-pptx?id=<creation id>` | The deck for a public or unlisted creation. Private creations are a 404, the same contract as `/api/forge-creation`. |
| `GET /api/forge/export-pptx?src=<GLB URL>&title=<title>` | The deck for a model the free lane just generated. `forge_free` returns a GLB URL and no creation id, so the add-in names the model by its URL. Only keys in the three.ws public bucket are accepted, and the bytes are always read from the bucket. |

The response is `application/vnd.openxmlformats-officedocument.presentationml.presentation`
with `content-disposition: attachment; filename="<slug>.pptx"`, a strong ETag
and a one-day CDN lifetime (a creation's deck never changes). Errors are JSON
with an `error` code and a `message` sentence the buttons show as-is.

### The Office-safe GLB pass

Office stores every 3D model as glTF 2.0 binary, but its reader is narrower
than the browsers three.ws targets. A three.ws delivery GLB is
meshopt-compressed with WebP textures, and PowerPoint refuses both. The pass
(`makeOfficeSafeGlb` in `api/_lib/office-glb.js`, built on glTF Transform):

| Office limit | What the pass does |
|---|---|
| No geometry compression | Decodes `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_mesh_quantization` and `EXT_mesh_gpu_instancing` back to plain float vertex data |
| PNG and JPEG textures only | Re-encodes KTX2 (`KHR_texture_basisu`, decoded server-side), WebP and AVIF: JPEG for opaque images, PNG when the image has alpha |
| 2048 px textures (Microsoft's mid-range target) | Caps the long edge at 2048 px, and halves further (down to 512 px) only if the file would pass 40 MB |
| 4 joint influences per vertex | Keeps the skeleton, keeps the 4 heaviest influences and renormalizes the weights to sum to 1 |
| Linear and cubic spline animation, 18 clips per file | Keeps animation; turns STEP samplers into equivalent LINEAR ones and drops clips past the 18th with a warning |
| Camera looks at the origin | Recentres the model on 0,0,0 under one new root node, as PowerPoint's own insert does |
| Unknown required extensions refuse the file | Marks any remaining extension not-required (glTF 2.0 section 3.12) |

Microsoft publishes no file-size ceiling for 3D models. 40 MB keeps a deck
emailable and quick to open in PowerPoint for the web.

### The slide

`buildPptx` in `api/_lib/pptx-writer.js` writes a minimal deck: one slide
master, one layout, one theme, and per slide a title, the model and a caption
linking back to the model page. The model is PowerPoint's own `am3d:model3d`
graphic frame (namespace `http://schemas.microsoft.com/office/drawing/2017/model3d`,
[MS-ODRAWXML 2.5.1](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/01138e0c-752b-46fa-bccc-f714ab944ef5)),
inside the `mc:AlternateContent` wrapper PowerPoint writes, with a `p:pic`
fallback that shows a poster PNG to any reader without 3D support
(LibreOffice, older Office, python-pptx, file previews).

Where the spec leaves a detail open, the writer follows a deck saved by
PowerPoint 16.0 itself, not an inference:

- The model part is `ppt/media/model3d1.glb` with content type
  `model/gltf.binary`, related by `http://schemas.microsoft.com/office/2017/06/relationships/model3d`.
- The poster and the fallback picture share one ordinary image relationship.
- The camera matches PowerPoint's insert: the model's largest extent is
  normalized to one metre (`meterPerModelUnit`), and the camera sits on +Z far
  enough back that the bounding sphere fills a 45 degree field of view.

The poster is rendered from the Office-safe model in its authored pose
(`packages/render`, no GPU). If rendering fails it falls back to the
creation's thumbnail, then to a titled card, so a render outage never costs
you the deck.

## What PowerPoint does not read

From Microsoft's [3D content guidelines](https://support.microsoft.com/en-us/office/3d-content-guidelines-for-microsoft-03a7b493-d549-4f1a-9735-f2457adf6261)
(the page redirects to the support home page in some regions; the limits
were read from its indexed text on 2026-11-11),
[Get creative with 3D models](https://support.microsoft.com/en-us/office/get-creative-with-3d-models-ebe7bf57-4b8b-4307-a2a5-2a6fb7c87e2b)
and [Insert animated 3D graphics](https://support.microsoft.com/en-us/powerpoint/insert-animated-3d-graphics):

- glTF compression extensions (Draco, meshopt) and texture containers other
  than PNG and JPEG are not supported. The pass removes them.
- Textures past 2048 px are not recommended for mid-range devices.
- At most 4 bone influences per vertex, and at most 18 animations per file.
  Animation samplers are linear or cubic spline.
- Interactive 3D needs PowerPoint for Microsoft 365 on Windows or Mac, or
  PowerPoint for the web. Older perpetual versions, LibreOffice and file
  previews show the poster.

## The add-in

Source: [`integrations/microsoft/office-addin/`](../integrations/microsoft/office-addin/README.md)
(manifest and icons), [`pages/office-powerpoint.html`](../pages/office-powerpoint.html)
and [`src/office-powerpoint/`](../src/office-powerpoint) (task pane).

| Feature | How |
|---|---|
| Sign in | The existing three.ws OAuth server (the one MCP clients use): dynamic client registration as "three.ws for PowerPoint", authorization code with PKCE (S256), scopes `profile offline_access avatars:read`. Inside PowerPoint the sign-in runs in an Office dialog (`displayDialogAsync`), because the authorize page refuses to be framed. Refresh tokens rotate; Sign out revokes the refresh token. |
| Your models | `GET /api/forge/mine` with the bearer token, 12 at a time with Load more. Private models are listed but say "make it unlisted to use it", linking to the model page, because the export serves public and unlisted models only. |
| Generate | The free lane (`forge_free` on `/api/mcp-studio`), polled at `/api/gpt-forge?job=` with a real progress bar. No account needed. Finished models appear under "Just generated". |
| Insert | Fetches the deck from `/api/forge/export-pptx` and calls `insertSlidesFromBase64` with `KeepSourceFormatting`, after the selected slide when PowerPointApi 1.5 is available. |
| Outside PowerPoint | Opened in a plain browser tab, the pane says so and downloads the deck instead of inserting it. |

The pane is served at `https://three.ws/office/powerpoint` with a CSP whose
`frame-ancestors` allows only three.ws and the Office hosts
(`*.officeapps.live.com`, `*.office.com`, `*.office365.com`,
`*.microsoft365.com`, `*.cloud.microsoft`, `*.sharepoint.com`,
`*.officeapps.microsoft.com`), set in `vercel.json`.

### Sideload it

1. Download [`manifest.xml`](../integrations/microsoft/office-addin/manifest.xml).
2. **PowerPoint for the web:** open a presentation, then Home > Add-ins >
   More Add-ins > My Add-ins > Upload My Add-in, and choose the file.
   **PowerPoint on Windows:** put the manifest in a shared network folder,
   add that folder under File > Options > Trust Center > Trust Center
   Settings > Trusted Add-in Catalogs (tick "Show in Menu"), restart
   PowerPoint, then Home > Add-ins > More Add-ins > Shared Folder.
   **PowerPoint on Mac:** copy the manifest to
   `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef`
   and restart PowerPoint.
3. Insert > **three.ws 3D Models** opens the task pane.

The AppSource listing is pending review; the submission notes are in
[`microsoft-powerpoint-addin.md`](../marketing/growth/submissions/programs/microsoft-powerpoint-addin.md).

## Check it

```bash
npx vitest run tests/office-glb.test.js tests/pptx-writer.test.js tests/forge-export-pptx.test.js \
  tests/forge-powerpoint.test.js tests/office-powerpoint-core.test.js
cd integrations/microsoft/office-addin && npx office-addin-manifest validate manifest.xml
# drives the task pane in a real browser against a dev server
node --env-file=.env scripts/verify-office-powerpoint-pane.mjs <glb-url> http://localhost:3102
```
