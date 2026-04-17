# Task 03: Re-enable Avaturn default-editor iframe

## Context

The Avaturn iframe integration used to be the primary avatar-creation path before the selfie-capture rewrite. The iframe logic is **still intact** in [src/avatar-creator.js:43-116](../../src/avatar-creator.js#L43-L116) — it was never deleted, just no longer called from the UI.

Currently `AvatarCreator.open(sessionUrl)` expects a pre-minted Avaturn session URL (which requires a backend call to [api/onboarding/avaturn-session.js](../../api/onboarding/avaturn-session.js) that depends on photo uploads). We need a second entry point that opens Avaturn's **default hosted editor** — no session API, no photos, just "edit this default avatar and export GLB."

See [docs/avaturn-docs.md](../../docs/avaturn-docs.md) for the authoritative URL conventions and [prompts/avatar-platform/01-strip-avaturn.md](../avatar-platform/01-strip-avaturn.md) for history.

## Goal

Add `AvatarCreator.openDefaultEditor()` — a new entry point that loads Avaturn's default editor iframe (no session, no API). Export handler path stays unchanged; it reuses `_handleAvaturnMessage` already at [src/avatar-creator.js:92-116](../../src/avatar-creator.js#L92-L116).

## Deliverable

1. **Add `openDefaultEditor()` method to `AvatarCreator`** in [src/avatar-creator.js](../../src/avatar-creator.js):
   - Resolve the default editor URL from env: `VITE_AVATURN_EDITOR_URL` with fallback (confirm the correct public URL against [docs/avaturn-docs.md](../../docs/avaturn-docs.md) — likely `https://editor.avaturn.me/` or similar; if uncertain, make the URL configurable via env and document the expected value).
   - Set `this._avaturnMode = true`, `this._avaturnOrigin = new URL(defaultUrl).origin`.
   - Build modal via existing `_buildModal()`.
   - Set `this.iframe.src = defaultUrl`.
   - Register `message` listener via existing pathway.

2. **If Avaturn requires a public developer ID / SDK key** in the URL querystring, add it via env `VITE_AVATURN_DEVELOPER_ID`. Document both env vars in [.env.example](../../.env.example).

3. **Verify the export postMessage fires.** Open the default editor, click "Export" inside the Avaturn UI, confirm `_handleAvaturnMessage` receives the event. If Avaturn's default editor posts a different message shape than the session flow, extend the parser at [src/avatar-creator.js:98-104](../../src/avatar-creator.js#L98-L104) to handle it.

4. **Do not** remove the existing `open(sessionUrl)` method — it still serves the selfie-session path when that pipeline is restored later.

## API shape

```js
const creator = new AvatarCreator(document.body, async (glb) => {
    // glb is a Blob, type 'model/gltf-binary'
    await uploadGlbToAccount(glb);
});
await creator.openDefaultEditor();         // NEW — no args, opens default editor
// or still valid:
await creator.open(someSessionUrl);        // session-based (selfie flow, deferred)
```

## Constraints

- **Do not** add `@avaturn/sdk` back to package.json. Raw iframe + postMessage only.
- **Do not** break the CharacterStudio path — `AvatarCreator.open()` with no arg still opens CharacterStudio as today.
- **Do not** change `_handleAvaturnMessage` signatures — additive only.
- **Do not** hardcode the Avaturn editor URL without making it env-overridable.
- Prettier: tabs, 4-wide, single quotes. `npx prettier --write src/avatar-creator.js`.

## Verification

- [ ] `node --check src/avatar-creator.js`
- [ ] `npm run build` passes
- [ ] In a scratch test page (or the existing `/app` register flow), call `new AvatarCreator(document.body, console.log).openDefaultEditor()` — the modal opens with the Avaturn editor visible
- [ ] Click through to export — `console.log` receives a Blob of `type: 'model/gltf-binary'` and size > 0
- [ ] `.env.example` documents `VITE_AVATURN_EDITOR_URL` (and `VITE_AVATURN_DEVELOPER_ID` if used)

## Reporting

- The exact Avaturn default-editor URL you used (cite the doc source)
- Whether a developer ID / SDK key was required
- The postMessage shape Avaturn actually sent (for the parser at [src/avatar-creator.js:98-104](../../src/avatar-creator.js#L98-L104))
- Any CORS / X-Frame-Options issues encountered
- Size of the test-exported GLB
