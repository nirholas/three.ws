# Prompt 8: Detect Paid Skill Usage in Chat

## Objective
In the chat interface, implement logic to detect when a user attempts to use a skill that requires payment.

## Explanation
This is the entry point for the payment flow within the chat itself. When the user's prompt is interpreted by the AI and mapped to a specific skill, the system needs to check if that skill has an associated price before attempting to execute it.

## Instructions
1.  **Modify Chat Backend/Orchestrator:**
    *   Identify the part of your application that receives the AI model's response, which indicates the intent to use a skill. This could be in `/api/chat.js` or a similar backend orchestrator.
    *   Before executing the skill, this orchestrator needs access to the agent's skill pricing information.
    *   When fetching the agent's details at the beginning of a chat session, make sure to also fetch its `skill_prices` (as implemented in Prompt 1) and keep them available in the session's context.

2.  **Implement the Price Check:**
    *   After the AI model decides which skill to use (e.g., `skill_name: "generate-image"`), but *before* executing the skill's logic, perform a check:
        ```javascript
        const skillPrices = agent.skill_prices || {};
        const price = skillPrices[skillToExecute.name];

        if (price && price.amount > 0) {
            // This is a paid skill.
            // Halt execution and proceed to the payment flow.
        } else {
            // This is a free skill.
            // Proceed with normal execution.
        }
        ```

3.  **Check for Existing Access Grants:**
    *   Before flagging a skill as needing payment, you must first check if the user *already has access*. This requires a new database lookup.
    *   Query the `skill_access_grants` table (which will be created in a later prompt) for a valid grant for the current `user_id`, `agent_id`, and `skill_name`.
    *   A grant is valid if `expires_at` is in the future or `uses_left` is greater than 0.
    *   If a valid grant exists, treat the skill as free and proceed with execution. If not, proceed to the payment flow.

4.  **Signal to the Frontend:**
    *   If payment is required, the backend should not execute the skill. Instead, it must send a specific message back to the chat UI.
    *   This can be a special message type in your WebSocket or SSE stream, or a structured JSON response via HTTP.
    *   The message must contain the necessary information to render a payment modal: `skill_name`, `amount`, `currency_mint`.

## Code Example (Backend - `/api/chat.js` or similar)

```javascript
// Inside the main chat processing logic, after receiving the AI's intent to use a skill

async function processUserMessage(message, agent, user) {
    // ... logic to get AI response ...
    const { skillToExecute, parameters } = ai.interpret(message);

    if (skillToExecute) {
        const skillPrices = agent.skill_prices || {};
        const price = skillPrices[skillToExecute.name];

        if (price && price.amount > 0) {
            // Paid skill detected. First, check if user already has access.
            const hasAccess = await db.checkForValidSkillGrant({
                userId: user.id,
                agentId: agent.id,
                skillName: skillToExecute.name
            });

            if (!hasAccess) {
                // No access. Signal to frontend to start payment flow.
                return {
                    type: 'payment_required',
                    data: {
                        skill_name: skillToExecute.name,
                        amount: price.amount,
                        currency_mint: price.currency_mint
                    }
                };
            }
            // User has access, fall through to execution.
        }
        
        // Free skill or user has access, execute it.
        const result = await executeSkill(skillToExecute.name, parameters);
        return { type: 'message', data: { text: result } };
    }
    
    // ... handle regular text response ...
}
```
