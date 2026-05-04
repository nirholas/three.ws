# Prompt 9: Frontend Gating for Skills

## Objective
Implement a check in the frontend UI that calls the backend verification endpoint before allowing a user to use a paid skill.

## Explanation
This is the user-facing part of the access control system. When a user tries to interact with a paid skill (e.g., clicking a button in the chat interface that triggers the skill), the frontend must first confirm they have the right to do so.

## Instructions
1.  **Identify Skill Triggers:**
    *   Go through the chat UI or agent interaction logic and identify all the points where a skill is triggered.

2.  **Create a Central Skill Dispatcher:**
    *   Instead of triggering skills directly, create a central function, e.g., `tryUseSkill(skillName)`.
    *   This function will be responsible for handling the gating logic.

3.  **Implement the Check:**
    *   Inside `tryUseSkill`, first determine if the skill is free or paid by checking the agent's `skill_prices` data.
    *   If the skill is free, execute it immediately.
    *   If the skill is paid, call the `/api/skills/verify-ownership` endpoint you created in the previous step.
    *   Based on the `has_access` response:
        *   If `true`, execute the skill.
        *   If `false`, show a message to the user, e.g., "You need to purchase this skill to use it," and provide a link or button to the marketplace page.

4.  **Cache Verification Results:**
    *   To avoid calling the verification endpoint every single time, cache the results on the frontend for the duration of the user's session. A simple JavaScript object or `sessionStorage` can work for this.

## Code Example (Frontend Skill Dispatcher)
```javascript
const skillAccessCache = {};

async function tryUseSkill(skillName) {
    const agent = getCurrentAgentData();
    const isPaid = skillName in agent.skill_prices;

    if (!isPaid) {
        executeSkill(skillName);
        return;
    }

    // Check cache first
    if (skillAccessCache[skillName]) {
        executeSkill(skillName);
        return;
    }

    // If not in cache, verify with backend
    const userWallet = wallet.publicKey.toBase58(); // from wallet adapter
    const response = await fetch(`/api/skills/verify-ownership?user_wallet=${userWallet}&agent_id=${agent.id}&skill_name=${skillName}`);
    const data = await response.json();

    if (data.has_access) {
        skillAccessCache[skillName] = true; // Update cache
        executeSkill(skillName);
    } else {
        showPurchasePrompt(skillName); // UI function to tell user to buy the skill
    }
}

// Example usage:
// Instead of `runDanceSkill()`, you'd call `tryUseSkill('dance')`.
```
