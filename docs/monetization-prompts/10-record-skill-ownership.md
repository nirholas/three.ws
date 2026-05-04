---
status: not-started
---

# Prompt 10: Record Skill Ownership in Database

## Objective
Create the database schema and logic to record that a user has successfully purchased and unlocked a skill.

## Explanation
After a transaction is successfully verified, the final step on the backend is to persist the user's ownership of the skill. This record will be the source of truth for all future checks, such as gating skill usage and updating the marketplace UI.

## Instructions
- [ ] **Design and Create a New Database Table:**
    - [ ] Create a new table named `unlocked_skills` (or similar).
    - [ ] It should contain, at a minimum, the following columns:
        - [ ] `id` (Primary Key)
        - [ ] `user_id` (Foreign Key to your `users` table)
        - [ ] `agent_id` (Foreign Key to your `agents` table)
        - [ ] `skill_name` (String)
        - [ ] `purchase_transaction_signature` (String, for auditing)
        - [ ] `created_at` (Timestamp)
    - [ ] Consider adding a unique constraint on `(user_id, agent_id, skill_name)` to prevent duplicate entries.

- [ ] **Implement the Database Insertion Logic:**
    - [ ] In your backend verification endpoint (`/api/skills/purchase/verify`), after all the checks have passed, add the code to insert a new row into the `unlocked_skills` table.
    - [ ] Pass the authenticated user's ID, the agent ID, the skill name, and the transaction signature to the database query.

- [ ] **Update Agent Details API to Include Ownership:**
    - [ ] Modify the main API that fetches agent details for the marketplace (`/api/marketplace/agents/:id`).
    - [ ] When a user requests this endpoint, it should now also query the `unlocked_skills` table to see which skills that specific user owns for that agent.
    - [ ] Include this ownership information in the API response, perhaps as an array of skill names: `unlocked_skills: ["skill1", "skill2"]`.

- [ ] **Update Frontend to Use Ownership Data:**
    - [ ] In `src/marketplace.js`, when you receive the agent details, use the new `unlocked_skills` array.
    - [ ] In your skill rendering loop, set the `isOwned` variable based on whether the current skill's name is in this array. This will now correctly show the "Purchase" or "Unlocked" button.

## SQL Schema Example

```sql
CREATE TABLE unlocked_skills (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    skill_name VARCHAR(255) NOT NULL,
    purchase_transaction_signature VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, agent_id, skill_name)
);
```

## Frontend Code Example (`src/marketplace.js`)

```javascript
// Inside renderDetail function, after fetching agent 'a'
const unlockedSkills = a.unlocked_skills || [];

// Inside the skillsArr.map loop
const name = s.name || '';
const price = a.skill_prices[name];

if (price) {
    const isOwned = unlockedSkills.includes(name); // <-- This is the new logic
    // ... rest of the button rendering logic
}
```
