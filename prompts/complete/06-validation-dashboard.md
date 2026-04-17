# 06 — Validation dashboard UI

## Why

[src/erc8004/validation-recorder.js](../../src/erc8004/validation-recorder.js) exposes `recordValidation()`, `hashReport()`. The contract is live. No UI. Mirror task 05's approach but for ValidationRegistry.

Use case: a third-party validator (auditor) runs tests against an agent's GLB / manifest, signs a report, and submits it on-chain. End-users can browse past validation records for an agent to decide whether to trust it.

## What to build

### 1. Page

Create `public/validation/index.html`:

- Header: agent ref.
- Validation records: list of past reports with validator address, report hash (linkable to IPFS gateway), timestamp, "verdict" (pass/fail/warn).
- Submit form: upload a JSON report, preview its contents, compute hash client-side, upload to IPFS via [src/ipfs.js](../../src/ipfs.js), call `recordValidation(agentId, reportURI, reportHash)`.
- Gated on wallet; any wallet can validate (the contract rule).

### 2. Controller

Create `src/validation-ui.js` with:

```js
export class ValidationDashboard {
  constructor(container, { agentId, chainId })
  async load()
  async submit({ reportFile })   // read JSON, hash, pin, submit
}
```

### 3. Report format

Document the **expected report JSON shape** in `public/validation/REPORT_FORMAT.md`:

```json
{
  "type": "agent-validation-report/0.1",
  "agentId": "...",
  "chainId": 84532,
  "validator": "0x...",
  "ranAt": "2026-04-17T00:00:00Z",
  "suites": [
    { "name": "glb-schema", "status": "pass", "details": "..." },
    { "name": "manifest-integrity", "status": "pass" },
    { "name": "skill-handlers-load", "status": "warn", "details": "skill 'x' missing deps" }
  ],
  "verdict": "pass" | "warn" | "fail",
  "notes": "..."
}
```

Include a sample report at `public/validation/example-report.json`.

### 4. Error states

Same rules as prompt 05: wallet, chain, agent-not-found, RPC failures.

## Files you own

- Create: `public/validation/index.html`
- Create: `public/validation/REPORT_FORMAT.md`
- Create: `public/validation/example-report.json`
- Create: `public/validation/boot.js` (optional)
- Create: `src/validation-ui.js`

## Files off-limits

- `src/erc8004/validation-recorder.js`, `src/erc8004/abi.js`, `src/ipfs.js` — read-only.

## Acceptance

- `http://localhost:3000/validation/?agent=1&chain=84532` renders.
- Uploading the sample report → hash matches what `hashReport()` computes.
- Submit flow triggers wallet, sends tx.
- `npm run build` clean.

## Reporting

Validation report schema frozen, IPFS gateway used for pinning, any mismatch between `hashReport()` algorithm and the client-side hash.
