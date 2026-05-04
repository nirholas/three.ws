# Prompt 16: Update Chat UI for Purchased Skills

## Objective
Modify the chat UI to visually reflect when a user has purchased access to a premium skill, for example by changing an icon from a "lock" to an "unlock" state.

## Explanation
After a successful purchase, the user needs immediate visual feedback that their action was successful and the skill is now available. This improves user experience and reduces confusion.

## Instructions
1.  **Modify the Chat UI Component:**
    *   Open your main chat component file (e.g., `chat/src/App.svelte`).
    *   The component needs to maintain a state of which skills the user has purchased access to for the current agent. This could be a `Set` or an `object`.
        ```javascript
        let purchasedSkills = new Set();
        ```

2.  **Update State After Purchase:**
    *   In your `handlePaymentFlow` function from Prompt 11, upon successful confirmation from the backend, add the `skill_name` to your `purchasedSkills` set.
        ```javascript
        // Inside handlePaymentFlow, after successful confirmation
        purchasedSkills.add(paymentDetails.skill_name);
        purchasedSkills = purchasedSkills; // Trigger Svelte reactivity
        ```

3.  **Initial State Loading:**
    *   When a chat session starts, you should ideally fetch the user's current access grants for the agent from the backend so that previously purchased skills are already shown as unlocked.
    *   Create a new, simple backend endpoint `GET /api/agents/:id/my-skill-grants` that returns a list of skill names for which the current user has active grants.
    *   Call this endpoint when the chat loads and populate the `purchasedSkills` set.

4.  **Dynamically Render Skill UI:**
    *   Locate the part of your UI that displays available skills (perhaps in a sidebar or as suggestion chips).
    *   When rendering each skill, check if its name is in the `purchasedSkills` set.
    *   Use this check to conditionally apply a class or show a different icon.

## Code Example (Frontend - Svelte Component)

```svelte
<!-- Example of rendering a list of skills in the chat UI -->
<div class="skill-list">
  <h4>Available Skills</h4>
  {#each agent.skills as skill}
    {@const isLocked = skill.is_premium && !purchasedSkills.has(skill.name)}
    <div class="skill-chip" class:locked={isLocked}>
      {skill.name}
      {#if isLocked}
        <span>🔒</span>
      {:else if skill.is_premium}
        <span>✔️</span>
      {/if}
    </div>
  {/each}
</div>

<script>
  // ... existing script ...
  export let agent;
  let purchasedSkills = new Set();

  // Fetch initial grants on component mount
  import { onMount } from 'svelte';
  onMount(async () => {
    const res = await fetch(`/api/agents/${agent.id}/my-skill-grants`);
    if (res.ok) {
      const { granted_skills } = await res.json();
      purchasedSkills = new Set(granted_skills);
    }
  });

  // This function is called after a successful payment flow
  function onSkillPurchased(skillName) {
    purchasedSkills.add(skillName);
    purchasedSkills = purchasedSkills; // This forces Svelte to update the UI
  }
</script>

<style>
  .skill-chip.locked {
    opacity: 0.6;
    cursor: not-allowed;
    background-color: #333;
  }
  .skill-chip span {
    margin-left: 8px;
  }
</style>
```
