---
status: not-started
---

# Prompt 14: Skill Bundles

**Status:** Not Started

## Objective
Allow creators to sell multiple skills together as a discounted bundle.

## Explanation
Bundles can increase the average revenue per user. A creator could offer a "Pro Pack" of 3 skills at a lower price than buying them individually.

## Instructions
- [ ] **Create new database tables:**
    - `skill_bundles`: to store bundle details (`id`, `agent_id`, `name`, `price`, `currency_mint`).
    - `bundle_skills`: a join table linking bundles to skills (`bundle_id`, `skill_name`).
- [ ] **Update the creator dashboard.**
    - Add a new section for creating and managing bundles.
    - A creator should be able to create a bundle, give it a name, set a price, and select which of their existing skills to include.
- [ ] **Update the marketplace UI.**
    - Display bundles on the agent detail page.
    - A "Buy Bundle" button should trigger a purchase flow similar to a single skill.
- [ ] **Update the purchase and access logic.**
    - When a bundle is purchased, grant access to *all* skills within that bundle in the `user_skill_access` table.
