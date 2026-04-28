---
title: Page URL Audit
description: Comprehensive list of every user-facing page URL served by three.ws (excludes /api/* endpoints).
---

# Page URL Audit

Comprehensive list of every user-facing page URL in the three.ws codebase. Excludes `/api/*` endpoints. Routing is defined in [vercel.json](vercel.json).

## Marketing & Landing

| URL | Source |
| :-- | :-- |
| `/` | [index.html](index.html) |
| `/home` | [home.html](home.html) |
| `/features`, `/features/` | [public/features/index.html](public/features/index.html) |
| `/discover`, `/discover/` | [public/discover/index.html](public/discover/index.html) |
| `/explore` | 301 redirect → `/discover` |

## App / Core Flow

| URL | Source |
| :-- | :-- |
| `/app` | [app.html](app.html) |
| `/deploy` | [app.html](app.html) (alias) |
| `/create`, `/create/` | [create.html](create.html) |
| `/login` | [login.html](login.html) |
| `/register` | [register.html](register.html) |
| `/profile` | [profile.html](profile.html) |
| `/u/[username]` | [profile.html](profile.html) (dynamic) |
| `/first-meet` | [public/first-meet/index.html](public/first-meet/index.html) |

## Agent Pages (Dynamic)

| URL | Source |
| :-- | :-- |
| `/agent` | [agent-home.html](agent-home.html) |
| `/agent/[id]` | [agent-home.html](agent-home.html) |
| `/agent/[id]/embed` | [agent-embed.html](agent-embed.html) (CSP `frame-ancestors *`) |
| `/agent/[id]/edit` | [agent-edit.html](agent-edit.html) |
| `/a/[chain]/[id]` | API-rendered (OG tags) |
| `/a/[chain]/[id]/embed` | [a-embed.html](a-embed.html) |
| `/a/[chain]/[id]/edit` | [a-edit.html](a-edit.html) |
| `/my-agents`, `/my-agents/` | [public/my-agents/index.html](public/my-agents/index.html) — disallowed in [robots.txt](public/robots.txt) |

## Dashboard

| URL | Source |
| :-- | :-- |
| `/dashboard`, `/dashboard/` | [public/dashboard/index.html](public/dashboard/index.html) |
| `/dashboard/actions` | [public/dashboard/actions.html](public/dashboard/actions.html) |
| `/dashboard/embed-policy` | [public/dashboard/embed-policy.html](public/dashboard/embed-policy.html) |
| `/dashboard/sessions` | [public/dashboard/sessions.html](public/dashboard/sessions.html) |
| `/dashboard/storage` | [public/dashboard/storage.html](public/dashboard/storage.html) |
| `/dashboard/usage` | [public/dashboard/usage.html](public/dashboard/usage.html) |
| `/dashboard/wallets` | [public/dashboard/wallets.html](public/dashboard/wallets.html) |

## Studio / Creation Tools

| URL | Source |
| :-- | :-- |
| `/studio`, `/studio/` | [public/studio/index.html](public/studio/index.html) |
| `/hydrate`, `/hydrate/` | [public/hydrate/index.html](public/hydrate/index.html) |
| `/validation`, `/validation/` | [public/validation/index.html](public/validation/index.html) |

## Widgets / Artifacts

| URL | Source |
| :-- | :-- |
| `/widgets`, `/widgets/` | [public/widgets-gallery/index.html](public/widgets-gallery/index.html) |
| `/w/[id]` | API-rendered (OG + oEmbed) |
| `/artifact`, `/artifact/` | [public/artifact/index.html](public/artifact/index.html) |
| `/artifact/snippet` | [public/artifact/snippet.html](public/artifact/snippet.html) |
| `/artifact-example` | [artifact-example.html](artifact-example.html) |
| `/wallet-connect-demo` | [wallet-connect-demo.html](wallet-connect-demo.html) |

## Admin / Reputation

| URL | Source |
| :-- | :-- |
| `/admin` | [public/admin/index.html](public/admin/index.html) |
| `/reputation` | [public/reputation/index.html](public/reputation/index.html) |

## Integrations / Locales

| URL | Source |
| :-- | :-- |
| `/cz`, `/cz/` | [public/cz/index.html](public/cz/index.html) |
| `/cz/offline` | [public/cz/offline/index.html](public/cz/offline/index.html) |
| `/lobehub/iframe`, `/lobehub/iframe/` | [public/lobehub/iframe/index.html](public/lobehub/iframe/index.html) |

## Legal & Docs

| URL | Source |
| :-- | :-- |
| `/legal/privacy` | [legal/privacy.html](legal/privacy.html) |
| `/legal/tos` | [legal/tos.html](legal/tos.html) |
| `/docs/widgets` | [docs-widgets.html](docs-widgets.html) |

## SEO Files

| URL | Source |
| :-- | :-- |
| `/sitemap.xml` | [public/sitemap.xml](public/sitemap.xml) |
| `/robots.txt` | [public/robots.txt](public/robots.txt) |

---

**Total:** ~50 unique URLs (excluding trailing-slash duplicates and dynamic param expansions).
