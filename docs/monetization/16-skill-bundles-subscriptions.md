---
status: not-started
---

# Prompt 16: Skill Bundles & Subscriptions

## Objective
Introduce the ability for creators to sell bundles of skills or offer a monthly subscription for access to all their skills.

## Explanation
This is an advanced monetization feature that provides more value to users and more revenue opportunities for creators.

## Instructions
1.  **Update Database Schema:**
    *   Add new tables to support skill bundles and subscriptions.
    *   A `skill_bundles` table would define which skills are in a bundle and the price.
    *   A `user_subscriptions` table would track active user subscriptions.

2.  **Modify UI:**
    *   Update the creator UI to allow them to create and manage bundles/subscriptions.
    *   Update the marketplace UI to display these new purchasing options.

3.  **Implement Recurring Payments:**
    *   For subscriptions, you will need a system to handle recurring payments. This is complex on a blockchain and might require a service like Streamflow or a custom smart contract.
