---
status: not-started
---

# Prompt 7: UI - Handling 402 Payment Required

**Status:** Not Started

## Objective
Update the frontend to gracefully handle the `402 Payment Required` error from the backend and guide the user to purchase the skill.

## Explanation
When a user tries to use a paid skill they don't own, the backend will block them. The UI should catch this specific error and show a helpful message, such as a popup that prompts them to buy the skill.

## Instructions
- [ ] **In the part of your frontend code that calls the skill execution endpoint, add error handling.**
- [ ] **Specifically check for a `402` status code in the response.**
- [ ] **If a `402` error is received:**
    - 1. **Prevent the default error message** from being shown.
    - 2. **Display a modal or a notification** to the user.
    - 3. **The message should be clear,** e.g., "This is a premium skill. To use it, you need to purchase it first."
    - 4. **Include a "Purchase Skill" button** in the modal, which should trigger the purchase flow designed in a previous prompt.
    - 5. **Optionally, include a "Cancel" button** to close the modal.

## User Experience
This is a critical part of the user experience. Instead of a generic "Error" message, we are creating a clear call to action that guides the user through the monetization funnel.
