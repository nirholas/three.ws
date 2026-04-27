# Embed Spec v0.2 — `<agent-3d>` Web Component

> **Placeholder tag**: `<agent-3d>`. The element name is one find/replace away from whatever you choose — the spec is tag-agnostic.

The entire framework compiles to a single custom element and a single loader script. Developers and end-users get the same zero-friction embed:

```html
<script type="module" src="https://cdn.3d-agent.io/agent-3d.js"></script>

<agent-3d src="agent://base/42"></agent-3d>
```

That's the full install for 95% of users. Everything below is optional.

## Attributes

### Source (pick one)

| Attribute  | Form                              | Example                               |
| ---------- | --------------------------------- | ------------------------------------- |
| `src`      | on-chain URI                      | `agent://base/42`                     |
| `agent-id` | numeric id (pair with `chain-id`) | `agent-id="42" chain-id="8453"`       |
| `agent-id` | CAIP-10 + tokenId                 | `agent-id="eip155:8453:0xReg…:42"`    |
| `agent-id` | shorthand onchain:                | `agent-id="onchain:8453:42"`          |
| `agent-id` | backend account id (legacy)       | `agent-id="a_abc123"`                 |
| `manifest` | IPFS or HTTPS manifest URL        | `ipfs://bafy.../manifest.json`        |
| `body`     | bare GLB (ad-hoc agent)           | `ipfs://bafy.../cz.glb` or `./cz.glb` |

When multiple are set, priority is `src` > `agent-id` > `manifest` > `body`.
All on-chain forms resolve through [`src/erc8004/resolver.js`](../src/erc8004/resolver.js).

### Body / scene

| Attribute         | Type                       | Default     | Notes                             |
| ----------------- | -------------------------- | ----------- | --------------------------------- |
| `poster`          | URL                        | none        | image shown during load           |
| `environment`     | preset name or HDRI URL    | `neutral`   | tone-mapped IBL                   |
| `camera-controls` | boolean                    | off         | orbit, pan, zoom                  |
| `auto-rotate`     | boolean                    | off         | slow Y-axis rotation              |
| `ar`              | boolean                    | off         | WebXR / Scene Viewer / Quick Look |
| `shadows`         | boolean                    | on          | contact + soft shadows            |
| `exposure`        | number                     | 1.0         | tone-map exposure                 |
| `background`      | CSS color or `transparent` | transparent | canvas clear color                |
| `skybox`          | URL                        | none        | HDRI as visible sky               |

### Brain

| Attribute      | Type                      | Default       | Notes                                     |
| -------------- | ------------------------- | ------------- | ----------------------------------------- |
| `brain`        | model id                  | from manifest | `claude-opus-4-6`, `none`, etc.           |
| `api-key`      | string                    | none          | **dev use only** — prefer `key-proxy`     |
| `key-proxy`    | URL                       | none          | your backend that injects API keys safely |
| `instructions` | URL or inline             | from manifest | overrides manifest's instructions.md      |
| `thinking`     | `auto`\|`always`\|`never` | `auto`        | extended thinking hint                    |

### Voice

| Attribute | Type                                | Default                 | Notes                        |
| --------- | ----------------------------------- | ----------------------- | ---------------------------- |
| `voice`   | boolean                             | on if voice in manifest | master on/off for speech I/O |
| `tts`     | provider id                         | browser                 | overrides manifest           |
| `stt`     | provider id                         | browser                 | overrides manifest           |
| `mic`     | `push-to-talk`\|`continuous`\|`off` | `push-to-talk`          | mic policy                   |

### Skills

| Attribute     | Type                             | Notes                                                    |
| ------------- | -------------------------------- | -------------------------------------------------------- |
| `skills`      | comma-separated URIs             | adds to (or replaces with `skills-only`) manifest skills |
| `skills-only` | boolean                          | use only `skills` attribute, ignore manifest             |
| `skill-trust` | `any`\|`whitelist`\|`owned-only` | overrides manifest default                               |

### Memory

| Attribute    | Type                                      | Default       | Notes                                  |
| ------------ | ----------------------------------------- | ------------- | -------------------------------------- |
| `memory`     | `local`\|`ipfs`\|`encrypted-ipfs`\|`none` | from manifest | override storage mode                  |
| `memory-key` | string                                    | `agentId`     | namespace under which memory is stored |

### Layout / embed mode

| Attribute    | Type                                                                    | Default                             | Notes                                             |
| ------------ | ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| `mode`       | `inline`\|`floating`\|`section`\|`fullscreen`                           | `inline`                            | see "Modes" below                                 |
| `position`   | `bottom-right`\|`bottom-left`\|`top-right`\|`top-left`\|`bottom-center` | `bottom-right`                      | for `floating` mode                               |
| `offset`     | CSS length pair                                                         | `24px 24px`                         | distance from edge in floating mode               |
| `width`      | CSS length                                                              | `100%` (inline), `320px` (floating) |                                                   |
| `height`     | CSS length                                                              | `100%` (inline), `480px` (floating) |                                                   |
| `scale`      | number                                                                  | `1.0`                               | camera zoom multiplier, independent of pixel size |
| `responsive` | boolean                                                                 | on                                  | applies `clamp()`-based mobile shrinking          |

### Identity / chain

| Attribute  | Type                                        | Notes                                              |
| ---------- | ------------------------------------------- | -------------------------------------------------- |
| `chain`    | `base`\|`base-sepolia`\|`ethereum`          | override the chain in `src="agent://..."`          |
| `chain-id` | numeric chain id (e.g. `8453`, `84532`)     | pair with numeric `agent-id` for the common case   |
| `registry` | 0x address                                  | override deployed registry (for CAIP-10 precision) |
| `wallet`   | `auto`\|`metamask`\|`walletconnect`\|`none` | wallet connection policy for registration flows    |

The canonical embed shape is `<agent-3d chain-id="8453" agent-id="42">` — the element reads both attributes, resolves the on-chain registry via `REGISTRY_DEPLOYMENTS` (CREATE2-deterministic), and boots. Any of the `agent-id` forms in the Source table are accepted; the explicit `chain-id` attribute is only needed when `agent-id` is a bare number.

### Dev / debug

| Attribute | Notes                                                 |
| --------- | ----------------------------------------------------- |
| `kiosk`   | hides all UI chrome (validator, controls, chat)       |
| `debug`   | overlays scene graph, tool-call log, memory inspector |
| `editor`  | mounts the embed editor instead of the live agent     |

## Modes

All four produce the same runtime agent — only the layout differs.

### `inline` (default)

Fills its container; flows with the document.

```html
<agent-3d src="agent://base/42" style="width: 100%; height: 480px"></agent-3d>
```

### `floating`

Fixed-position bubble. Does not affect document flow.

```html
<agent-3d
	src="agent://base/42"
	mode="floating"
	position="bottom-right"
	offset="24px 24px"
	width="320px"
	height="420px"
></agent-3d>
```

Chrome includes a minimize-to-pill and an expand-to-fullscreen button.

### `section`

Fills a parent container with aspect-ratio preservation. Ideal for hero sections.

```html
<section class="hero">
	<agent-3d src="..." mode="section"></agent-3d>
</section>
```

### `fullscreen`

Takes over the viewport with a close button. Useful for mobile.

```html
<button onclick="document.querySelector('agent-3d').openFullscreen()">Meet Coach Leo</button>
<agent-3d src="..." mode="fullscreen"></agent-3d>
```

## Slots

```html
<agent-3d src="agent://base/42">
	<!-- Shown before model loads -->
	<div slot="poster">
		<img src="./leo.webp" alt="Coach Leo" />
	</div>

	<!-- Shown if loading fails -->
	<div slot="error">Couldn't reach Coach Leo. Try again?</div>

	<!-- AR button (inherits <model-viewer> pattern) -->
	<button slot="ar-button">View in your space</button>

	<!-- Custom chat UI override -->
	<div slot="chat">
		<!-- host their own chat; hook events below -->
	</div>
</agent-3d>
```

## Events

All events bubble and compose (`composed: true`).

| Event                 | Detail                    | When                                          |
| --------------------- | ------------------------- | --------------------------------------------- |
| `agent:ready`         | `{ agent, manifest }`     | fully mounted, skills loaded, brain connected |
| `agent:load-progress` | `{ phase, pct }`          | `"body"` \| `"skills"` \| `"memory"` with 0–1 |
| `agent:error`         | `{ phase, error }`        | anything fatal                                |
| `skill:loaded`        | `{ name, uri }`           | per skill                                     |
| `skill:tool-called`   | `{ tool, args, result }`  | every tool call                               |
| `brain:thinking`      | `{ content }`             | streamed thinking tokens (if enabled)         |
| `brain:message`       | `{ role, content }`       | each assistant or user turn                   |
| `voice:speech-start`  | `{ text }`                | TTS begins                                    |
| `voice:speech-end`    | `{}`                      | TTS ends                                      |
| `voice:listen-start`  | `{}`                      | mic opens                                     |
| `voice:transcript`    | `{ text, final }`         | STT chunks                                    |
| `memory:write`        | `{ key, type }`           | memory updated                                |
| `chain:resolved`      | `{ chain, agentId, cid }` | on-chain lookup succeeded                     |
| `chain:tx`            | `{ hash, kind }`          | registration / update tx submitted            |

## JS API

```js
const el = document.querySelector('agent-3d');

// Conversation
await el.say('Hello');
const reply = await el.ask('What can you help me with?');
el.clearConversation();

// Scene control (same tools the LLM has)
await el.wave({ style: 'enthusiastic' });
await el.lookAt('user');
await el.play('clip-name');

// Skills
await el.installSkill('ipfs://bafy.../dance/');
el.uninstallSkill('dance');
el.skills;                    // array of loaded skills

// Memory
el.memory.read('user_role');
el.memory.write('feedback_tone', { ... });
await el.memory.export();     // tarball for portability

// Identity
await el.connectWallet();
await el.register({ name, description });  // ERC-8004 mint
el.agentId;

// Layout control (mirrors editor)
el.setMode('floating');
el.setPosition('bottom-right', '24px 24px');
el.setSize('320px', '420px');

// Lifecycle
el.pause();
el.resume();
el.destroy();
```

## CSS custom properties

For themers and designers. All opt-in; defaults match `<model-viewer>`-style neutral.

```css
agent-3d {
	--agent-bubble-radius: 16px;
	--agent-accent: #3b82f6;
	--agent-surface: rgba(17, 24, 39, 0.9);
	--agent-on-surface: #f9fafb;
	--agent-chat-font: system-ui, sans-serif;
	--agent-mic-glow: #22c55e;
	--agent-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}
```

## Shadow DOM

All chrome lives inside the element's shadow root. The host page's CSS cannot leak in (except via the custom properties above). The shadow root is open — DevTools can inspect, power users can `el.shadowRoot.querySelector(...)`.

## Accessibility

- Canvas has an `aria-label` synthesized from manifest `name` + `description`.
- Chat surface is a real `<dialog>` with focus trapping.
- All buttons keyboard-reachable.
- TTS respects `prefers-reduced-motion` (no auto-speak on load).
- Captions: every TTS utterance is also rendered as text in the chat pane, so deaf users don't miss content.
- AR mode: honors platform AR accessibility (Quick Look / Scene Viewer handle this).

## Resource policy

- **Lazy mount**: the element does nothing until it intersects the viewport (IntersectionObserver). Override with `eager` attribute.
- **Pause off-screen**: RAF loop pauses when element is fully off-screen; resumes on re-entry.
- **Tab visibility**: mic + LLM stream suspend when tab is hidden; scene pauses.
- **GPU budget**: max one running WebGL context per element; framework enforces this.

## CSP guidance

The loader script and the element respect `Content-Security-Policy`:

- LLM calls go to `key-proxy` if set (no inline API keys).
- IPFS gateways are configurable via `<meta name="agent-3d-gateways">`.
- WASM decoders (DRACO, KTX2) hosted at known-stable CDN paths; a self-hosted mode is supported.

## Progressive enhancement

If the script fails to load, the element falls back to:

```html
<agent-3d src="agent://base/42">
	<!-- this content shows if JS disabled or script blocked -->
	<img src="./leo-poster.webp" alt="Coach Leo (three.ws, requires JavaScript)" />
</agent-3d>
```

## Editor mode

`editor` attribute replaces the live agent with the embed editor described in `EDITOR_SPEC.md` (coming next) — drag-to-position, scale handles, live-preview-on-your-site, copy-snippet.

```html
<agent-3d editor src="agent://base/42"></agent-3d>
```

The editor's "Copy Embed" output is a plain `<agent-3d>` with no `editor` attribute — a clean embed the user pastes anywhere.

## Compatibility

- Modern evergreen browsers (Chrome, Edge, Firefox, Safari) with WebGL2.
- No React, Vue, Svelte dependency — framework-agnostic.
- Works inside React (`<agent-3d />`), Vue, Svelte, Angular, plain HTML, WordPress, Webflow, Notion embeds, Shopify, Ghost, Framer.
- iOS Safari: WebXR unsupported — AR falls back to Quick Look (USDZ export).

## Install / CDN

The bundle is published from the main app's deploy at `https://three.ws/agent-3d/`. Three URL channels, pick based on how strict you need updates:

| Path                                            | Cache                         | Use when                                                  |
| ----------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| `/agent-3d/<MAJOR>.<MINOR>.<PATCH>/agent-3d.js` | `max-age=31536000, immutable` | **production** — pin exact bytes, always combine with SRI |
| `/agent-3d/<MAJOR>.<MINOR>/agent-3d.js`         | `max-age=300`                 | follow patch releases automatically                       |
| `/agent-3d/<MAJOR>/agent-3d.js`                 | `max-age=300`                 | follow minor + patch releases                             |
| `/agent-3d/latest/agent-3d.js`                  | `max-age=300`                 | demos / prototypes only — never in production             |

**Recommended snippet** (pinned + SRI):

```html
<script
	type="module"
	src="https://three.ws/agent-3d/1.5.1/agent-3d.js"
	integrity="sha384-…"
	crossorigin="anonymous"
></script>

<agent-3d src="agent://base/42"></agent-3d>
```

The current SRI hash for each release lives in `/agent-3d/<version>/integrity.json`. The full release manifest (channels, current version, publish time) is `/agent-3d/versions.json` (max-age 60s).

UMD build available at the same path with `agent-3d.umd.cjs` if you can't use ES modules.

All bundle responses ship `access-control-allow-origin: *` and `cross-origin-resource-policy: cross-origin`, so the script loads fine from any origin.

## Versioning

- Element spec: `embed/0.2` — breaking changes bump minor until 1.0.
- Bundle version: tracks `package.json` `version` of the main repo. Pinning a `<MAJOR>.<MINOR>.<PATCH>` URL is the only forever-stable option — moving channels can ship security fixes that may include behavior changes within their semver range.

## Changelog

### v0.2 (2026-04-18)

- Added **Delegations (optional, v0.2+)** section: delegation discovery (manifest + metadata paths), host `permissions` / `permissions-bearer` attributes, five post-message types following the `host.*` / `embed.*` naming convention (`host.permissions.query`, `embed.permissions.query`, `host.permissions.redeem`, `embed.permissions.redeemed`, `embed.permissions.error`), Claude artifact and LobeHub host profiles, and security requirements.

### v0.1

- Initial release: attributes, modes, slots, events, JS API, CSS custom properties, shadow DOM, accessibility, resource policy, CSP guidance, progressive enhancement, editor mode, share routes, and embed policy.

## Share routes (on-chain agents)

Every on-chain agent has a canonical URL triad, plus companion endpoints for previews and oEmbed.

| Route                               | Purpose                                                                                                                              | Served by             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `/a/:chainId/:agentId`              | Canonical page — Open Graph + Twitter Player Card + Farcaster Frame + oEmbed discovery. Redirects real browsers into the SPA viewer. | `api/a-page.js`       |
| `/a/:chainId/:agentId/embed`        | Chromeless iframe viewer (kiosk mode) — meant to be embedded in iframes, web-component previews, and Twitter Player Card.            | `a-embed.html`        |
| `/api/a-og?chain=<id>&id=<agentId>` | 1200×630 OG image. Redirects to the manifest image if present; otherwise renders an SVG card with chain badge + owner.               | `api/a-og.js`         |
| `/api/oembed?url=...`               | oEmbed v1.0 JSON/XML. Recognizes `/a/:chain/:id` URLs; returns `type: rich` with an iframe html payload.                             | `api/agent-oembed.js` |

### Surface matrix

Pick the right embed for each surface:

| Surface                             | Recommended embed                                               | Why                                                                            |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Your own site / partner site        | `<agent-3d src="agent://:chain/:id">`                           | Full fidelity — voice, memory, skills, animations.                             |
| Notion, Substack, Ghost, Medium     | `<iframe src="/a/:chain/:id/embed">`                            | iframe-only platforms — universal compatibility.                               |
| GitHub README / markdown blog       | `![alt](/api/a-og?chain=...&id=...)` linking to `/a/:chain/:id` | Markdown platforms don't run JS — use the OG image as a preview card.          |
| X / Twitter post                    | Paste `/a/:chain/:id`                                           | Twitter unfurls via `twitter:player` → iframe.                                 |
| Slack / Discord / iMessage          | Paste `/a/:chain/:id`                                           | OG tags + oEmbed give a rich preview.                                          |
| Farcaster cast                      | Paste `/a/:chain/:id`                                           | Frame meta tags render an interactive card with "View 3D" + "Explore" buttons. |
| Claude.ai artifact / LobeHub plugin | `<iframe src="/a/:chain/:id/embed">` (band 5)                   | Sandboxed embed — works inside AI artifact runtimes.                           |

### Embed policy

The iframe at `/a/:chain/:id/embed` reads an optional `embedPolicy` from the agent's on-chain manifest metadata. Shape:

```json
{
	"embedPolicy": {
		"mode": "allowlist" | "denylist" | "open",
		"hosts": ["partner.example", "*.example.com"]
	}
}
```

- `mode: "open"` (or missing policy): permissionless — embed anywhere. This is the default.
- `mode: "allowlist"`: iframe refuses to render unless the parent host matches at least one entry.
- `mode: "denylist"`: iframe refuses to render if the parent host matches any entry.

Parent host is determined from `window.location.ancestorOrigins` (Chromium) or `document.referrer`. When the iframe refuses, it posts `{ __agent, type: 'blocked', host }` to its parent and shows a link to open the agent on `three.ws`.

**We ship permissionless by default.** On-chain identity is public — any embedder can show any agent unless the owner has explicitly set a policy. The policy path exists so owners _can_ restrict later; it doesn't gate the default experience.

## Delegations (optional, v0.2+)

The `<agent-3d>` embed can surface and redeem ERC-7710 delegations granted to an agent. This section specifies how the embed discovers delegations, which host configurations unlock redemption, and how hosts communicate with the embed over the post-message channel.

### Discovery

The embed resolves delegations through two paths, tried in order:

**Manifest path** — if the loaded `manifest.json` contains a `permissions.delegations[]` array (see [AGENT_MANIFEST.md](./AGENT_MANIFEST.md)), the embed uses that array directly. No additional network call is needed.

**Metadata path** — if the manifest omits `permissions` (e.g. it was pinned before permissions were granted), the embed MAY call:

```
GET /api/permissions/metadata?agentId=<id>
```

to hydrate the delegation list. Hosts MUST cache the response for at least 60 s.

### Host attributes

Two attributes on `<agent-3d>` govern the redemption surface the host exposes:

| Attribute            | Type / Values                            | Default    | Notes                                               |
| -------------------- | ---------------------------------------- | ---------- | --------------------------------------------------- |
| `permissions`        | `readonly` \| `interactive` \| `relayer` | `readonly` | Host's redemption stance (see below)                |
| `permissions-bearer` | opaque string                            | none       | Bearer token; required when `permissions="relayer"` |

**`permissions` values:**

- **`readonly`** (default) — embed renders delegation status and scope; never initiates a redemption. Safe default for any host that has not provisioned signing capability.
- **`interactive`** — embed may prompt the end user for a wallet signer. The host MUST expose a `host.getSigner()` method that returns an ethers-compatible signer. Requires the host to have a wallet session available.
- **`relayer`** — embed may call `POST /api/permissions/redeem` using the bearer token in `permissions-bearer`. No wallet popup. Requires the agent owner to have provisioned a bearer token scoped to `permissions:redeem` (per task 09).

**`permissions-bearer`** is an opaque string. The host is responsible for rotation; the embed never stores it beyond the current page lifetime.

### Post-message protocol

The five message types below extend the `EMBED_HOST_PROTOCOL` v1 envelope (`{ v: 1, type, id?, payload }`), following the same `host.*` / `embed.*` directional naming convention used throughout that protocol. Hosts and embeds that do not support delegations MUST silently ignore unknown types per the existing protocol's versioning policy.

#### `host.permissions.query` (host → embed)

Request the list of delegations currently loaded by the embed.

```json
{
	"v": 1,
	"type": "host.permissions.query",
	"id": "pq_001",
	"payload": {
		"filter": {
			"chainId": 84532,
			"status": "active"
		}
	}
}
```

| Field            | Required | Notes                                           |
| ---------------- | -------- | ----------------------------------------------- |
| `payload.filter` | no       | Narrows results; omit to return all delegations |
| `filter.chainId` | no       | Limit to a specific chain                       |
| `filter.status`  | no       | `"active"` \| `"expired"` \| `"revoked"`        |

The embed replies with `embed.permissions.query` (below), correlating via the same `id`.

#### `embed.permissions.query` (embed → host)

Reply to `host.permissions.query`. Carries the filtered delegation list.

```json
{
	"v": 1,
	"type": "embed.permissions.query",
	"id": "pq_001",
	"payload": {
		"delegations": [
			{
				"delegationId": "uuid-...",
				"chainId": 84532,
				"scope": {
					"token": "native",
					"maxAmount": "1000000000000000000",
					"period": "daily",
					"expiry": 1775250000
				},
				"status": "active"
			}
		]
	}
}
```

| Field                 | Required | Notes                                            |
| --------------------- | -------- | ------------------------------------------------ |
| `id`                  | yes      | Matches the originating `host.permissions.query` |
| `payload.delegations` | yes      | Array of public delegation views; empty if none  |

#### `host.permissions.redeem` (host → embed)

Ask the embed to initiate a redemption. The embed resolves the signer or bearer token based on the current `permissions` attribute value.

```json
{
	"v": 1,
	"type": "host.permissions.redeem",
	"id": "pr_001",
	"payload": {
		"delegationId": "uuid-...",
		"calls": [{ "to": "0x...", "value": "0", "data": "0x..." }]
	}
}
```

| Field                  | Required | Notes                                          |
| ---------------------- | -------- | ---------------------------------------------- |
| `payload.delegationId` | yes      | UUID from the delegation list                  |
| `payload.calls`        | yes      | Array of `{ to, value, data }` — raw EVM calls |

On completion the embed posts either `embed.permissions.redeemed` or `embed.permissions.error` with the matching `id`.

#### `embed.permissions.redeemed` (embed → host)

Announce a successful redemption.

```json
{
	"v": 1,
	"type": "embed.permissions.redeemed",
	"id": "pr_001",
	"payload": {
		"delegationId": "uuid-...",
		"txHash": "0x...",
		"chainId": 84532
	}
}
```

| Field                  | Required | Notes                                             |
| ---------------------- | -------- | ------------------------------------------------- |
| `payload.delegationId` | yes      | Echoed from the `host.permissions.redeem` request |
| `payload.txHash`       | yes      | Confirmed transaction hash                        |
| `payload.chainId`      | yes      | Chain the transaction landed on                   |

#### `embed.permissions.error` (embed → host)

Announce a failed redemption. `code` is one of the canonical error codes; `message` is a human-readable description.

```json
{
	"v": 1,
	"type": "embed.permissions.error",
	"id": "pr_001",
	"payload": {
		"delegationId": "uuid-...",
		"code": "scope_exceeded",
		"message": "Requested value exceeds the daily allowance."
	}
}
```

| Field                  | Required | Notes                                                                                                                                                                          |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payload.delegationId` | yes      | Echoed from the `host.permissions.redeem` request                                                                                                                              |
| `payload.code`         | yes      | One of: `delegation_expired`, `delegation_revoked`, `scope_exceeded`, `target_not_allowed`, `delegation_not_found`, `signature_invalid`, `chain_not_supported`, `rate_limited` |
| `payload.message`      | yes      | Human-readable description for display or logging                                                                                                                              |

### Claude artifact profile

In a Claude.ai artifact sandbox:

- **Default mode**: `permissions="readonly"`. Artifacts can render tipping UIs, display delegation scope, and show status — but the embed never initiates a redemption automatically.
- **Relayer mode**: if a skill needs to transact, the artifact HTML must include `permissions="relayer"` and the agent owner must have provisioned a `permissions-bearer` token at embed time. The owner provisions this once via the manage panel.
- **Interactive mode is not supported.** Claude artifact iframes have no persistent wallet session. If `permissions="interactive"` is set inside the Claude profile, the embed MUST treat it as `"readonly"` and emit a console warning.

Example Claude artifact embed with relayer mode:

```html
<agent-3d
	src="agent://base/42"
	permissions="relayer"
	permissions-bearer="sk_perm_abc123"
></agent-3d>
```

### LobeHub profile

LobeHub supports all three modes. LobeHub users typically have wallets configured at the platform level, so the default is `permissions="interactive"`.

| Mode          | Supported | Notes                                                         |
| ------------- | --------- | ------------------------------------------------------------- |
| `readonly`    | Yes       | Explicit opt-in; disables all redemption UI                   |
| `interactive` | Yes       | **Default on LobeHub.** Host provides `getSigner()`.          |
| `relayer`     | Yes       | Agent owner provisions bearer; LobeHub injects at embed time. |

When `interactive`, LobeHub's wallet bridge calls `host.getSigner()` and returns the user's connected wallet signer to the embed runtime.

### Security

**Envelope integrity** — embeds MUST verify `delegation.hash === keccak256(delegation.envelope)` before trusting any delegation loaded from the manifest or metadata endpoint. A mismatch MUST abort processing and log a warning; do not attempt redemption.

**Signature verification** — embeds MUST call `isDelegationValid({ hash, chainId })` (from `src/permissions/toolkit.js`; see [PERMISSIONS_SPEC.md](./PERMISSIONS_SPEC.md) for the full library contract) before rendering a redeem action. An invalid or revoked delegation MUST render as inactive, not redeemable.

**Origin isolation** — embeds MUST NOT write delegation envelopes to any storage (`localStorage`, `sessionStorage`, `IndexedDB`, cookies) that is shared across origins. In-memory only for the current page session.

**Bearer token handling** — hosts MUST NOT set `permissions="relayer"` without a valid, owner-provided `permissions-bearer` value. If the attribute is absent or empty when `permissions="relayer"` is requested, the embed MUST silently fall back to `permissions="readonly"`.

> **Future work (out of scope for v0.2):** multi-delegation chaining, session key delegation, and WebAuthn-gated redemption are explicitly deferred.

## See also

- [AGENT_MANIFEST.md](./AGENT_MANIFEST.md)
- [SKILL_SPEC.md](./SKILL_SPEC.md)
- [MEMORY_SPEC.md](./MEMORY_SPEC.md)
- [PERMISSIONS_SPEC.md](./PERMISSIONS_SPEC.md)
- [EMBED_HOST_PROTOCOL.md](./EMBED_HOST_PROTOCOL.md)
