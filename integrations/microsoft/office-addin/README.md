# three.ws 3D Models: a PowerPoint add-in

A task pane add-in that puts interactive 3D models on slides. Sign in with a
three.ws account, pick one of your Forge models or describe a new one and
generate it free, and the add-in inserts a slide with the model as a real
PowerPoint 3D object the audience can rotate in a slideshow.

- Add-in name: `three.ws 3D Models` (id `76cf0c40-ecea-4e1e-9ff7-7f3efd1243d9`, version 1.0.0.0)
- Manifest: [`manifest.xml`](./manifest.xml), the XML add-in-only manifest (TaskPaneApp, host `Presentation`, requirement set PowerPointApi 1.2, permission `ReadWriteDocument`) with an Insert tab button through VersionOverrides 1.0
- Task pane: `https://three.ws/office/powerpoint`, built from [`pages/office-powerpoint.html`](../../../pages/office-powerpoint.html) and [`src/office-powerpoint/`](../../../src/office-powerpoint)
- Sign-in callback: `https://three.ws/office/powerpoint/auth` ([`pages/office-powerpoint-auth.html`](../../../pages/office-powerpoint-auth.html))
- Icons: `public/office/powerpoint/icon-{16,32,64,80,128}.png`, served at `https://three.ws/office/powerpoint/icon-*.png`
- Network: only `https://three.ws`, plus Office.js from `https://appsforoffice.microsoft.com`

## What the pane does

| Section | Behaviour |
|---|---|
| Account | Signed out: a Sign in button. Signed in: the account name from `/api/me` and Sign out (which revokes the refresh token). |
| Generate a model | A prompt box (Ctrl+Enter submits) that calls the free lane, `forge_free` on `/api/mcp-studio`, then polls `/api/gpt-forge?job=` with a real progress bar. Works signed out. Rate limits are shown with the wait time. |
| Just generated | The last 6 generated models (kept in this browser), each with Insert slide and a link to the 3D viewer. |
| Your models | `GET /api/forge/mine`, 12 at a time with Load more, with skeleton, empty, error and signed-out states. Private models link to their model page to be made unlisted, because only public and unlisted models export. |

Insert fetches the deck from `GET /api/forge/export-pptx` (`?id=` for a stored
model, `?src=&title=` for a just-generated one) and calls
`PowerPoint.run(ctx => ctx.presentation.insertSlidesFromBase64(base64, { formatting: 'KeepSourceFormatting', targetSlideId }))`.
`targetSlideId` (after the selected slide) is passed when PowerPointApi 1.5 is
available. Opened in a plain browser tab, the pane says it is outside
PowerPoint and downloads the `.pptx` instead.

How the deck itself is built (the Office-safe GLB pass, the `am3d:model3d`
slide, the limits Office imposes): [docs/powerpoint.md](../../../docs/powerpoint.md).

## Sign-in

The pane is an OAuth 2.1 public client of the three.ws authorization server,
the same one MCP clients use:

1. Discovery from `/.well-known/oauth-authorization-server` and
   `/.well-known/oauth-protected-resource`; endpoints are rebased onto the
   pane's own origin.
2. Dynamic client registration at `/api/oauth/register` as
   "three.ws for PowerPoint" (`token_endpoint_auth_method: none`), stored in
   `localStorage`.
3. Authorization code with PKCE S256, scopes `profile offline_access avatars:read`,
   redirect `https://three.ws/office/powerpoint/auth`.
4. Inside PowerPoint the authorize page opens in an Office dialog
   (`Office.context.ui.displayDialogAsync`), because it sends
   `frame-ancestors 'none'`. The callback page posts its URL back with
   `messageParent`, and the pane checks `state` and swaps the code. In a plain
   tab the whole page redirects instead.
5. Access tokens refresh 90 seconds before expiry; refresh tokens rotate.

The pure parts (PKCE, the authorize URL, reading the callback, base64 in
chunks, reading free-lane results) live in `src/office-powerpoint/core.js` and
are covered by `tests/office-powerpoint-core.test.js`.

## Framing

`vercel.json` serves `/office/powerpoint` with a CSP whose `frame-ancestors`
allows `'self'` and the Office hosts only: `*.officeapps.live.com`,
`*.office.com`, `*.office365.com`, `*.microsoft365.com`, `*.cloud.microsoft`,
`*.sharepoint.com`, `*.officeapps.microsoft.com`. `script-src` adds
`https://appsforoffice.microsoft.com` for Office.js.

## Validate

```bash
cd integrations/microsoft/office-addin
npx office-addin-manifest validate manifest.xml
```

Expected: `The manifest is valid.`

## Sideload

- **PowerPoint for the web:** Home > Add-ins > More Add-ins > My Add-ins >
  Upload My Add-in, then choose `manifest.xml`.
- **Windows:** share a folder holding `manifest.xml`, add it under File >
  Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs
  with "Show in Menu" ticked, restart PowerPoint, then Home > Add-ins >
  More Add-ins > Shared Folder.
- **Mac:** copy `manifest.xml` to
  `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef` and
  restart PowerPoint.

Then Insert > **three.ws 3D Models**.

## Test against a dev server

```bash
DEV_API_PROXY=http://localhost:<api port> npx vite --port 3102 --strictPort
node --env-file=.env scripts/verify-office-powerpoint-pane.mjs <glb-url> http://localhost:3102
```

The verifier drives the pane outside Office: the signed-out state, a deck
download from Just generated, then (with `AUDIT_EMAIL` and `AUDIT_PASSWORD`
set) the real sign-in, Your models and sign-out.

## Store listing

AppSource submission notes, owner-run and pending review:
[`microsoft-powerpoint-addin.md`](../../../marketing/growth/submissions/programs/microsoft-powerpoint-addin.md).
