---
status: not-started
---

# Prompt 15: "Pay What You Want" Pricing

**Status:** Not Started

## Objective
Allow creators to set a skill as "Pay What You Want" (PWYW), optionally with a minimum price.

## Explanation
PWYW can be a powerful tool for community engagement and can sometimes lead to higher revenue than a fixed price.

## Instructions
- [ ] **Modify the `agent_skill_prices` table.**
    - Add a `pricing_type` of `pwyw`.
    - Add a `minimum_amount` column (can be 0).
- [ ] **Update the creator dashboard.**
    - Add "Pay What You Want" as a pricing option.
    - If selected, allow setting a minimum price.
- [ ] **Update the UI on the agent detail page.**
    - For PWYW skills, instead of a "Buy" button, show an input field for the amount and a "Pay" button.
    - Client-side validation should ensure the entered amount is not below the minimum.
- [ ] **Update the purchase API (`/api/skills/purchase`).**
    - It should now accept an optional `amount` in the request body for PWYW skills.
    - The backend must validate that this amount is above the `minimum_amount`.
    - The transaction is then constructed with the user-defined amount.
