# Task 01 — Write `specs/PERMISSIONS_SPEC.md`

## Why

The permissions band needs a canonical, versioned spec the way `AGENT_MANIFEST.md`, `SKILL_SPEC.md`, `EMBED_SPEC.md`, and `MEMORY_SPEC.md` are canonical. Other tasks in this band reference this spec; the SDK, embed hosts, and contract auditors will too. Writing a real doc — not a stub — anchors the design.

## Read first

- [00-README.md](./00-README.md) — **Canonical shapes** section. Lift the shapes verbatim into the spec; do not invent variants.
- [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) — prose style, section depth
- [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md) — how optional fields are marked
- [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) — how hosts are described
- EIP-7710 + EIP-7715 — summarize them accurately, cite the EIP numbers inline

## Build this

Create `specs/PERMISSIONS_SPEC.md` with these sections:

1. **Overview** — one paragraph: what an advanced permission is, why agents need them, the relation to ERC-8004 identity. Include the trust model summary: user signs once, contracts enforce scope, agent redeems at will within scope.
2. **Delegation envelope** — the full ERC-7710 delegation struct (delegate, authority, caveats, salt, signature), as used in this project. Link to the MetaMask Delegation Toolkit docs. Explicitly document which fields are EIP-712 hashed.
3. **Scope vocabulary** — all valid `scope` keys (`token`, `maxAmount`, `period`, `targets`, `expiry`, `selectors`). For each: type, range, constraints, example. Document how caveats map to these keys (ERC-20 allowance caveat, target-allow-list caveat, period caveat, expiry caveat).
4. **Manifest integration** — reproduce the `permissions` field from the canonical shapes. Explain that `uri` resolves to a pinned envelope (IPFS), and inline `envelope` is allowed for embed contexts where IPFS isn't reachable.
5. **API surface** — table of the six endpoints from the canonical shapes. Link to `api/CLAUDE.md` for shared conventions (auth, CORS, rate limits).
6. **Redemption flow** — step-by-step: skill calls `redeemFromSkill` → runtime loads delegation from DB → builds `redeemDelegations(...)` call → submits via relayer (or the agent's smart account) → returns receipt. Clearly label which steps require what keys.
7. **Revocation** — on-chain via `DelegationManager.disableDelegation(delegationHash)`, mirrored off-chain by the indexer cron. Document race conditions (redemption in flight during revoke) and the caveat that on-chain is authoritative.
8. **Error codes** — reproduce the canonical list. For each: when it's returned, how a client should recover.
9. **Versioning** — this spec is `permissions/0.1`. Any breaking change bumps the minor. Agents must advertise supported versions in their manifest.
10. **Security considerations** — replay protection (salt + chain id), phishing (why we show scope in English before the MetaMask prompt), compromised agent key (scope + expiry limit blast radius), relayer trust (if the redeem endpoint is used).

Keep prose tight. Spec style, not tutorial style. No emojis.

## Don't do this

- Don't speculate about features not in the canonical shapes (batched delegations, meta-delegations, etc.). If you think one is needed, note it in your report; don't add it.
- Don't copy-paste the MetaMask docs. Link to them, summarize, cite EIP numbers.
- Don't include code snippets longer than ~10 lines — this is a spec, not a tutorial.
- Don't invent new error codes. If one feels missing, flag it in your report.

## Acceptance

- [ ] `specs/PERMISSIONS_SPEC.md` exists, ~300–500 lines, no TODOs.
- [ ] Sections 1–10 present and non-empty.
- [ ] All canonical shapes from `00-README.md` are reproduced verbatim.
- [ ] `npx prettier --write specs/PERMISSIONS_SPEC.md` passes.
- [ ] No dead links.

## Reporting

- Link the file.
- List any canonical-shape additions you felt were needed but did not add (escalations, not changes).
- Commands run + output.
