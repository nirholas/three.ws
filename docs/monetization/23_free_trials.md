---
status: not-started
last_updated: 2026-05-04
---
# Prompt 23: Free Trials for Subscriptions

## Objective
Allow creators to offer a limited-time free trial for their subscription-based skills to attract more users.

## Explanation
Free trials are a proven strategy for converting users to paid subscribers. This feature lets a user try a skill for a set period (e.g., 7 days) without paying. After the trial, they must subscribe to retain access.

## Instructions
1.  **Update Price Setting UI:**
    *   In `agent-edit.html`, next to the monthly subscription price setting, add a checkbox and an input for "Offer free trial" and "Trial days".

2.  **Database Changes:**
    *   In the `agent_skill_prices` table, add a new column, `trial_days` (integer).
    *   In the `skill_subscriptions` table, add a `is_in_trial` boolean flag.

3.  **Implement Trial Activation Flow:**
    *   In the marketplace UI, for a skill with a trial, the button should say "Start Free Trial."
    *   Clicking this button will NOT trigger a payment transaction. Instead, it will call a new, simple API endpoint, e.g., `POST /api/skills/start-trial`.
    *   This endpoint verifies the user hasn't already used a trial for this skill.
    *   It then creates a record in the `skill_subscriptions` table with `is_in_trial = true`, `status = 'active'`, and `expires_at` set to `NOW() + trial_days`.

4.  **Update Access Control Logic:**
    *   The existing subscription check already verifies `status = 'active'` and `expires_at` > `NOW()`, so it will automatically grant access to users in their trial period.

5.  **UI for Conversion:**
    *   When a user is in a trial, the marketplace UI for that skill should change. Instead of "Purchase," it should show a message like "Trial active: X days remaining" and a button to "Subscribe Now."
    *   If the trial expires, the button reverts to "Subscribe." The access control logic will automatically block them until they pay.

## Code Example (Trial Activation Endpoint)

```javascript
// POST /api/skills/start-trial
export default wrap(async (req, res) => {
    // ... auth, validation for agent_id, skill_name
    const user = await getSessionUser(req);

    // 1. Check if skill offers a trial
    const [skillPrice] = await sql`
        SELECT trial_days FROM agent_skill_prices
        WHERE agent_id = ${agent_id} AND skill_name = ${skill_name} AND trial_days > 0
    `;
    if (!skillPrice) return error(res, 400, 'no_trial_offered');

    // 2. Check if user already had a subscription/trial for this skill
    const [existingSub] = await sql`
        SELECT id FROM skill_subscriptions WHERE ...
    `;
    if (existingSub) return error(res, 409, 'trial_already_used');

    // 3. Create the trial subscription record
    const expiresAt = new Date(Date.now() + skillPrice.trial_days * 24 * 60 * 60 * 1000);
    await sql`
        INSERT INTO skill_subscriptions (user_id, agent_id, skill_name, expires_at, status, is_in_trial)
        VALUES (${user.id}, ${agent_id}, ${skill_name}, ${expiresAt}, 'active', true)
    `;

    return json(res, 201, { success: true, expires_at: expiresAt });
});
```
