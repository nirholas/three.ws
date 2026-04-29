---
description: "Use when editing browser automation, Puppeteer, X Spaces DOM interaction, CSS selectors, or the SelectorEngine."
applyTo: "packages/core/src/browser/**"
---
# Browser Automation (packages/core/src/browser/)

## Self-Healing Selectors

The `SelectorEngine` in `selector-engine.ts` tries multiple strategies in order:
1. CSS selector
2. Text content match
3. ARIA attribute match

Selector definitions live in `selectors.ts` (`SELECTOR_DEFINITIONS`).

## Rules

- **Never hardcode CSS selectors** — always add them to `SELECTOR_DEFINITIONS` with multiple fallback strategies
- When X's DOM changes break a selector, add new alternatives rather than replacing old ones
- The admin panel can override selectors at runtime via `POST /admin/selectors/:name`
- Use `DOMObserver` (CDP-based) for watching DOM changes, not polling

## Key Files

| File | Purpose |
|------|---------|
| `lifecycle.ts` | Launch → login → join → leave → stop lifecycle |
| `launcher.ts` | Puppeteer launch with stealth plugin |
| `auth.ts` | X login (cookie auth or form + 2FA) |
| `space-ui.ts` | DOM interaction: join space, request speaker, inject audio |
| `selector-engine.ts` | Self-healing selector resolution |
| `selectors.ts` | All X Space UI element selector definitions |
| `observer.ts` | CDP-based DOM change monitoring |
| `secure-cookie-store.ts` | AES-encrypted cookie persistence |


