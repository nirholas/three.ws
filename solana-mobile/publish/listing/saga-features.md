three.ws is built around three Seeker-specific capabilities. Each is the right answer to a problem that a generic Android or web build of the same app cannot solve cleanly.

# 1. Seed Vault signing via Mobile Wallet Adapter

The wallet wrapper at `solana-mobile/src/mwa-wallet.js` detects that the user is running inside the three.ws TWA on a Solana Mobile device and routes every signing call — `signMessage`, `signTransaction`, `signAllTransactions`, `signAndSendTransaction` — through the MWA protocol to the on-device Seed Vault.

Why it matters: the private key never enters the application process. SIWS authentication, agent mints, accessory purchases, and wallet linking all approve inside the TEE.

# 2. Camera-driven selfie capture for avatar generation

Phones have a camera the user trusts; desktops mostly don't. The `/create` flow uses the back-camera shutter sequence to capture three reference frames, uploads them to the three.ws reconstruction pipeline, and returns a glTF avatar within roughly a minute. On Seeker this is the fastest path from "I have an idea for an agent" to "the agent is in my wallet".

# 3. Web Share Target for one-tap drops into Telegram, X, and Solana social

The PWA manifest declares a `share_target` at `/create`, so an image or `.glb` shared from another app on Seeker opens directly inside three.ws with the file pre-attached. That powers two specific flows:

- Drop a selfie from the camera roll → instant avatar mint.
- Drop a glTF/GLB file → instant agent creation around it.

These three together — Seed Vault signing, on-device capture, and Share Target ingest — are the reason this app exists on Seeker rather than only as a web app.
