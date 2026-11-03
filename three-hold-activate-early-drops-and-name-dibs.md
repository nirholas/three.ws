---
slug: three-hold-activate-early-drops-and-name-dibs
title: Enforce early drop windows, first-dibs on names and priority MCP lanes for $THREE holders
tier: P2
score: 54
area: three
sources: docs/hold-to-access.md
---

## Why this matters

Three more hold-to-access perks (`drops.early`, `names.first_dibs`, `mcp.priority`) are declared but `enforced:false`. Until they bite, holding $THREE gives no real edge on drops, rare names or MCP throughput, which weakens the demand lever and keeps the honesty gate forcing the UI to say "coming".

## Current state (measured by the reviewer on 2026-11-03)

- Entitlements declared, unenforced, in `api/_lib/three-access.js`.
- Backends to gate: `api/irl/drops.js` and `api/vanity/drops.js` (drops), `api/sns.js` with `api/_lib/pricing/name-rarity.js` and `api/_lib/pricing/catalog.js` (`name.auction`) for names, MCP rate limiting in the MCP handlers under `api/` for priority.
- Token tier lookup helpers: `api/_lib/require-three.js`, `api/token/[action].js`.

## Step 0: re-derive the current state

```
grep -n "drops.early\|names.first_dibs\|mcp.priority" -r api src | head -30
sed -n 1,120p api/irl/drops.js
grep -n "auction" api/_lib/pricing/catalog.js
```

## Tasks

1. Tests first, one file per perk beside `tests/forge-high-gate.test.js`: `tests/drops-early-gate.test.js` (non-holder claim before `early_until` is refused with the structured gate error; holder succeeds; after the window both succeed), `tests/names-first-dibs.test.js` (rare names show a holder-only window before open auction), `tests/mcp-priority-lane.test.js` (holder gets the higher rate-limit bucket).
2. Add an optional `early_until` timestamp to drops (additive migration for the drops tables) and enforce at claim time in both drop handlers.
3. Add a first-dibs window to the name auction path driven by `name-rarity.js`, enforced server side on bid/claim.
4. Apply the priority bucket in the MCP rate limiter keyed off the verified holder tier.
5. Flip the three flags to `enforced:true` only as each is verified; keep `tests/three-tier-honesty.test.js` green and update UI copy with live tier values.
6. Update `docs/hold-to-access.md`; changelog entry.

## Definition of done

- [ ] All three new test files and `tests/three-tier-honesty.test.js` pass.
- [ ] `grep -n "enforced" api/_lib/three-access.js` shows no remaining `enforced:false` for these three keys.
- [ ] Drops page shows the early-access countdown and the gated state in a real browser, no console errors.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Unsure of window lengths | Make them configurable env/config values with defaults of 10 minutes (drops) and 24 hours (names); state the choice in the report |
| No real holder on staging | Use the seeded-entitlement test pattern from the forge gate tests |

## Gates

Nothing here moves funds. Do not mint or auction a real name on mainnet while verifying; use devnet or the test database.
