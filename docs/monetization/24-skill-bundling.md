# Prompt 24: Skill Bundling

## Objective
Allow creators to bundle multiple skills together for a single, often discounted, price.

## Explanation
Bundles are a classic marketing strategy. They increase the average transaction value for creators and provide better value for users who want to acquire multiple skills from a single agent.

## Instructions
1.  **Database Schema for Bundles:**
    *   Create a `skill_bundles` table. Columns should include `id`, `agent_id`, `name`, `price`, `currency_mint`.
    *   Create a `bundle_items` table to link bundles to skills. Columns: `id`, `bundle_id`, `skill_name`.

2.  **UI for Creating Bundles:**
    *   In the creator dashboard, add a new section for "Manage Bundles."
    *   Here, a creator can create a new bundle, give it a name and price, and select which of their existing skills to include in it.

3.  **Backend API for Bundles:**
    *   Create CRUD endpoints (`/api/agents/:id/bundles`) for creating, updating, and deleting skill bundles.

4.  **Display Bundles in Marketplace:**
    *   On the agent detail page, display any available bundles, perhaps in their own section above the individual skills.
    *   Each bundle should show its name, price, and the list of skills included.
    *   Add a "Purchase Bundle" button.

5.  **Purchase Logic for Bundles:**
    *   When a bundle is purchased, the payment logic is the same (transferring the bundle price).
    *   However, the minting logic is different. After the payment is confirmed, the `/api/skills/mint` endpoint must be called in a loop, once for **each skill** included in the bundle, minting multiple NFTs to the user's wallet.

## Code Example (UI Concept on Marketplace Page)
```html
<div class="bundle-card">
  <h3>The 'Dancer's Pack' Bundle</h3>
  <p class="bundle-price">5.00 USDC (Save 20%)</p>
  <ul class="bundle-contents">
    <li>Skill: ballet</li>
    <li>Skill: hip_hop</li>
    <li>Skill: tango</li>
  </ul>
  <button class="purchase-bundle-btn" data-bundle-id="123">Purchase Bundle</button>
</div>
```
