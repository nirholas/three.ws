# Agent Task: Write "Troubleshooting & FAQ" Documentation

## Output file
`public/docs/troubleshooting.md`

## Target audience
Anyone having problems with three.ws — developers debugging integrations, users whose agents aren't working, self-hosters with server issues. Organized by symptom, not by system.

## Word count
2000–3000 words

## What this document must cover

### Structure
Organize into sections by symptom category. Each problem should have: **Symptom** → **Likely causes** → **Fix steps**.

### Section 1: Model loading issues

**The 3D model doesn't appear (blank canvas)**
- Check browser console for errors (F12 → Console tab)
- Is the GLB URL accessible? Open it directly in a new tab
- CORS issue: the server hosting the GLB must send `Access-Control-Allow-Origin: *`
- File too large: models over 100MB may timeout; compress with Draco
- Corrupt file: try re-exporting from Blender/Maya
- Wrong format: only glTF 2.0 and GLB are supported (not glTF 1.0, OBJ, FBX)

**Model loads but textures are missing**
- Texture URLs in the glTF JSON may be broken (check in a glTF viewer)
- For GLB: textures should be embedded (most exporters do this by default)
- For glTF (JSON): texture files must be co-located and served from the same origin

**Model loads but looks wrong (wrong colors, black material)**
- Environment map may not be set: try changing the preset in the viewer
- Check metalness/roughness values: all-black often means metalness=1 with no reflection
- Normal map may be inverted: flip the G channel in your 3D editor

**Draco-compressed model fails to load**
- The Draco decoder WASM must be accessible — it's loaded from the CDN automatically
- If CSP blocks external scripts, host the decoder yourself and set `dracoDecoderPath`

**"CORS error" in the console**
- Your GLB host doesn't send CORS headers
- Fix on the server: add `Access-Control-Allow-Origin: *` response header
- Quick workaround: use the `proxy-url` attribute on `<agent-3d>` to proxy through a CORS proxy

### Section 2: Agent / LLM issues

**Agent doesn't respond to messages**
- Is `brain` attribute set? Without it, the LLM doesn't start
- Is `ANTHROPIC_API_KEY` set in environment variables?
- Check `/api/chat` in DevTools → Network for the API response
- Rate limited? Wait a minute and try again (20 req/min for LLM)
- NullProvider active? If no key, the agent falls back to a no-op provider

**Agent responds but says something off-topic**
- The system prompt may be too vague — be more specific about the agent's domain
- Add explicit constraints: "Only discuss topics related to [domain]. If asked about anything else, politely redirect."
- Check if skills are conflicting with the base behavior

**Agent emotions not showing (no facial expression)**
- Model must have morph targets named correctly (see Animation System docs)
- Check DevTools console — avatar module logs if morph targets aren't found
- The `Head` bone must exist for head tilt/lean — check the skeleton

**Agent speaks but mouth doesn't move**
- `mouthOpen` morph target must exist in the GLB
- The morph target must be named exactly `mouthOpen` (case-sensitive)

**TTS not working (agent doesn't speak aloud)**
- Browser must support `SpeechSynthesis` API
- Check if volume is muted in browser or OS
- Some browsers block audio autoplay — first user interaction is required
- Try clicking the page before testing TTS

**ElevenLabs TTS not working**
- Check `ELEVENLABS_API_KEY` in env vars
- Check `/api/tts/eleven` in DevTools → Network — look for 401 (bad key) or 429 (rate limited)
- Free tier: 10,000 chars/month limit

### Section 3: Embedding issues

**Embedded agent doesn't appear**
- Confirm the script tag is loaded before the `<agent-3d>` element
- Check if CSP blocks the CDN script: `cdn.three.ws` must be in `script-src`
- For Next.js: must be a client component with `'use client'`
- SSR: web component uses browser APIs — disable SSR for the component

**Iframe embed shows "Refused to connect" or "Blocked by X-Frame-Options"**
- The platform allows framing by default — if you see this, something is wrong with the URL
- Check that the iframe `src` URL is correct (full HTTPS URL)
- Ensure you're not embedding an edit-mode URL (those block framing for security)

**postMessage not working**
- Check that you're targeting the correct origin: `'https://three.ws/'`
- Listen for `message` events on `window`, not on the iframe element
- Verify the message type prefix: all messages use `'3dagent:'` prefix

**Floating agent hidden behind other elements**
- Add `z-index: 9999` to the `<agent-3d>` element or its container
- Check for `overflow: hidden` on parent elements — may clip the floating panel

**Agent looks tiny / invisible on mobile**
- Set explicit `width` and `height` (or min-height) — the element has no intrinsic dimensions
- `100vw` x `50vh` is a good starting point for mobile
- Avoid `display: inline` — use `display: block` or `display: flex`

### Section 4: Authentication issues

**Can't connect wallet**
- MetaMask: make sure the extension is installed and unlocked
- WalletConnect: try refreshing — QR codes expire after 60 seconds
- Wrong network: some wallets need to switch to the correct chain first
- Incognito mode: MetaMask may not inject in private windows

**"SIWE domain mismatch" error**
- `SIWE_DOMAIN` env var must match the domain in the browser URL bar exactly
- Common mismatch: `www.domain.com` vs `domain.com` — they're different
- For local dev: `SIWE_DOMAIN=localhost` (no port number)

**Session expires too quickly**
- Check `JWT_SECRET` is consistent across deploys — changing it invalidates all sessions
- Session duration is 7 days by default — this is not configurable in the current version

**API key authentication fails**
- Key must be prefixed with `Bearer ` in the Authorization header
- Key may be expired or revoked — check the dashboard
- Key scope may not include the endpoint you're calling

### Section 5: Blockchain / ERC-8004 issues

**Transaction reverts during registration**
- Check gas limit: try increasing by 20%
- Insufficient ETH: bridge more to Base
- Manifest CID may be invalid — verify it resolves on IPFS before registering
- Wrong network: confirm MetaMask is on Base (chain ID 8453), not Ethereum mainnet

**"IPFS pinning failed" during registration**
- IPFS providers can be temporarily down — retry after a minute
- Check that `PINATA_JWT` (or other provider key) is set correctly
- Try a different IPFS provider in settings

**Agent doesn't appear on-chain page**
- The on-chain indexer may take 1-2 minutes to pick up new registrations
- Try the direct URL: `https://three.ws/a/<chainId>/<agentId>`
- Verify the transaction was confirmed on the block explorer

**ENS resolution not working**
- The `3dagent` text record must be set on the ENS name
- ENS records can take 30+ minutes to propagate
- Try resolving directly: `https://three.ws/agent/ens/yourname.eth`

### Section 6: Memory issues

**Agent forgets everything on reload (local mode)**
- Confirm `memory.mode` is `"local"` in the manifest (not `"none"`)
- localStorage may have been cleared — check browser settings
- Private/incognito mode: localStorage is cleared when the window closes

**IPFS memory not loading on other devices**
- The IPFS CID pointer is stored in localStorage — it doesn't sync between devices automatically
- For true cross-device memory: use a server-side memory backend (coming soon)

### Section 7: Performance issues

**Model loads slowly**
- File is too large: compress with Draco (5-10x size reduction for meshes)
- Textures too large: scale down to 1024x1024 max for most cases; use KTX2 for GPU compression
- Too many draw calls: merge meshes in Blender before exporting

**FPS is low / choppy**
- Toggle the stats panel (press S) to identify bottleneck
- Reduce polygon count: under 100k triangles for smooth 60fps on most devices
- Disable environment maps for mobile (expensive)
- Multiple `<agent-3d>` elements: each creates a WebGL context — limit to 4-6 on mobile

**Page freezes when loading a large model**
- GLB parsing is synchronous in some paths — large models (>50MB) can block the UI
- Move model loading to a Web Worker (advanced)
- Use Draco compression — decoder runs in WASM with less UI thread impact

### Section 8: Self-hosting issues

**"Cannot connect to database" on startup**
- Verify `DATABASE_URL` format and credentials
- Check that the database allows connections from your host IP (Neon has IP allowlist)
- Run `node scripts/apply-schema.mjs` to ensure tables are created

**API routes return 500 errors**
- Check Vercel function logs: `vercel logs`
- Common cause: missing environment variable — all required vars must be set

**PWA / service worker issues**
- Clear the browser cache and service worker: DevTools → Application → Clear Storage
- After deploying a new version, the SW may serve stale assets for up to 24 hours

### FAQ

**Is three.ws free?**
The core platform is free to use. API costs (Anthropic, ElevenLabs) are passed through at cost. IPFS pinning requires your own provider keys.

**Can I use any 3D model, or does it have to be a humanoid?**
Any GLB/glTF 2.0 model works. Humanoid models with the right skeleton and morph targets unlock the full emotion system. Non-humanoid models still display and animate fine.

**Does the agent work without an Anthropic API key?**
The 3D viewer, animations, and widget system all work without a key. The LLM conversation feature (brain mode) requires a key.

**Can I self-host without Vercel?**
Yes — any Node.js host works. The API routes are standard Node.js functions. You'll need to handle routing (Vercel's `vercel.json` rewrites map to your host's equivalent).

**Is the agent data private?**
In local memory mode: all data stays in the browser. Conversation messages go through the Anthropic API (read their privacy policy). Model files never leave the browser unless you explicitly save to your account.

## Tone
Direct and practical. Developers come here frustrated — get them to the fix fast. No fluff, no explaining why things work — just what's wrong and how to fix it.

## Files to read for accuracy
- `/docs/SMOKE_TEST.md` — test checklist (reveals common failure modes)
- `/src/element.js` — what attributes do what
- `/src/viewer.js` — model loading paths
- `/src/runtime/index.js` — LLM error handling
- `/src/agent-avatar.js` — morph target requirements
- `/api/auth/siwe/` — SIWE error handling
- `/src/erc8004/agent-registry.js` — registration error handling
