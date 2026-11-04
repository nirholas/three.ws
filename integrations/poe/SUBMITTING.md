# Registering the Poe bot

Poe server bots are created in the creator dashboard (<https://poe.com/create_bot?server=1>, docs: <https://creator.poe.com/docs/server-bots/quick-start>, checked 2026-11-04).

## Verified 2026-11-04

- `python3 -m pytest test_forge_bot.py`: 6 passed.
- Live: `ForgeBot.get_response` against production Forge streamed `Forging **a small wooden chair** (tier: draft).` then `**Done.** [Open in the three.ws viewer](https://three.ws/viewer?src=...) or [download the GLB](https://three.ws/cdn/forge/.../....glb).`

## Owner steps

1. Deploy `forge_bot.py` somewhere public. Cloud Run works: a Python 3.12 image, `pip install -r requirements.txt`, entrypoint `python forge_bot.py`, port 8080, env `POE_ACCESS_KEY`.
2. In the Poe dashboard choose "Server bot", enter the public URL, bot name `ThreeWsForge`, and copy the access key into `POE_ACCESS_KEY`.
3. Set the bot description to: "Describe an object, get a textured 3D model (GLB) and a viewer link. Free, no key."
4. Set "Server bot settings" to allow no attachments; the bot does not read files.
5. Send a test message in the Poe chat and confirm the GLB link opens.

Order 938 owns this step; deploying a public service needs owner approval.
