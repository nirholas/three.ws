# AppSource listing for a PowerPoint add-in: three.ws 3D Models

Program: Office add-ins on Microsoft AppSource, submitted through Partner Center as an "Office add-in" offer.
Order: 802 (microsoft 02). Shared facts and owner-only inputs: [README.md](./README.md).
Prepared: 2026-11-11. **Status: ready to submit after the production deploy. Nothing has been submitted.** Once submitted it is "pending review" until Microsoft publishes it.
Approved partnership wording only: "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace".

The add-in is a task pane served by `https://three.ws/office/powerpoint`. Its manifest, pane and endpoint are in the repo; the pane must be live in production before submission, because Microsoft's validators load it from the URL in the manifest.

## What gets submitted

| Item | Where it comes from |
|---|---|
| Manifest | [`integrations/microsoft/office-addin/manifest.xml`](../../../../integrations/microsoft/office-addin/manifest.xml) (XML, TaskPaneApp, host Presentation, PowerPointApi 1.2). `npx office-addin-manifest validate manifest.xml` passes |
| Icons in the manifest | `https://three.ws/office/powerpoint/icon-{16,32,64,80}.png`, from `public/office/powerpoint/` |
| Store logo, 300 x 300 PNG | [`marketing/microsoft/media/powerpoint/logo-300x300.png`](../../../microsoft/media/powerpoint/logo-300x300.png), rendered by `npm run media:microsoft` from the same brand cube as the manifest icons (listed under Listing media below) |
| Screenshots, 1366 x 768 PNG, one to five | Taken by the owner in PowerPoint for the web: the pane signed in with Your models, generating a model with the progress bar, the inserted slide in edit mode, the slideshow with the model rotated, the slide after a Morph transition |
| Test notes for the validators | Below, plus a three.ws test account the owner creates for review (credentials go only into the Partner Center "Notes for certification" field, never into this repo) |
| Support link | `https://three.ws/support`, contact `support@three.ws` |
| Help and documentation link | `https://three.ws/docs/powerpoint` (also `SupportUrl` in the manifest) |
| Privacy policy | `https://three.ws/legal/privacy` |
| End user license agreement | Standard Contract for Microsoft Commercial Marketplace |
| Category | Productivity (primary), Content management (secondary) |

## Listing copy

**Name:** three.ws 3D Models

**Summary (100 characters or fewer):** Put interactive 3D models on your slides. Insert yours or generate one free, then rotate it live.

**Description:**

> three.ws 3D Models puts interactive 3D on your slides in one click. Sign in with your three.ws account to insert any of your models, or describe an object in plain words and generate a new textured model for free, no account needed.
>
> Each model arrives as a real PowerPoint 3D object on its own slide, titled with its prompt. Drag it to rotate it while you present, use Morph to animate between camera angles, and resize it like any picture. Rigged and animated models keep their skeleton and animation.
>
> Every model is prepared for Office before it reaches your deck: compressed geometry is decoded, textures are converted to PNG or JPEG and sized for smooth playback, and a poster picture is included for viewers without 3D support.
>
> Works in PowerPoint for the web and PowerPoint for Microsoft 365 on Windows and Mac. The add-in talks only to https://three.ws and reads nothing from your presentation; it only inserts the slides you choose.

**Search keywords:** 3D, 3D model, GLB

## Notes for certification (paste into Partner Center)

> 1. Open any presentation and choose Insert > three.ws 3D Models.
> 2. Without signing in: type "a low poly brass lantern" under Generate a model and choose Generate. A model is ready in about a minute; choose Insert slide under Just generated. A slide with the interactive 3D model is inserted after the selected slide.
> 3. Choose Sign in and use the test account in these notes. Sign-in opens in a dialog. After consent, Your models lists the account's models; choose Insert slide on any of them.
> 4. Choose Sign out to end the session.
> The add-in needs internet access to https://three.ws only.

## Checklist with evidence

| Requirement | State | Evidence |
|---|---|---|
| Manifest is valid | Pass | `npx office-addin-manifest validate manifest.xml`: "The manifest is valid." on 2026-11-11 |
| Every manifest URL is HTTPS on one domain | Pass | `https://three.ws` only (`AppDomain`, icons, pane, support) |
| The pane can be framed by Office and nobody else | Pass | `frame-ancestors` lists `'self'` and the Office hosts only (vercel.json route `/office/powerpoint/?`), checked on the production server build locally |
| Sign-in does not run inside the frame | Pass | Office dialog API (`displayDialogAsync`); the authorize page keeps `frame-ancestors 'none'` |
| Requirement set matches the API used | Pass | `insertSlidesFromBase64` is PowerPointApi 1.2; `targetSlideId` is used only when PowerPointApi 1.5 is supported |
| Works without an account | Pass | Generate uses the free lane, signed out |
| Empty, loading and error states | Pass | Skeletons, "No models yet" with a link to Forge, retry on network errors, rate-limit wait times |
| Exported deck opens cleanly | Pass | Real production model decks open without repair in LibreOffice Impress (poster) and in python-pptx (3D frame present) |
| Pane, callback and icons live in production | Owner | Needs the production deploy carrying the 802 commits |
| Inserted model rotates in PowerPoint | Owner | Open a deck from the pane in PowerPoint for the web and drag the model |
| Test account, store logo and screenshots | Owner | Steps above |
| Partner Center offer created and submitted | Owner | Partner Center, Marketplace offers, New offer, Office add-in |
