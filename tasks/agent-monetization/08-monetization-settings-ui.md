# Task 08 — Frontend: Monetization Settings Tab in Agent Editor

## Goal
Add a "Monetization" tab to the existing agent settings/editor UI so owners can configure skill prices and payout wallet without leaving the agent management flow.

## Success Criteria
- Tab appears in the agent editor only for the agent's owner
- Loads existing prices on open
- Owner can add/edit/remove prices per skill
- Skill list is populated from the agent's registered skills
- Changes call the pricing API (Task 02) and show success/error feedback
- Payout wallet section lets owner add or change their Solana/Base payout address

## Approach

### Where to add the tab
Search for the agent editor/settings component. Likely in:
- `src/components/agent-editor.jsx` or similar
- Or a settings panel in the main agent detail page

Add a new tab entry: `Monetization` alongside existing tabs (Identity, Skills, Memory, etc.).

### Tab Content Structure

```
Monetization
├── Skill Prices
│   ├── [skill name]   [amount input]  [currency dropdown]  [active toggle]  [Save]
│   ├── [skill name]   ...
│   └── [+ Add skill price] button
└── Payout Wallet
    ├── Solana: [address input or connected wallet selector]  [Set as payout]
    └── Base/EVM: [address input]  [Set as payout]
```

### Skill List Source
Fetch from `GET /api/agents/:id` — the agent's `skills[]` array lists registered skills. Use these as the options in the skill name dropdown/selector.

### Component: `SkillPriceRow`
```jsx
// Props: skill, price (may be null), agentId, onSave, onDelete
// Renders: skill name label, amount input (number), currency select, is_active toggle, Save/Delete buttons
```

### API Calls
- On mount: `GET /api/agents/:id/pricing` to load existing prices
- On save row: `PUT /api/agents/:id/pricing/:skill`
- On delete row: `DELETE /api/agents/:id/pricing/:skill`
- Payout wallet: `GET /api/billing/payout-wallets` on mount, `POST` to add

### Currency Options
Display human-readable labels:
- Solana USDC: mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Base USDC: address `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`

Amount inputs should be in human units (USDC with 6 decimal places), converted to `bigint` (×10^6) before sending to API.

## Files to Touch
- Find and edit the agent editor component (search `agent-editor` or `settings` in `src/components/`)
- Add new component file `src/components/monetization-settings.jsx`

## Do NOT Change
- Other tabs in the editor
- Agent identity or skill registration flows

## Verify
1. Open agent editor as owner → "Monetization" tab is visible
2. Open agent editor as non-owner (or logged out) → tab is hidden
3. Set a price for a skill → price persists after page reload
4. Remove a price → skill returns to free
