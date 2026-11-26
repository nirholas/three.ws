# Three.ws Forge for Raycast

Describe an object, get a textured 3D model (GLB) from the free Forge lane on three.ws. There is nothing to pay, but making a model needs a free three.ws account, so every model has an owner who can publish or delete it (new models stay unlisted until you publish them).

## Use

1. Create a free API key at <https://three.ws/dashboard/api-keys>. Raycast asks for it the first time you run the command (it is stored as a password preference).
2. Open Raycast and run **Forge a 3D Model**.
3. Type a subject, for example "a small wooden chair", and press Enter. Pass it as the command argument to skip the form.
4. Wait for the status view (queue, then mesh and texture). A draft usually takes under a minute; a cold GPU can take longer.
5. Copy the GLB link (Cmd+C) or open it in the three.ws viewer.

## Preferences

| Preference | Meaning |
| --- | --- |
| API key | Required. Your three.ws API key, sent as `Authorization: Bearer`. If it is missing or revoked, the error view links to the key page and the preferences. |
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

The tests replay `test/fixtures/forge-draft-text.json`, a real exchange with production, and `forge-draft-cached.json`, the real response Forge gives for a prompt it already generated (done at submit, no job id). Re-record with `THREE_WS_API_KEY=... node test/record-fixture.mjs`; set `FORGE_PROMPT` to a fresh subject, and `FORGE_BACKEND` to pin an engine when the default lane is cold.

`npm run lint` currently reports one error: the `author` field must be a Raycast username, and none exists yet for three.ws. See [SUBMITTING.md](./SUBMITTING.md).
