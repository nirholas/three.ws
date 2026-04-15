# Task 03 — Ready Player Me fallback pipeline

## Why this exists

Avaturn will fail sometimes (quota, outage, no face detected). Ready Player Me is a mature alternative with a slightly different UX (they render their own iframe-based builder) and provide a GLB URL on completion. Offering it as a fallback (or a user-selectable option) means the "take a selfie, get an avatar" promise survives one SDK being down.

## Files you own

- Create: `src/onboarding/rpm-pipeline.js`.
- Create: `api/onboarding/rpm-session.js` (if RPM needs any server-side init; many integrations are purely client-side — document).
- Edit: `api/_lib/env.js` — add optional `RPM_SUBDOMAIN` (e.g. `your-app.readyplayer.me`).
- Edit: `vercel.json` if you added a server endpoint.

Do not modify Avaturn code. These two pipelines coexist.

## Deliverable

### Client pipeline

```js
import { RpmPipeline } from './onboarding/rpm-pipeline.js';

const pipe = new RpmPipeline();
pipe.on('progress', ...);
const result = await pipe.run({ photoBlob });
// result = { glbUrl, glbBlob, sessionId, previewImage }
```

Strategy:
1. Embed the Ready Player Me iframe (`https://${RPM_SUBDOMAIN}/avatar?frameApi`) in a modal container the pipeline creates and tears down.
2. Pass the selfie blob to RPM via their `postMessage` API (RPM accepts `{ target: 'readyplayerme', type: 'selfie', data }` — verify against their current docs and record what you used).
3. Listen for `v1.avatar.exported` messages; pull the GLB URL from the payload.
4. Fetch the GLB as a Blob and resolve.

### When to use fallback

- Export a helper `chooseAvatarPipeline({ preferred })` that returns either `AvaturnPipeline` or `RpmPipeline` based on:
  - explicit user choice (query param `?pipeline=rpm` or `?pipeline=avaturn`)
  - a health check against both services (1s timeout, in parallel)
  - default to Avaturn
- On first-pipeline failure with `quota_exceeded | network | timeout`, automatically retry with the other and emit a user-visible toast ("Trying another service…").

Keep the selector in `src/onboarding/pipeline-selector.js`.

## Constraints

- Do not ship the RPM iframe always-visible. Only create it when the pipeline runs.
- Sandbox the iframe (`sandbox="allow-scripts allow-same-origin"`) — exactly the attributes RPM requires, no more.
- Origin-check every `postMessage` (`event.origin === 'https://${RPM_SUBDOMAIN}'`). Drop messages from any other origin.
- If `RPM_SUBDOMAIN` is unset, the selector silently prefers Avaturn (no broken UI).

## Acceptance test

1. `node --check` on new JS files.
2. Manual: `?pipeline=rpm` → RPM builder iframe appears → user completes avatar → GLB downloads and renders.
3. Avaturn failure simulated (force a 500 from the session endpoint) → selector transparently falls back to RPM.
4. RPM disabled via missing env → selector silently uses Avaturn only.
5. Third-party origin posts to window → ignored.

## Reporting

- RPM `postMessage` schema used (paste the events and payloads).
- Whether the selfie-to-iframe hand-off worked or whether RPM forced a manual customization step.
- Failure-fallback timing as measured in practice.
