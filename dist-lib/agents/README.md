# Agents Directory

Public directory of registered agents across the 3D Agent ecosystem.

## Features

- **Global discovery** — Browse all registered agents on-chain
- **Chain filtering** — Filter by blockchain (Base, Base Sepolia, Optimism, Polygon)
- **Search** — Find agents by name, ID, or description
- **Sorting** — Sort by newest, oldest, or alphabetical order
- **Pagination** — 30 agents per page with shareable URLs
- **Lazy loading** — Avatar thumbnails load on-demand

## Data source

Agents are sourced from the **on-chain IdentityRegistry**. Each agent's metadata is resolved from the `tokenURI` stored on-chain. Avatar images are extracted from the agent manifest's `body.uri` field.

## URL parameters

Filters are preserved in the URL for shareability:

```
/agents/?chain=8453&sort=newest&page=2&search=Alice
```

| Parameter | Values                                                                         | Default  |
| --------- | ------------------------------------------------------------------------------ | -------- |
| `chain`   | `all`, `8453` (Base), `84532` (Base Sepolia), `10` (Optimism), `137` (Polygon) | `all`    |
| `sort`    | `newest`, `oldest`, `name`                                                     | `newest` |
| `page`    | `1`–N                                                                          | `1`      |
| `search`  | Free text                                                                      | (none)   |

## Accessibility

- Semantic HTML with `data-agent-id` attributes on cards (QA-friendly)
- Lazy loading via `IntersectionObserver`
- Keyboard navigation support (tabs, enter)
- Target Lighthouse accessibility score ≥ 90

## Architecture

- **[index.html](./index.html)** — HTML structure + inline styles
- **[boot.js](./boot.js)** — Event handling + URL state management
- **[../../src/agents-directory.js](../../src/agents-directory.js)** — Controller class
    - Fetches from on-chain registries
    - Client-side filtering & sorting
    - SWR-style caching (60s TTL)
    - Lazy image loading

## Rate limiting

On-chain queries use public RPCs from `CHAIN_META`. No backend calls for the public list (no rate-limit concerns).
