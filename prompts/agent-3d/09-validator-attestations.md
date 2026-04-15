# Task 09 — Signed glTF validator attestations

## Context

Every agent carries a body. Per [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) § attestations, the manifest points at an attestation proving the body was validated. Today the runtime does not verify this, and the register flow does not produce one.

A signed attestation lets any viewer mount an agent with confidence that the GLB is well-formed — no last-minute broken bones, no invalid accessors. It's also the first step toward the broader provenance story (can be extended to rig verification, rights attestations, etc.).

## Goal

Emit a signed attestation when a GLB passes validation, pin it alongside the body, and verify it in the element when the manifest references one.

## Deliverable

1. **`src/attestations/gltf.js`** (new file):
	 - `async createGlTFAttestation({ glbBlob, validatorReport, signer, agentId })` — SHA-256 the GLB, embed the validator's summary (error/warning counts, severity max) + issuer + timestamp + agentId + GLB hash. Sign the canonical JSON with the signer's `signMessage`. Return `{ type: "gltf-validator", ... , signature: "0x..." }`.
	 - `async verifyGlTFAttestation({ attestation, glbBlob, trustedIssuers? })` — recomputes the hash, recovers the signer from the signature, returns `{ valid: boolean, issuer: string, reasons: string[] }`.
2. **Register flow integration** — [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js):
	 - After validation but before registration JSON is built, call `createGlTFAttestation`, pin via `getPinner()`, add the CID to the registration JSON under `attestations`.
3. **Runtime integration** — [src/element.js](../../src/element.js) `_boot()`:
	 - If `manifest.attestations` includes a `gltf-validator` entry, fetch the attestation JSON and the GLB, `verifyGlTFAttestation`.
	 - On `valid: false`: emit `agent:warning { type: "attestation-invalid" }` and either continue (default) or refuse (if `manifest.require.validAttestation === true`).
4. **Element attribute** — `require-attestation="true"` refuses to mount agents with invalid or missing attestations.
5. **Spec update** — [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md) § attestations: document the canonical signing message format.

## Audit checklist

- [ ] Tampering with the GLB (changing a single byte) causes verification to fail with a clear reason.
- [ ] Changing the attestation's reported error count (without re-signing) fails verification.
- [ ] Verification works without a wallet connection (it's pure crypto — `ethers.verifyMessage`).
- [ ] The canonical message format is stable: `agent-3d:attestation:gltf:v1:{agentId}:{glbSha256}:{summaryHash}`.
- [ ] Multiple attestations per agent are supported (current task adds one type; spec leaves room for more).
- [ ] Issuer address is lowercased in the attestation JSON for comparison stability.
- [ ] `require-attestation` attribute blocks mount with a clear user-facing error.
- [ ] Attestation fetch failure is non-fatal by default.

## Constraints

- No new dependencies. Use `crypto.subtle` for SHA-256 and ethers for signatures.
- Canonical JSON serialization — use sorted keys, no whitespace. Hand-rolled is fine (it's a small object).
- Do not introduce a centralized "trusted issuer registry" in this task — `trustedIssuers` is a caller-provided array for now.

## Verification

1. `node --check src/attestations/gltf.js`.
2. Integration test: register a test agent, fetch the manifest, verify the attestation with a helper script, confirm `valid: true`.
3. Tamper test: edit the attestation locally, confirm verification fails.
4. `npm run build:all` passes.

## Scope boundaries — do NOT do these

- Do not extend to non-glTF attestations (rig compatibility, rights, age rating) — separate tasks.
- Do not post attestations on-chain in the Validation Registry yet — the abi is present in [src/erc8004/abi.js](../../src/erc8004/abi.js) but wiring it is a follow-up.
- Do not add a UI for browsing attestations.

## Reporting

- Attestation JSON size (typical).
- Verification latency in the browser (expect <10ms excluding GLB fetch).
- Whether you shipped multiple attestations support (array) or a single one (object). Recommend array.
