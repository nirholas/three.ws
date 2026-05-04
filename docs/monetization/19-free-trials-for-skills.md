---
status: not-started
---

# Prompt 19: Free Trials for Paid Skills

## Objective
Implement a "free trial" feature that allows users to try a paid skill for a limited time or a limited number of uses.

## Explanation
Free trials can significantly increase the conversion rate for paid skills by allowing users to experience their value before committing to a purchase.

## Instructions
1.  **Update Database Schema:**
    *   Add a `user_skill_trials` table to track active trials.
    *   This table would include `user_id`, `skill_name`, `start_date`, and `end_date` or `usage_count`.

2.  **Modify Access Control:**
    *   The access control middleware needs to be updated to check for active trials in addition to ownership.
    *   If a user has an active trial, they should be allowed to use the skill.

3.  **UI for Trials:**
    *   Update the marketplace UI to show a "Start Free Trial" button for eligible skills.
