---
status: not-started
---
# Prompt 22: Skill Gating and Previews

**Status:** Not Started

## Objective
Allow creators to offer a limited "preview" or trial of a paid skill to encourage purchases.

## Explanation
Letting users try before they buy can significantly increase conversion rates. This feature involves defining what a "preview" means (e.g., 3 free uses) and implementing the logic to track and enforce this limit.

## Instructions
1.  **Backend: Modify the `agent_skill_prices` table.**
    - Add new columns: `is_trial_allowed BOOLEAN DEFAULT FALSE` and `trial_uses INTEGER DEFAULT 3`.
2.  **Backend: Create a new table `skill_trial_usage`.**
    - Columns: `id`, `agent_id`, `skill_id`, `uses_left`.
3.  **Backend: Update the skill execution logic (from Prompt 15).**
    - If a skill is paid and not purchased, check if a trial is allowed and if the agent has remaining trial uses.
    - If so, allow execution and decrement the `uses_left` in `skill_trial_usage`.
    - If uses are 0, block execution and message "Your trial for this skill has ended. Please purchase to continue."
4.  **Frontend: Update the Creator Dashboard** to allow creators to enable/disable trials for their skills.
5.  **Frontend: Update the Marketplace UI.**
    - Display a "Trial available" badge on skills that offer a preview.
    - When a user tries a skill, show how many uses are left.
