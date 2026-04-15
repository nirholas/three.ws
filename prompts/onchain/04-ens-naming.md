# Task 04 — ENS naming

## Why

"Render `vitalik.eth`'s agent" is a much better UX than "paste this 0x…". Add ENS resolution to the address resolver.

## Depends on

Task 03 must be shipped.

## Read first

- ethers v6 ENS docs — `provider.resolveName`, `provider.lookupAddress`
- [src/agent-resolver.js](../../src/agent-resolver.js)
- [api/agents/by-address/](../../api/agents/) (from task 03)

## Build this

### 1. `GET /api/agents/by-name/:name`

- Accepts any ENS name (`vitalik.eth`, `nick.base.eth`).
- Server-side: `ethers.getDefaultProvider('mainnet').resolveName(name)` → address → reuse task 03's `resolveByAddress`.
- For Base names (`*.base.eth`), resolve via Basename resolver (`0xB94704422c2a1E396835A571837Aa5AE53285a95` on Base mainnet) — if Basename library exists use it; otherwise raw call.
- Cache ENS → address 10 minutes.
- Respond 404 if the name doesn't resolve, 404 if the resolved address has no agent.

### 2. Web component attribute

```html
<agent-3d agent-name="vitalik.eth"></agent-3d>
```

In [src/element.js](../../src/element.js), add this as a fourth resolution path (after `src`, `agent-id`, `agent-address`).

### 3. Reverse lookup (cosmetic)

When rendering the agent page for someone who arrived via address, do a reverse ENS lookup (`provider.lookupAddress(addr)`). If it resolves back to a name AND the forward resolution matches, display `vitalik.eth` instead of the hex address. Otherwise show the hex.

### 4. UX on /agent

URL shapes:
- `/agent/0xabc…` — address
- `/agent/vitalik.eth` — ENS (redirect to `/agent/<resolved-address>`? or keep the name in the URL? Pick the one that keeps the URL stable across name changes — lean **address-canonical** with a small ENS chip in the header)

## Don't do this

- Do not require mainnet ETH balance to query ENS. Use a free public RPC (`cloudflare-eth.com` or similar) by default.
- Do not blindly trust the name without forward-resolve verification.
- Do not resolve CCIP-read names without validating the signing address — just skip them for now with a clear "unsupported" response.

## Acceptance

- [ ] `curl /api/agents/by-name/vitalik.eth` — 404 `not_registered` (expected, Vitalik has no 3D agent yet) but shows the resolved address in the body.
- [ ] An agent registered under an address with an ENS name resolves via name + renders the name in the header.
- [ ] Unknown name → 404.
- [ ] Basenames resolve via Base mainnet resolver.
- [ ] `npm run build` passes.

## Reporting

- Provider RPCs used
- Resolution latency (time to first render) for a cold ENS lookup
- curl transcripts for 4 cases: real name registered, real name unregistered, junk name, Basename
