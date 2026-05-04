---
status: not-started
---

# Prompt 24: Skill Bundles

## Objective
Implement a "Skill Bundle" feature, allowing creators to sell a group of skills together, often at a discounted price.

## Explanation
Bundles are a powerful sales tool. They increase the average transaction value and provide a convenient way for users to acquire a suite of related skills. This requires a new database structure to define bundles and updates to both the backend and frontend.

## Instructions
1.  **Database Schema:**
    *   Create a new table: `agent_skill_bundles`.
        *   Columns: `id`, `agent_id`, `name`, `description`, `price_amount`, `price_currency_mint`.
    *   Create a linking table: `bundle_skills`.
        *   Columns: `bundle_id` (foreign key to `agent_skill_bundles`), `skill_name`.

2.  **Creator UI for Bundles:**
    *   In the `agent-edit.html` page, add a new section for "Skill Bundles".
    *   Provide a UI for creators to:
        *   Create a new bundle (giving it a name, description, and price).
        *   Select which of the agent's existing skills to include in the bundle (e.g., using a multi-select list or checkboxes).
        *   View, edit, and delete existing bundles.

3.  **Backend API for Bundles:**
    *   Create CRUD API endpoints for managing bundles (e.g., `POST /api/agents/:id/bundles`, `PUT /.../:bundleId`, etc.), similar to the subscription tier APIs.
    *   These endpoints will manage the `agent_skill_bundles` and `bundle_skills` tables.

4.  **Frontend Display:**
    *   On the agent detail page, display a new section for "Bundles".
    *   Render a card for each available bundle, showing its name, price, and the list of skills included.
    *   Add a "Buy Bundle" button.

5.  **Purchase Flow:**
    *   The purchase flow for a bundle will be nearly identical to a single skill purchase.
    *   The backend transaction endpoint will receive a `bundleId` instead of a `skillName`.
    *   Upon successful payment verification, the backend must add a separate entry in the `user_unlocked_skills` table for *each skill* included in the purchased bundle. This ensures the skill-gating mechanism works without modification.

## Code Example (Frontend Bundle Card)

```html
<!-- Inside the new "Bundles" section on the agent detail page -->
<div class="bundle-card">
  <div class="bundle-name">Master Collection</div>
  <div class="bundle-price">10.00 USDC</div>
  <ul class="bundle-skills-list">
    <li>Advanced Analysis</li>
    <li>Market Prediction</li>
    <li>Auto-Trading</li>
  </ul>
  <p class="bundle-description">Get all the essential trading skills in one package!</p>
  <button class="buy-button">Buy Bundle</button>
</div>
```

## Code Example (Backend - Purchase Verification Logic)

```javascript
// Inside your purchase verification endpoint, when a bundleId is detected
async function unlockSkillsForBundle(userId, bundleId, transactionSignature) {
    // 1. Get all skill names associated with this bundle
    const skillsResult = await db.query(
      'SELECT skill_name FROM bundle_skills WHERE bundle_id = $1',
      [bundleId]
    );
    const skillsToUnlock = skillsResult.rows.map(r => r.skill_name);

    // Get the agent_id from the bundle
    const bundleResult = await db.query('SELECT agent_id FROM agent_skill_bundles WHERE id = $1', [bundleId]);
    const agentId = bundleResult.rows[0].agent_id;

    // 2. Insert a record for each skill into the user's unlocked skills
    // Use a transaction for atomicity
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        for (const skillName of skillsToUnlock) {
            await client.query(
                `INSERT INTO user_unlocked_skills (user_id, agent_id, skill_name, transaction_signature)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [userId, agentId, skillName, transactionSignature]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e; // Propagate error
    } finally {
        client.release();
    }
}
```
