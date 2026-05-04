---
status: not-started
---

# Prompt 13: Free Trials for Skills

**Status:** Not Started

## Objective
Allow creators to offer a limited-time free trial for their paid skills.

## Explanation
Free trials are a great way for users to experience the value of a premium skill before committing to a purchase. We can implement this by granting temporary access.

## Instructions
- [ ] **Modify the `agent_skill_prices` table.**
    - Add a `trial_period_days` column.
- [ ] **Update the creator dashboard UI.**
    - Add a checkbox and an input field for creators to enable a free trial and set its duration.
- [ ] **On the agent detail page, show a "Start Free Trial" button** for skills that have one.
- [ ] **When a user clicks "Start Free Trial":**
    - Make an API call to a new endpoint (e.g., `POST /api/skills/start-trial`).
    - This endpoint adds an entry to the `user_skill_access` table with an `expires_at` date set to `now() + trial_period_days`. It should also record that this is a trial.
    - Add a `is_trial` boolean column to `user_skill_access`. A user should only be ableto start a trial for a specific skill once.
- [ ] **The access control logic will now automatically handle trial access** due to the `expires_at` check.
