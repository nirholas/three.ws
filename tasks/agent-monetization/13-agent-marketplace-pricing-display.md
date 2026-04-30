# Task 13 — Marketplace: Show Pricing on Agent Cards & Detail Pages

## Goal
When browsing the agent marketplace or an agent's public profile, show callers which skills are priced (and how much) so they know before they invoke anything.

## Success Criteria
- Agent cards in `/api/marketplace` response include `has_paid_skills: boolean`
- Agent detail page shows a "Skills" section with price badges
- Free skills show "Free", priced skills show the amount (e.g., "0.01 USDC")
- Pricing data is served from the existing `/api/agents/:id/pricing` endpoint (read-only, public)

## API Changes

### Update `GET /api/agents` (marketplace list)
Add `has_paid_skills` boolean to each agent in the list response.

```sql
-- In the agents list query, add:
EXISTS (
  SELECT 1 FROM agent_skill_prices asp
  WHERE asp.agent_id = ai.id AND asp.is_active = true
) AS has_paid_skills
```

### Update `GET /api/agents/:id` (agent detail)
Include skill prices in the response:

```json
{
  "id": "...",
  "name": "...",
  "skills": ["answer-question", "generate-image"],
  "skill_prices": {
    "answer-question": { "amount": 1000000, "currency_mint": "EPjF...", "chain": "solana" },
    "generate-image": null
  }
}
```

`null` = free. Only return `is_active = true` prices.

## Frontend Changes

### Agent Card (marketplace grid)
If `has_paid_skills = true`, add a small "Paid" badge (e.g., 💰 or "$" icon) to the agent card. Keep the badge minimal — don't crowd the card.

### Agent Detail Page
In the skills list section, for each skill:
- If `skill_prices[skill]` is non-null: show `0.01 USDC` badge (green)
- If null: show `Free` badge (gray)

Format amounts the same way as the revenue dashboard: `lamports / 10^6` + " USDC".

## Files to Touch
- `/api/agents/index.js` (or wherever the marketplace list handler lives) — add `has_paid_skills`
- `/api/agents/[id].js` — add `skill_prices` to response
- `src/components/agent-card.jsx` (or equivalent) — add paid badge
- `src/components/agent-detail.jsx` (or equivalent) — add price badges to skill list

## Do NOT Change
- Marketplace search/filter logic
- Agent card layout beyond adding the badge
- Agent detail sections unrelated to skills

## Verify
1. Create an agent with a priced skill
2. Browse marketplace → agent card shows "Paid" indicator
3. Open agent detail → skills list shows correct price next to each skill
4. Free skill shows "Free"
5. Unauthenticated user can see prices (public data)
