# Task 17 — Embed Spec: delegation surface for hosts

## Why

The `<agent-3d>` embed and the Claude/LobeHub host integrations need documented, versioned rules for how they learn about an agent's delegations and which host capabilities let a skill redeem without a wallet popup. Without this, third-party hosts will either ignore the field or misuse it.

## Read first

- [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) — the file you are editing
- [specs/CLAUDE_ARTIFACT.md](../../specs/CLAUDE_ARTIFACT.md) — the Claude-artifact host profile
- [specs/EMBED_HOST_PROTOCOL.md](../../specs/EMBED_HOST_PROTOCOL.md) — host→embed message protocol, if present
- [00-README.md](./00-README.md) — canonical manifest `permissions` field + `/api/permissions/metadata` shape
- [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) — where task 02 adds the manifest field

## Build this

Append a new section to `specs/EMBED_SPEC.md` titled **Delegations (optional, v0.2+)** containing:

1. **How the embed discovers delegations (two paths):**
    - **Manifest path** — if the loaded `manifest.json` contains `permissions.delegations[]`, the embed uses that array directly. No network call needed.
    - **Metadata path** — if the manifest omits `permissions` (e.g. it was pinned before permissions were granted), the embed MAY call `GET /api/permissions/metadata?agentId=...` to hydrate. Hosts must cache this for at least 60s.
2. **Host attributes / init options** the embed surface exposes:
    - `permissions="readonly" | "interactive" | "relayer"` — host's stance:
        - `readonly` (default) — embed shows delegations, never initiates redemption
        - `interactive` — embed may prompt for a signer (the host must provide one via `host.getSigner()`)
        - `relayer` — embed may call `/api/permissions/redeem` with a bearer token the host has provisioned
    - `permissions-bearer` — when `permissions="relayer"`, the bearer token scoped to `permissions:redeem` (per task 09). Opaque string, host is responsible for rotation.
3. **Host → embed messages** (post-message protocol):

    - `permissions.query` (host→embed): request a list of active delegations matching a filter
    - `permissions.redeem` (host→embed): ask the embed to initiate a redemption on the host's behalf
    - `permissions.redeemed` (embed→host): announce a successful redemption with tx hash
    - `permissions.error` (embed→host): announce a failed redemption with code + message

    Shapes documented inline, copy the error codes verbatim from the canonical shapes.

4. **Claude artifact profile**:
    - Default `permissions="readonly"`. Claude artifacts can render tipping UIs and show status, but a skill that needs to actually transact must request `permissions="relayer"` and the agent owner must provision a bearer token at embed time.
    - Document that the artifact has no persistent wallet connection — `interactive` is not supported in the Claude profile.
5. **LobeHub profile**:
    - Supports all three modes. `interactive` is the default on LobeHub since LobeHub users typically have wallets configured.
6. **Security**:
    - Embeds MUST verify `delegation.hash === keccak256(delegation.envelope)` before trusting.
    - Embeds MUST verify the delegator's signature recovers correctly before offering a redeem action (use `isDelegationValid` from the toolkit).
    - Embeds MUST NOT persist the envelope to storage that is shared across origins.
    - Hosts MUST NOT embed with `permissions="relayer"` without an owner-provided bearer; fall back to `readonly` if absent.
7. **Version bump** — update the `EMBED_SPEC.md` top-level version from 0.1 → 0.2 and add a changelog entry.

## Don't do this

- Do not extend the post-message protocol with arbitrary new messages. Only the four listed above.
- Do not speculate about multi-delegation chaining, session keys, or WebAuthn-gated redemption. Note as future work only.
- Do not redefine the manifest shape here; reference `specs/AGENT_MANIFEST.md`.
- Do not copy-paste the toolkit API into this spec — link to `specs/PERMISSIONS_SPEC.md` (task 01) for library contracts.

## Acceptance

- [ ] `specs/EMBED_SPEC.md` has a new **Delegations** section with all seven subsections.
- [ ] Version bumped to `embed/0.2` with a changelog line.
- [ ] Host-profile subsections for Claude + LobeHub exist.
- [ ] `npx prettier --write specs/EMBED_SPEC.md` passes.

## Reporting

- Diff of the spec file.
- Any inconsistencies you noticed vs. the existing `EMBED_HOST_PROTOCOL.md` (document, don't fix).
