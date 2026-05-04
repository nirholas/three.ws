---
status: not-started
---

# Prompt 6: Backend - Skill Access Control

**Status:** Not Started

## Objective
Implement a mechanism to check if a user has purchased a skill before allowing them to use it.

## Explanation
Once a user has purchased a skill, our backend needs to enforce that only paying users can access it. This involves adding an access control check to the API endpoint that executes a skill.

## Instructions
- [ ] **Create a new database table: `user_skill_access`**. It should contain:
    - `id`: Primary key.
    - `user_id`: Foreign key to the user.
    - `agent_id`: Foreign key to the agent.
    - `skill_name`: The name of the skill.
    - `expires_at`: A timestamp for subscription-based access (optional for now).
- [ ] **After a successful purchase, record the access in this table.** The purchase confirmation step should write a new entry to `user_skill_access`.
- [ ] **Locate the API endpoint that executes skills** (e.g., `/api/agent/invoke`).
- [ ] **Before executing a skill, add a check:**
    - 1. Is the skill a paid skill? Look up its price.
    - 2. If it is paid, does the user have a valid entry in the `user_skill_access` table?
    - 3. If the user does not have access, return a `402 Payment Required` error with a message like "You need to purchase this skill to use it."
    - 4. If the user has access, proceed with executing the skill.

## 402 Payment Required
Using the `402` HTTP status code is the standard way to indicate that a resource is behind a paywall. This is a key part of the [x402 protocol](https://402.wtf/).
