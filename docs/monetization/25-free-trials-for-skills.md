# Prompt 25: Free Trials for Skills

## Objective
Implement a "free trial" mechanism that allows users to temporarily access a paid skill for a limited time or a limited number of uses before needing to purchase it.

## Explanation
Free trials are a highly effective way to convert users by letting them experience the value of a premium feature firsthand. This can be implemented using temporary, off-chain access tokens.

## Instructions
1.  **Database for Trials:**
    *   Create a `skill_trials` table.
    *   Columns should include `id`, `user_id`, `skill_name`, `agent_id`, `expiry_date` (for time-based trials) or `uses_remaining` (for usage-based trials).

2.  **UI to Start a Trial:**
    *   On the marketplace page, next to a paid skill, add a "Start Free Trial" button.

3.  **Backend API to Grant Trial:**
    *   Create an endpoint, `/api/skills/start-trial`.
    *   When a user clicks the button, this endpoint is called.
    *   It checks if the user has already had a trial for this skill.
    *   If not, it creates a new record in the `skill_trials` table for that user and skill, setting an `expiry_date` (e.g., 24 hours from now) or a `uses_remaining` count (e.g., 3).

4.  **Update Gating Logic:**
    *   Modify the `tryUseSkill` function from Prompt 9 and Prompt 18.
    *   This function now has a more complex order of checks:
        1.  Is the skill free? If yes, allow.
        2.  Does the user have an active subscription? If yes, allow.
        3.  Does the user have a valid NFT for the skill? If yes, allow.
        4.  **New:** Does the user have an active free trial for the skill?
            *   To check this, call a new backend endpoint `/api/skills/check-trial`.
            *   This endpoint checks the `skill_trials` table. If a valid trial exists, it decrements `uses_remaining` (if applicable) and returns `{"has_trial_access": true}`.
        5.  If all checks fail, deny access and prompt the user to purchase.

## Note on Security
Since trial status is stored in your central database (off-chain), this is less decentralized than NFT ownership but offers more flexibility for implementing complex trial logic (like limiting trials per IP address to prevent abuse).
