# Three.ws Forge for Raycast

Describe an object, get a textured 3D model (GLB) from the free three.ws Forge lane. No account, no API key.

## Use

1. Open Raycast and run **Forge a 3D Model**.
2. Type a subject, for example "a small wooden chair", and press Enter. Pass it as the command argument to skip the form.
3. Wait for the status view (queue, then mesh and texture). A draft usually takes under a minute; a cold GPU can take longer.
4. Copy the GLB link (Cmd+C) or open it in the three.ws viewer.

## Preferences

| Preference | Meaning |
| --- | --- |
| Quality tier | `draft`, `standard` or `high`. Draft is fastest. |
| Base URL | Optional. Point at a self-hosted three.ws API. Default https://three.ws. |

## Develop

```bash
npm install
npm test        # replays recorded production responses (test/fixtures)
npm run build   # ray build
npm run lint    # ray lint
npm run dev     # live reload inside Raycast
```

The tests replay `test/fixtures/forge-draft-text.json`, a real exchange with production, and `forge-draft-cached.json`, the real response Forge gives for a prompt it already generated (done at submit, no job id). Re-record with `node test/record-fixture.mjs`; set `FORGE_PROMPT` to a fresh subject, and `FORGE_BACKEND` to pin an engine when the default lane is cold.

`npm run lint` currently reports one error: the `author` field must be a Raycast username, and none exists yet for three.ws. See [SUBMITTING.md](./SUBMITTING.md).
