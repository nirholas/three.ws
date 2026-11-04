# ENS / DNS Agent Claim — v1

A convention for letting a domain prove it owns a three.ws (and vice versa). Bidirectional binding between human-readable names and on-chain agent identities.

## Why

ERC-8004 gives an agent a CAIP-10 reference. Humans don't memorize `eip155:8453:0x8004A169…/42`. Without a name binding, every "this is the official three.ws for example.com" claim is just an unverifiable assertion in a card.

This spec defines two records that are cheap to set, easy to verify, and require no new on-chain infrastructure.

## Forward record (name → agent)

### ENS

Set the text record `agent` on the ENS name:

```
agent = eip155:<chainId>:<registry>/<tokenId>
```

Example for `coachleo.eth`:

```
agent = eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/42
```

Multiple agents: comma-separated list, first entry is canonical.

### DNS (TXT)

For domains without ENS, publish a TXT record at `_agent.<domain>`:

```
_agent.example.com.  IN  TXT  "v=agent1; ref=eip155:8453:0x8004A169.../42"
```

Resolvers MUST treat the first valid `v=agent1` record as canonical and ignore others.

## Reverse record (agent → name)

The agent card SHOULD include a `claims` array pointing at the names that claim it:

```json
"claims": [
	{ "type": "ens",  "name": "coachleo.eth" },
	{ "type": "dns",  "name": "coachleo.com" }
]
```

A claim is **verified** only when both directions match:

- forward: the name's `agent` record contains the agent's CAIP ref.
- reverse: the agent card lists the name in `claims`.

Either direction alone is **unverified**. A consumer (resolver, badge, indexer) MUST display the trust state — verified, half-claim from name, half-claim from agent — distinctly. A half-claim is a useful discovery signal but not a trust signal.

## Resolver behavior

The HTTP resolver at [`/api/v1/agents/:caip`](../api/v1/agents/[...caip].js) currently returns the on-chain agent record plus card-level verification:

```json
{
	"ref": "eip155:8453:0x…/42",
	"chainId": 8453,
	"agentId": "42",
	"registry": "0x…",
	"owner": "0x…",
	"tokenURI": "ipfs://…",
	"card": { "…": "the fetched agent card" },
	"verified": { "modelSha256": true, "cardSchema": "3d-agent-card-v1" },
	"fetchedAt": "2026-07-11T00:00:00.000Z"
}
```

When the card lists `claims` (or the request carries `?name=`), the response gains a `claims` array next to `verified`, one entry per name, each with a trust state:

```json
"claims": [
	{ "type": "ens", "name": "coachleo.eth", "verified": true, "state": "verified", "canonical": true },
	{ "type": "dns", "name": "coachleo.com", "verified": false, "state": "half_from_agent",
	  "reason": "coachleo.com does not point at this agent (TXT record at _agent.coachleo.com has no matching ref)" }
]
```

| `state` | Meaning |
| --- | --- |
| `verified` | The card lists the name and the name points at the agent. `canonical` says whether the agent is the first ref in the name's record. |
| `half_from_agent` | The card lists the name, the name does not point back. |
| `half_from_name` | The name points at the agent but the card does not list it. Only reported for names passed as `?name=<name>` (repeatable, at most 4), since the resolver cannot discover unlisted names. |
| `unverified` | Neither direction matches, the claim is malformed, or the lookup failed (the `reason` says which). |

Verification is best-effort and time-bounded: ENS is read from mainnet through `MAINNET_RPC_URL` (`getEnsText`, key `agent`), DNS through DNS-over-HTTPS (Cloudflare) with the SSRF-safe fetch. At most 4 names are checked per request, each within 3 seconds; further names come back `unverified` with a "not checked" reason. Failures are reported on the claim, never thrown, and successful lookups are cached for the same 5 minutes as the endpoint. Implementation: [api/_lib/agent-name-claims.js](../api/_lib/agent-name-claims.js); the `<three-d-agent-badge>` embed shows each state.

## Adding `claims` to the v1 schema

`claims` is an optional property of [3d-agent-card.schema.json](../public/.well-known/3d-agent-card.schema.json) as of v1.1, promoted once the resolver began verifying it. The conformance URI is unchanged: a v1 card without `claims` is still a valid v1.1 card.

## Security notes

- A name binding is only as strong as the name's own custody. Compromise the ENS owner key → spoofed claims. Consumers SHOULD show the chain age of the binding (block of last `setText`) so a freshly-set `agent` record is treated with more skepticism.
- DNS bindings are weaker (DNS hijack vector). Treat ENS-verified above DNS-verified above unverified.
- Never auto-trust a one-sided claim. The bidirectional requirement defeats the easy attack of "I'll just put your domain in my card."

## Out of scope (v1)

- On-chain reverse resolver contract. The card-level `claims` array is sufficient until indexers want O(1) reverse lookup.
- Wildcard / subdomain claims (e.g. `*.example.com → agent`). Easy to add later.
