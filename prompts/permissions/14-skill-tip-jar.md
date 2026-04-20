# Task 14 — Reference skill: Tip Jar (`public/skills/tip-jar/`)

## Why

The simplest useful permission-consumer. A viewer tips the creator with USDC (or native ETH) up to a pre-approved daily cap. It's the proof-of-life for the entire band — if this works from a Claude artifact embed, the rest of the surface area follows.

## Read first

- [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md) — authoritative skill bundle layout + `SKILL.md` frontmatter
- [public/skills/](../../public/skills/) — any existing reference skills (copy their structure)
- [00-README.md](./00-README.md) — canonical scope shape
- [src/runtime/delegation-redeem.js](../../src/runtime/delegation-redeem.js) — task 13; the skill calls `redeemFromSkill`
- [src/permissions/grant-modal.js](../../src/permissions/grant-modal.js) — task 10; the skill opens this modal with a preset if no delegation exists

## Build this

Create `public/skills/tip-jar/` with:

1. **`SKILL.md`** — frontmatter per `SKILL_SPEC.md`:
    - `name: tip-jar`
    - `version: 0.1.0`
    - `trust: owned-only` (per repo invariant)
    - `permissions_required: true`
    - `default_scope_preset`:
        ```jsonc
        {
        	"token": "<USDC address per chain>",
        	"maxAmount": "10000000", // 10 USDC (6 decimals)
        	"period": "daily",
        	"targets": ["<this skill's executor contract>"],
        	"expiry_days": 30,
        }
        ```
    - Body: short human description of what it does.
2. **`skill.js`** — ESM module exporting:
    - `async setup({ agent, host })` — attaches a "Tip the creator" button to the agent's chat UI via `host.attachAction(...)` (use whichever existing API skills use; grep `setup({` in current `public/skills/` or `src/agent-skills.js`).
    - `async execute({ agent, host, args })` — entry point invoked when the viewer clicks the button:
        1. Ask the viewer for an amount (max = scope.maxAmount remaining). Render a small tip-amount picker (1 / 5 / 10 USDC or custom).
        2. Call `redeemFromSkill({ agentId, chainId: agent.chainId, skillId: 'tip-jar', calls: [ buildERC20Transfer(usdcAddr, agent.ownerAddress, amount) ], mode: 'auto' })`.
        3. On success, say a canned line via `host.speak('Thank you for the tip!')` and emit a confetti event on the protocol bus (`tip.received`).
        4. On `no_delegation` error, prompt "The creator hasn't enabled tipping on this device yet." and expose a "Grant tipping" action — owner-only, opens the grant modal with the preset above.
    - `buildERC20Transfer(tokenAddr, recipient, amountBaseUnits)` — pure helper returning `{ to, value: '0', data: <ERC-20 transfer calldata> }` using ethers Interface.
3. **`skill.css`** — tiny, optional. Follow the existing skill CSS pattern.
4. **`README.md`** — how the skill works end-to-end, the scope it requests, the happy-path flow diagram in ASCII (5-7 lines).
5. **Manifest reference** — add the skill's relative path to the **Tip Jar** entry in the agent manifest fixture at wherever the skill registry lives; if there's no registry file, mention in your report but don't create one.

## Don't do this

- Do not take custody of funds. Transfer direct from delegator → owner; the skill never holds USDC.
- Do not hardcode the owner's address — pull from `agent.ownerAddress` (the agent manifest already knows this).
- Do not embed a price oracle or USD display. Token units only.
- Do not let a non-owner grant the delegation — the "Grant tipping" path is gated on ownership.
- Do not introduce React or any templating lib. Use the same vhtml / vanilla pattern other skills use.

## Acceptance

- [ ] Skill loads inside the main app (`npm run dev`) without errors.
- [ ] With a live delegation, a tip actually lands on Base Sepolia (tx hash in reporting).
- [ ] Without a delegation, owner can click "Grant tipping" → grant modal → new tip → success.
- [ ] Non-owner viewer without a delegation gets the friendly "not enabled yet" copy.
- [ ] `node --check public/skills/tip-jar/skill.js` passes.
- [ ] `npm run build` passes.

## Reporting

- Explorer link to a real Base Sepolia tip tx.
- Screenshot of the tip UI in the viewer.
- The exact calldata you built for the ERC-20 transfer (hex).
