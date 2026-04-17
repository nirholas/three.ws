# ERC-8004 Register UI — full parity with erc8004.agency

Goal: bring [/#register](../../src/app.js) (rendered by [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js)) up to full UX parity with the reference repo at `github.com/nirholas/erc8004-agents` (live at `erc8004.agency`) — in the 3D-Agent design language.

## What already exists

[src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) (858 lines) already has:

- Chain selector, wallet connect button, close button
- Stats row: Agents Registered / Chains Supported / Registry Version
- Tabs: **Create Agent** / **My Agents** / **Search** / **Templates** / **History**
- 4-step wizard: Identity → Services → Configuration → Deploy
- Full register flow via [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) (`registerAgent()` + `setAgentURI()`)
- Styles in [style.css](../../style.css) (selectors prefixed `erc8004-`)

## Gap list (must-ship for parity)

Reference clone at `/tmp/erc8004-agents/index.html` (single-file, ~1957 lines). Read the HTML + inline `<style>`/`<script>` as the source of truth for behavior.

### 1. Hero section above the card

Mirror the reference hero:

- "● Live on 20+ EVM Chains" pill badge
- H1: "Create **Trustless Agents** on Any Chain" (second word in accent)
- Subtitle: "Register AI agents on-chain with ERC-8004. Get a portable, censorship-resistant identity backed by an ERC-721 NFT — discoverable across the entire agent economy."
- The stats row (630 / 22 / v2.0) should sit under this hero, *above* the tabs (move it out of the current card header).

### 2. Mainnet warning banner

When `selectedChainId` resolves to a non-testnet, show a red-bordered banner above the tabs:
`⚠️ Mainnet Mode — Transactions use real <native token>. Use a testnet first to test.`
Hide on testnets. Use `CHAIN_META[id].testnet` and `.nativeCurrency`.

### 3. Batch tab (new)

Add a sixth tab "Batch" between Templates and History:

- Drop-zone: "Drop CSV or JSON file here / or click to browse"
- Collapsible "📝 Format Guide" accordion explaining the schemas
- Parse CSV (`name,description,image,endpoint,serviceType`) or JSON array of agent configs
- Queue rows; for each, call the same pipeline as step-4 deploy (`registerAgent` + `setAgentURI`)
- Per-row status list: pending → signing → confirmed (txHash link) → linked
- Wallet must be connected to start; warn otherwise.

Copy parse logic verbatim from the reference (`parseBatchCSV`, `parseBatchJSON`, batch runner).

### 4. QR code modal on search results

On each search result card, add a "QR" button next to "Details". Clicking opens a modal:

- Heading "Agent QR Code" + close (✕)
- Subtitle "Agent #<id> on <chain name>"
- QR image (encode `tokenExplorerUrl(chainId, registryAddr, tokenId)` — same URL shown in the existing Details button)
- The URL printed below the QR
- Buttons: **Download PNG** (canvas.toDataURL) and **Copy Link**

Use a zero-dep QR generator. Port the reference's inline generator (it already ships one) or add a tiny inline module under [src/erc8004/qr.js](../../src/erc8004/qr.js). **Do not** add a new npm dep.

### 5. x402 / A2A / MCP / OASF filter chips on Search

Below the search input, render 5 pill chips: `All / A2A / MCP / OASF / x402 💳`. Clicking filters result cards by the `type` / `services` / `x402Support` fields in the agent's registration JSON. Copy the filter predicates from the reference.

### 6. Export Options dropdown on Deploy step

On Step 4 (Deploy), below "Estimated Gas", add a collapsible "📦 Export Options" accordion offering:

- Download registration JSON
- Download as `.cast` command for forge
- Copy `viem` / `ethers` snippet
- Copy curl for the Graph query

Port the exact blocks from the reference.

### 7. Footer below the card

Three-column footer (Learn / Build / Ecosystem) + top row of inline links (ERC-8004 Spec / Contracts / BNB Chain AI Toolkit / GitHub). Same links as the reference. Keep it visually quiet — muted text, thin dividers.

### 8. Navigation entry from homepage

Today `/#register` has no visible entry. Add one:

- On [/agent/:id](../../public/agent/index.html) hub, the **Deploy on-chain** CTA (see [prompts/onboarding-flow/04-agent-page-hub.md](../onboarding-flow/04-agent-page-hub.md)) should open `/#register`.
- Also add a footer link in [index.html](../../index.html) under a new "Build" column: `Register on-chain → /#register`.

## Non-goals

- Do **not** rewrite the existing 4-step wizard — it works. Only add Batch + polish.
- Do **not** switch off plain DOM / add JSX or a framework. Match the existing `erc8004-*` class convention.
- Do **not** add npm deps. Port the QR generator inline.
- Do **not** touch [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js), `abi.js`, or `queries.js` — the on-chain pipeline is correct.

## Constraints

- Prettier: tabs, 4-wide, single quotes, 100 col.
- ESM only.
- JSDoc for public entry points.
- Keep [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) as the single UI module; split into siblings (`batch-tab.js`, `qr.js`) only if the file crosses ~1400 lines.
- All new styles go in [style.css](../../style.css) under the `erc8004-` prefix.

## Verification

- [ ] `node --check src/erc8004/register-ui.js`
- [ ] `npm run build`
- [ ] Load `/#register` on `localhost:3000`:
  - Hero + stats render above the card
  - 6 tabs present; each one renders content
  - BSC Testnet selected → no mainnet banner; switch to BSC Mainnet → red banner appears
  - Create flow still mints (testnet) end-to-end
  - Search an agent → QR button opens modal with scannable code + Download PNG works
  - Filter chips on Search narrow results
  - Batch: drop a 2-row CSV, wallet connected on testnet → both rows confirm
  - Step 4 Deploy → Export Options accordion shows 4 snippets
- [ ] Footer renders with all three columns
- [ ] `/agent/:id` hub's "Deploy on-chain" button navigates to `/#register` (or opens in modal — match what task 04 chose)
- [ ] Homepage footer has "Register on-chain" link

## Reference material

- Reference single-file app: `/tmp/erc8004-agents/index.html`
- Live site: `https://erc8004.agency`
- Our existing flow: [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js)

## Reporting

- Files changed (paths + line deltas)
- Which reference blocks you copied verbatim vs. rewrote
- Any behavior deviations from the reference (and why)
- Whether a real testnet mint succeeded in your manual test, or why you couldn't run one
