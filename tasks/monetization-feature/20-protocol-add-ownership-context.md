---
status: not-started
---

# Prompt 20: Update Agent Protocol

**Status:** Not Started

## Objective
Enhance the agent protocol to include information about skill ownership, allowing the agent itself to be aware of monetization.

## Explanation
While skill usage is gated on the backend API, it can be beneficial for the agent's internal logic to know if a skill is premium and if the current user owns it. This could allow for more nuanced interactions, like the agent saying, "You'll need to purchase my 'Advanced Analysis' skill for that, which you can do from my profile."

## Instructions
- [ ] **Locate the agent protocol definition** or the place where the agent's context is built (likely in the main chat/action API endpoint).
- [ ] **Add Ownership Data to Context:**
    - [ ] When building the context to send to the agent (or the LLM), include a new key, `skill_ownership`.
    - [ ] This object should map skill names to a boolean indicating if the current user owns them.
    - [ ] This requires the data from the checks performed in Prompt 8.
- [ ] **Update Agent's System Prompt:**
    - [ ] Modify the agent's core system prompt to inform it about this new context.
    - [ ] Instruct the agent on how to behave. For example: "If the user asks to perform a premium skill they do not own, you should politely inform them that the skill is for purchase and direct them to your agent profile page."

## Code Example (Conceptual - Backend adding to context)

```javascript
// In the API endpoint that calls the LLM

// ... after performing ownership checks from Prompt 8 ...
const skillOwnership = {};
for (const skill of agent.skills) {
    const price = agent.skill_prices[skill.name];
    if (price) {
        const isOwned = await hasUserPurchased(user.id, agent.id, skill.name);
        skillOwnership[skill.name] = { is_premium: true, is_owned: isOwned };
    } else {
        skillOwnership[skill.name] = { is_premium: false, is_owned: true }; // Free skills are "owned"
    }
}

// Add this to the context/prompt sent to the LLM
const llmContext = {
    // ... other context
    skill_ownership: skillOwnership,
};

const systemPrompt = `You are an agent. You have skills. Some may be premium.
The following JSON shows your skills and if the user owns them:
${JSON.stringify(llmContext.skill_ownership)}
If a user tries to use a skill where is_premium is true but is_owned is false, you must decline and tell them it's a paid skill.`

// ... call LLM with the new prompt and context ...
```
