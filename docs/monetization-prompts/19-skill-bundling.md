# Prompt 19: Skill Bundles and Packages

**Status:** - [ ] Not Started

## Objective
Allow creators to bundle multiple skills together and sell them as a package, often at a discounted price compared to buying each skill individually.

## Explanation
Bundling is a common and effective marketing strategy. It increases the perceived value for customers and can lead to larger average transaction sizes. For example, a creator could offer a "starter pack" of their three most popular skills.

## Instructions
1.  **Database Schema for Bundles:**
    *   Create a `skill_bundles` table:
        *   Columns: `id`, `creator_id`, `name`, `description`, `price`, `currency_mint`.
    *   Create a `skill_bundle_items` table to link skills to bundles:
        *   Columns: `id`, `bundle_id`, `skill_name`, `agent_id`.

2.  **UI for Creating Bundles:**
    *   In the creator's dashboard or agent edit page, add an interface for "Create a Skill Bundle".
    *   The creator should be able to:
        *   Give the bundle a name and description.
        *   Select which of their skills to include.
        *   Set a single price for the entire bundle.

3.  **Display Bundles in the Marketplace:**
    *   On the agent detail page, in addition to individual skills, display any bundles offered by the creator.
    *   Each bundle listing should show the included skills and the bundle price.
    *   The UI should clearly show the savings compared to buying the skills individually.

4.  **Handle Bundle Purchases:**
    *   The purchase flow for a bundle is similar to a single skill.
    *   When the backend's `purchase-skill` endpoint is adapted to handle bundles (e.g., a new `purchase-bundle` endpoint), it must:
        *   Verify the single payment for the bundle.
        *   Add a record to the `user_agent_skills` table for *each* skill included in the bundle.

## Code Example (Conceptual - `purchase-bundle` backend endpoint)

```javascript
export default async function handler(req, res) {
  const userId = req.user.id;
  const { bundleId, transactionSignature } = req.body;

  const db = getDB();
  const bundle = await db.getBundle(bundleId);
  
  // 1. Verify the transaction for the bundle's price
  // ... (similar to single skill verification)

  if (verificationSuccess) {
    // 2. Get all skills included in the bundle
    const skillsInBundle = await db.getSkillsInBundle(bundleId);

    // 3. Record ownership for each skill in the bundle
    for (const item of skillsInBundle) {
      await db.recordSkillPurchase(userId, item.agent_id, item.skill_name);
    }
    
    res.status(200).json({ success: true, message: 'Bundle purchased!' });
  } else {
    // ... handle error
  }
}
```
