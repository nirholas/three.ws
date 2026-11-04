# three.ws Forge bot for Poe

A Poe server bot. Send a description, get a textured 3D model (GLB) from the free three.ws Forge lane: status updates while it renders, then a GLB download link, a three.ws viewer link and, when Forge returns one, a preview image.

```
a small wooden chair
a low-poly fox tier: standard
```

`tier:` accepts `draft` (default, fastest), `standard` or `high`.

## Run

```bash
./run_local.sh           # installs requirements, serves on :8080 without an access key
python3 -m pytest test_forge_bot.py
```

Environment: `POE_ACCESS_KEY` (set in production, from the Poe creator dashboard), `THREEWS_BASE_URL` (default https://three.ws), `FORGE_POLL_INTERVAL`, `FORGE_POLL_TIMEOUT`.

Forge answers a repeated prompt from its cache with a finished GLB and no job id; the bot returns it at once.

See [SUBMITTING.md](./SUBMITTING.md) to register the bot.
