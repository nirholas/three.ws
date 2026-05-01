---
title: Page URL Audit
description: Comprehensive list of every user-facing page URL served by three.ws (excludes /api/* endpoints).
---

# Page URL Audit

Comprehensive list of every user-facing page URL in the three.ws codebase. Excludes `/api/*` endpoints. Routing is defined in [vercel.json](../../vercel.json).

## Marketing & Landing

| URL | Source |
| :-- | :-- |
| `/` | [home.html](../../home.html) — authenticated-aware landing |
| `/home` | 301 redirect → `/` |
| `/features`, `/features/` | [public/features/index.html](../../public/features/index.html) |
| `/discover`, `/discover/` | [public/discover/index.html](../../public/discover/index.html) |
| `/explore`, `/explore/` | 301 redirect → `/discover` |

## App / Core Flow

| URL | Source |
| :-- | :-- |
| `/app` | [app.html](../../app.html) — drag-and-drop viewer |
| `/deploy` | [app.html](../../app.html) (alias) |
| `/create`, `/create/` | [create.html](../../create.html) — agent creation wizard |
| `/first-meet` | [public/first-meet/index.html](../../public/first-meet/index.html) — onboarding |
| `/marketplace`, `/marketplace/` | [marketplace.html](../../marketplace.html) — agent marketplace with categories and listings |
| `/marketplace/agents/[id]` | [marketplace.html](../../marketplace.html) (dynamic) |

## Auth

| URL | Source |
| :-- | :-- |
| `/login` | [public/login.html](../../public/login.html) |
| `/register` | [public/register.html](../../public/register.html) |
| `/forgot-password` | [public/forgot-password.html](../../public/forgot-password.html) |
| `/reset-password` | [public/reset-password.html](../../public/reset-password.html) |

## Profiles

| URL | Source |
| :-- | :-- |
| `/profile` | [profile.html](../../profile.html) |
| `/u/[username]` | [profile.html](../../profile.html) (dynamic) |
| `/avatars/[id]` | [avatar-page.html](../../avatar-page.html) |

## Agent Pages — Platform IDs

| URL | Source |
| :-- | :-- |
| `/agent` | [agent-home.html](../../agent-home.html) |
| `/agent/[id]` | API-rendered ([api/agent-page](../../api/agent-page.js)) for OG/SEO; `?_spa=1` serves [agent-home.html](../../agent-home.html) |
| `/agent/[id]/embed` | [agent-embed.html](../../agent-embed.html) (CSP `frame-ancestors *`) |
| `/agent/[id]/edit` | [agent-edit.html](../../agent-edit.html) |
| `/my-agents`, `/my-agents/` | [public/my-agents/index.html](../../public/my-agents/index.html) — disallowed in [robots.txt](../../public/robots.txt) |

## Agent Pages — On-Chain (EVM + Solana)

| URL | Source |
| :-- | :-- |
| `/a/[chain]/[id]` | API-rendered ([api/a-page](../../api/a-page.js)) — EVM passport with OG tags |
| `/a/[chain]/[id]/embed` | [a-embed.html](../../a-embed.html) (CSP `frame-ancestors *`) |
| `/a/[chain]/[id]/edit` | [a-edit.html](../../a-edit.html) |
| `/a/sol/[asset]` | [public/agent-passport.html](../../public/agent-passport.html) — Solana passport |
| `/a/sol/[asset]/.well-known/agent-card.json` | API-rendered ([api/agents/solana-card](../../api/agents/solana-card.js)) |

## Dashboard

| URL | Source |
| :-- | :-- |
| `/dashboard`, `/dashboard/` | [public/dashboard/index.html](../../public/dashboard/index.html) |
| `/dashboard/actions` | [public/dashboard/actions.html](../../public/dashboard/actions.html) |
| `/dashboard/agent-pumpfun` | [public/dashboard/agent-pumpfun.html](../../public/dashboard/agent-pumpfun.html) |
| `/dashboard/embed-policy` | [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) |
| `/dashboard/sessions` | [public/dashboard/sessions.html](../../public/dashboard/sessions.html) |
| `/dashboard/storage` | [public/dashboard/storage.html](../../public/dashboard/storage.html) |
| `/dashboard/usage` | [public/dashboard/usage.html](../../public/dashboard/usage.html) |
| `/dashboard/wallets` | [public/dashboard/wallets.html](../../public/dashboard/wallets.html) |
| `/settings`, `/settings/` | [public/settings/index.html](../../public/settings/index.html) |

## Studio / Creation Tools

| URL | Source |
| :-- | :-- |
| `/studio`, `/studio/` | [public/studio/index.html](../../public/studio/index.html) — Widget Studio |
| `/hydrate`, `/hydrate/` | [public/hydrate/index.html](../../public/hydrate/index.html) — import on-chain agent |
| `/validation`, `/validation/` | [public/validation/index.html](../../public/validation/index.html) — glTF validator |
| `/strategy-lab` | [public/strategy-lab.html](../../public/strategy-lab.html) — DCA strategy designer |

## Widgets / Artifacts / Embeds

| URL | Source |
| :-- | :-- |
| `/widgets`, `/widgets/` | [public/widgets-gallery/index.html](../../public/widgets-gallery/index.html) |
| `/w/[id]` | API-rendered ([api/widgets/page](../../api/widgets/page.js)) — OG + oEmbed |
| `/artifact`, `/artifact/` | [public/artifact/index.html](../../public/artifact/index.html) |
| `/artifact/snippet` | [public/artifact/snippet.html](../../public/artifact/snippet.html) |
| `/artifact-example` | [public/artifact-example.html](../../public/artifact-example.html) |
| `/wallet-connect-demo` | [public/wallet-connect-demo.html](../../public/wallet-connect-demo.html) |

## Chat SPA

The `/chat` path serves a full Svelte-based AI chat application. Navigation within the SPA is hash-based (`/chat#<route>`).

| URL | Notes |
| :-- | :-- |
| `/chat`, `/chat/` | [public/chat/index.html](../../public/chat/index.html) — Svelte AI chat SPA (default route = chat canvas) |
| `/chat#pricing` | Pricing page |
| `/chat#signin` | Sign-in page (inside chat SPA) |
| `/chat#signup` | Sign-up page (inside chat SPA) |
| `/chat#solutions/sales` | Solutions — Sales |
| `/chat#solutions/marketing` | Solutions — Marketing |
| `/chat#solutions/engineering` | Solutions — Engineering |
| `/chat#solutions/operations` | Solutions — Operations |
| `/chat#solutions/support` | Solutions — Support |
| `/chat#solutions/finance` | Solutions — Finance |
| `/chat#solutions/hr` | Solutions — HR |
| `/chat#solutions/founders` | Solutions — Founders |
| `/chat#business/enterprise` | Business — Enterprise |
| `/chat#business/security` | Business — Security & Compliance |
| `/chat#business/deployments` | Business — Private Deployments |
| `/chat#business/customers` | Business — Customer Stories |
| `/chat#business/contact-sales` | Business — Contact Sales |
| `/chat#features/web-app` | Feature — AI Web App builder |
| `/chat#features/mobile-app` | Feature — AI Mobile App builder |
| `/chat#features/ai-design` | Feature — AI Design |
| `/chat#features/ai-slides` | Feature — AI Slides |
| `/chat#features/browser-operator` | Feature — Browser Operator |
| `/chat#features/wide-research` | Feature — Wide Research |
| `/chat#features/mail-three.ws` | Feature — Mail three.ws |
| `/chat#features/agent-skills` | Feature — Agent Skills |
| `/chat#events/[slug]` | Events pages (dynamic) |
| `/chat#resources/blog` | Blog index |
| `/chat#resources/docs` | Docs index |
| `/chat#resources/trust-center` | Trust center |
| `/chat#resources/updates` | Product updates timeline |
| `/chat#resources/use-cases` | Use cases index |
| `/chat#dashboard/revenue` | Revenue dashboard (authenticated) |

Route definitions are in [chat/src/App.svelte](../../chat/src/App.svelte). Marketing page content is defined in [chat/src/manus/pages/marketingPages.js](../../chat/src/manus/pages/marketingPages.js) and [chat/src/manus/pages/featurePages.js](../../chat/src/manus/pages/featurePages.js).

## Solana / Pump.fun

| URL | Source |
| :-- | :-- |
| `/pumpfun`, `/pumpfun/` | [public/pumpfun.html](../../public/pumpfun.html) — pump.fun token launcher |
| `/vanity-wallet`, `/vanity-wallet/` | [public/vanity-wallet.html](../../public/vanity-wallet.html) — vanity address grinder |

## Admin / Reputation

| URL | Source |
| :-- | :-- |
| `/admin`, `/admin/` | [public/admin/index.html](../../public/admin/index.html) |
| `/reputation`, `/reputation/` | [public/reputation/index.html](../../public/reputation/index.html) |

## Experiments / Experiences

| URL | Source |
| :-- | :-- |
| `/rider`, `/rider/` | [rider/index.html](../../rider/index.html) — A-Frame WebVR music visualization ("surf the musical road among the stars") |

## Integrations / Locales

| URL | Source |
| :-- | :-- |
| `/cz`, `/cz/` | [public/cz/index.html](../../public/cz/index.html) |
| `/cz/offline` | [public/cz/offline/index.html](../../public/cz/offline/index.html) |
| `/lobehub/iframe`, `/lobehub/iframe/` | [public/lobehub/iframe/index.html](../../public/lobehub/iframe/index.html) |

## Docs

| URL | Source |
| :-- | :-- |
| `/docs`, `/docs/` | [docs/index.html](../index.html) |
| `/docs/widgets` | [docs-widgets.html](../../docs-widgets.html) |
| `/docs/[any]` | [docs/](../) static |

## Legal

| URL | Source |
| :-- | :-- |
| `/legal/privacy` | [legal/privacy.html](../../legal/privacy.html) |
| `/legal/tos` | [legal/tos.html](../../legal/tos.html) |

## Well-Known / Discovery

| URL | Source |
| :-- | :-- |
| `/.well-known/x402` | API ([api/wk-x402](../../api/wk-x402.js)) |
| `/.well-known/agent-attestation-schemas` | API ([api/wk-agent-attestation-schemas](../../api/wk-agent-attestation-schemas.js)) |
| `/.well-known/oauth-authorization-server` | API ([api/wk-oauth-authorization-server](../../api/wk-oauth-authorization-server.js)) |
| `/.well-known/oauth-protected-resource` | API ([api/wk-oauth-protected-resource](../../api/wk-oauth-protected-resource.js)) |
| `/openapi.json` | API ([api/openapi-json](../../api/openapi-json.js)) |

## SEO Files

| URL | Source |
| :-- | :-- |
| `/sitemap.xml` | [public/sitemap.xml](../../public/sitemap.xml) |
| `/robots.txt` | [public/robots.txt](../../public/robots.txt) |

## CDN — Web Component Bundles

| URL | Notes |
| :-- | :-- |
| `/agent-3d/[x.y.z]/agent-3d.js` | Pinned-version bundle (immutable, 1y cache) |
| `/agent-3d/latest/agent-3d.js` | Floating tag (5min cache + SWR) |
| `/agent-3d/[major]/agent-3d.js`, `/agent-3d/[major.minor]/agent-3d.js` | Aliased tags (5min cache + SWR) |
| `/agent-3d/versions.json` | Version manifest (60s cache) |

---

## Feature Surface (by Page)

A high-level map of what each page does, grouped by capability.

### Viewer & Rendering
- **`/app`** — three.js r176 WebGL viewer; drag-drop GLB; Draco/KTX2/Meshopt; HDR; PBR; OrbitControls; dat.GUI parameter tweaking; gltf-validator integration.
- **`/validation`** — standalone Khronos glTF validator with line-level error reporting.

### Agent Creation & Identity
- **`/create`** — full agent creation wizard (avatar upload → brain config → skills → memory → manifest export → optional on-chain mint).
- **`/first-meet`** — onboarding intro / first-time-user experience.
- **`/hydrate`** — import an existing on-chain ERC-8004 agent into the platform.

### Agent Runtime & Talking Surface
- **`/agent/[id]`** — agent passport + chat with LLM tool-loop (Claude), Empathy Layer morph blending, TTS/STT, signed action timeline.
- **`/agent/[id]/embed`** — chromeless iframe embed (CSP allows `frame-ancestors *`).
- **`/agent/[id]/edit`** — owner-only manifest editor (instructions, skills, memory mode, voice, embed policy).

### On-Chain (EVM + Solana)
- **`/a/[chain]/[id]`** — ERC-8004 on-chain passport (server-rendered with OG tags).
- **`/a/[chain]/[id]/embed`** — chromeless on-chain agent embed.
- **`/a/[chain]/[id]/edit`** — on-chain agent edit surface.
- **`/a/sol/[asset]`** — Solana (Metaplex Core) agent passport with attestation feed.
- **`/reputation`** — reputation registry browser (signed feedback + validator attestations).

### Discovery & Marketplace
- **`/discover`** — public agent directory (avatar-prioritized index).
- **`/marketplace`** — agent marketplace with browsable categories and individual agent listings.
- **`/widgets`** — public widget gallery.
- **`/profile`, `/u/[username]`** — public user profiles.
- **`/avatars/[id]`** — public avatar detail page.

### Distribution & Embeds
- **`/studio`** — Widget Studio: pick avatar → pick widget type (turntable, animation gallery, talking agent, ERC-8004 passport, hotspot tour) → copy embed code.
- **`/w/[id]`** — public widget page (OG + oEmbed for Notion/Substack/WordPress/Webflow).
- **`/artifact`, `/artifact/snippet`, `/artifact-example`** — Claude Artifact viewer bundle and demos.
- **`/wallet-connect-demo`** — embedded WalletConnect/SIWE demo surface.

### Dashboard / Account
- **`/dashboard`** — overview.
- **`/dashboard/actions`** — signed agent action log.
- **`/dashboard/agent-pumpfun`** — pump.fun-launched agent management.
- **`/dashboard/embed-policy`** — per-agent iframe origin allowlist.
- **`/dashboard/sessions`** — active session management (logout-everywhere).
- **`/dashboard/storage`** — R2 / IPFS storage mode per avatar.
- **`/dashboard/usage`** — API usage + quota meters.
- **`/dashboard/wallets`** — linked EVM + Solana wallets.
- **`/settings`** — account settings.
- **`/admin`** — staff-only admin surface.

### Solana Token Economy
- **`/pumpfun`** — pump.fun token launcher with bonded agent linkage.
- **`/vanity-wallet`** — Solana vanity-address grinder.
- **`/strategy-lab`** — DCA strategy designer (cron-executed on-chain orders).

### Auth
- **`/login`, `/register`** — email + password (with SIWE / SIWS / Privy options).
- **`/forgot-password`, `/reset-password`** — password recovery flow.

### Chat SPA (`/chat`)
- **`/chat`** — Svelte-based AI chat interface with talking-head avatar, model selector, file uploads, tool-call display, artifact viewer, knowledge base panel, and wallet connect.
- **`/chat#pricing`** — Pricing tiers.
- **`/chat#signin`, `/chat#signup`** — Authentication within the chat SPA.
- **`/chat#solutions/*`** — Per-team marketing pages (sales, marketing, engineering, operations, support, finance, HR, founders).
- **`/chat#business/*`** — Enterprise pages (enterprise, security, private deployments, customers, contact-sales).
- **`/chat#features/*`** — Feature landing pages (web-app, mobile-app, ai-design, ai-slides, browser-operator, wide-research, mail-three.ws, agent-skills).
- **`/chat#events/*`** — Events pages.
- **`/chat#resources/*`** — Resource hub (blog, docs, trust-center, updates, use-cases).
- **`/chat#dashboard/revenue`** — Revenue dashboard (authenticated users).

### Experiments & Experiences
- **`/rider`** — A-Frame WebVR music visualization; browser-native VR with Enter VR button.

### Integrations
- **`/cz`, `/cz/offline`** — CZ demo experience.
- **`/lobehub/iframe`** — LobeHub plugin iframe surface.
- **`/docs`, `/docs/widgets`** — developer documentation.

---

**Total:** ~100 unique URLs (excluding trailing-slash duplicates and dynamic param expansions; ~35 additional hash-routes inside `/chat`). For the OAuth 2.1 server and API surface see [api-inventory.md](api-inventory.md).
