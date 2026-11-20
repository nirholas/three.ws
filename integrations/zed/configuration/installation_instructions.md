Making or rigging a 3D model needs a three.ws account (free). Create one at https://three.ws, make an API key at https://three.ws/dashboard/api-keys, and paste it into `api_key`. Asset search, avatar inspection and the docs tools work without one.

Settings:

- `api_key`: your three.ws API key. Without it, the Forge tools answer `sign_in_required` with the link to create one. Models you make are saved to your account, unlisted until you share them.
- `base_url`: optional. Point the tools at a self-hosted three.ws API instead of https://three.ws.
- `payment_address`: optional. A Solana USDC address that receives payment if you operate this server for other people.

Ask the Agent Panel for "a 3D model of a wooden chair" and it will call the Forge tools and return a GLB link.
