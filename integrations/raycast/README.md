# Three.ws for Raycast

Make and find 3D models from the Raycast command bar.

- **Forge a 3D Model**: describe an object, get a textured GLB from the free Forge lane on three.ws.
- **Search 3D Assets**: search the free three.ws catalog (CC0 props, rigged humanoid characters, retargetable motion clips), then copy paste-ready embed code or download the file. No account needed.
- **Search My Models**: browse and filter every model you forged, open it, copy its link, or forge it again.

Forge is free, but making a model needs a free three.ws account, so every model has an owner who can publish or delete it (new models stay unlisted until you publish them).

## Set up

1. Create a free API key at <https://three.ws/dashboard/api-keys>. The default key works for every command.
2. Open Raycast, run any three.ws command, press Cmd+, and paste the key into **API Key**. Search 3D Assets works without one.

## Use

**Forge a 3D Model**

1. Run **Forge a 3D Model** and type a subject, for example "a small wooden chair". Typing the prompt as the command argument in root search skips the form and starts at once.
2. Wait for the status view (queue, then mesh and texture). A draft usually takes under a minute; a cold GPU can take longer.
3. Copy the GLB link (Cmd+C) or open it in the three.ws viewer.

**Search 3D Assets**

1. Type what you need ("industrial lamp", "robot", "wave"). Narrow by kind with the dropdown (Cmd+P).
2. Enter copies the embed code for the asset's default framework (`<model-viewer>` for props, `<agent-3d>` for characters, three.js for clips). Cmd+Enter opens the 3D preview on three.ws. Cmd+Shift+E shows every framework's snippet.
3. Cmd+Shift+C copies the file URL, Cmd+D downloads it. Each item shows its license; every object is CC0.
4. Nothing fits? Cmd+N forges your search text as a new model.

**Search My Models**

1. Your models load newest first with their preview, prompt and visibility. Type to filter by prompt words; scroll to load older ones.
2. Enter opens the model page, Cmd+C copies its link, Cmd+Shift+. copies the prompt, Cmd+F forges the same prompt again.

## Preferences

| Preference | Meaning |
| --- | --- |
| API key | Needed for Forge and My Models. Sent as `Authorization: Bearer`, never to the public catalog. If it is missing or revoked, the command shows how to fix it. |
| Quality tier | `draft`, `standard` or `high` for Forge. Draft is fastest. |
| Base URL | Optional. Point at a self-hosted three.ws API. Default https://three.ws. |

## APIs

- `POST /api/forge`, `GET /api/forge?job=` (Forge)
- `GET /api/catalog?q=&kind=&offset=&limit=`, `GET /api/catalog?id=` (Search 3D Assets, public)
- `GET /api/forge/mine?limit=&before=` (Search My Models, needs the `avatars:read` scope every default key has)

## Develop

```bash
npm install
npm test        # replays recorded production responses (test/fixtures)
npm run build   # ray build
npm run lint    # ray lint
npm run dev     # live reload inside Raycast
```

The tests replay real exchanges with production:

- `forge-draft-text.json` and `forge-draft-cached.json`: a Forge job, and the answer Forge gives for a prompt it already generated (done at submit, no job id). Re-record with `THREE_WS_API_KEY=... node test/record-fixture.mjs`; set `FORGE_PROMPT` to a fresh subject, and `FORGE_BACKEND` to pin an engine when the default lane is cold.
- `catalog-search.json`, `catalog-item.json`, `my-models.json`: two catalog pages and a no-match query, an object and a motion clip with their snippets, and two pages of My Models plus the 401 without a key. Re-record with `THREE_WS_API_KEY=... node test/record-library-fixtures.mjs`.

`npm run lint` currently reports one error: the `author` field must be a Raycast username, and none exists yet for three.ws. See [SUBMITTING.md](./SUBMITTING.md).
