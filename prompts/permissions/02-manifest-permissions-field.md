# Task 02 — Add `permissions` field to Agent Manifest spec

## Why

The agent manifest is the portable, on-chain-addressable description of an agent. For embeds (Claude artifact, LobeHub plugin) to execute scoped on-chain actions without contacting our server, the signed delegation — or a resolvable pointer to it — must live in the manifest itself.

## Read first

- [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) — the file you are editing (the full thing)
- [00-README.md](./00-README.md) — **Canonical shapes → Manifest `permissions` field**. Copy it exactly.
- [src/runtime/](../../src/runtime/) — to understand how the runtime reads the manifest today; your edit must not break existing consumers

## Build this

Append — do not rewrite — a section to `specs/AGENT_MANIFEST.md` titled **`permissions` (optional, v0.1+)**.

Contents:

1. One-paragraph intro: scoped on-chain permissions granted to the agent by its owner via ERC-7710 delegations. Optional — agents without on-chain identity omit the field entirely. Link to `specs/PERMISSIONS_SPEC.md` (task 01 creates it; if not present yet, link anyway — this is a spec cross-reference).
2. The canonical JSON block verbatim from the `00-README.md` Canonical Shapes.
3. **Field reference** — table with `delegationManager`, `delegations[]`, and for each nested field: type, required?, example, constraints.
4. **Resolution order** — how a host resolves a delegation:
    1. If `envelope` is inline → use it.
    2. Else fetch `uri` (IPFS gateway, Arweave, HTTPS — same resolution rules as `body.uri`).
    3. Verify `hash` matches `keccak256(envelope)`.
    4. Verify signature on-chain against the delegator address before trusting.
5. **Backwards compatibility** — manifests without `permissions` are valid; hosts must treat absence as "no on-chain permissions granted". Hosts MUST NOT fall back to asking the user to sign per-tx if the field is absent unless the skill itself requests it.
6. **Size budget** — keep envelope inline only when <8 KB; above that, pin to IPFS and reference via `uri` to keep the manifest lean.

Also bump the `spec` version in the top-level schema block from `agent-manifest/0.1` → `agent-manifest/0.2` and add a `## Changelog` entry at the bottom (or insert into the existing changelog if present) documenting the addition.

## Don't do this

- Don't reorder or edit unrelated sections.
- Don't delete the `0.1` example. Add `0.2` alongside.
- Don't speculate about future fields (e.g. `delegationChains`, `nestedDelegations`). File those as notes in your report.
- Don't include actual signed example data in the spec — just structural examples with `0x...` placeholders.

## Acceptance

- [ ] `specs/AGENT_MANIFEST.md` contains a new `permissions` section with all six subsections above.
- [ ] Top-level `spec` bumped to `agent-manifest/0.2`.
- [ ] `## Changelog` entry added for `0.2`.
- [ ] Canonical shape reproduced exactly (byte-for-byte identical to `00-README.md`).
- [ ] `npx prettier --write specs/AGENT_MANIFEST.md` passes.

## Reporting

- Diff of the spec file.
- Any spec conflicts you noticed (e.g. an older version comment that now contradicts).
