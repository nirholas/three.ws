---
status: not-started
---

# Prompt 6: UI/UX - Design the Skill Purchase Modal

## Objective
Design a clear, user-friendly modal for purchasing skills, which will serve as the blueprint for frontend implementation.

## Explanation
A well-designed purchase modal is critical for conversion. It needs to be simple, trustworthy, and provide all necessary information at a glance. Before writing code, we should define the components and layout of this modal. This design task ensures that the subsequent implementation is fast and aligned with the user's needs.

## Instructions
1.  **Sketch the Modal Layout:**
    *   Create a wireframe or a simple mockup of the purchase modal. This can be done with a tool like Figma, or even a drawing on paper.
    *   The modal should be triggered by clicking on a paid skill.

2.  **Define Modal Components:**
    *   The modal must include:
        *   **Header:** "Purchase Skill: [Skill Name]"
        *   **Skill Description:** A brief explanation of what the skill does.
        *   **Price Display:** The price in a clear format (e.g., "5.00 USDC").
        *   **Creator Info:** The name or avatar of the skill creator.
        *   **Call to Action (CTA):** A primary button like "Purchase with Solana Pay" or "Buy Now".
        *   **Balance Check (Optional but Recommended):** Display the user's current USDC balance.
        *   **Close Button:** An 'X' in the corner to dismiss the modal.
        *   **Status Area:** A space to show transaction progress (e.g., "Generating QR Code...", "Awaiting Confirmation...").

3.  **Document the User Flow:**
    *   Describe the steps a user takes:
        1.  User clicks a paid skill.
        2.  The purchase modal appears.
        3.  User clicks "Purchase".
        4.  A Solana Pay QR code is displayed.
        5.  User scans with their wallet and approves.
        6.  The modal shows a confirmation message.
        7.  The modal closes, and the UI updates to show the skill as "Owned".

## Design Mockup Example

(This can be a simple text-based layout or a link to a visual design)

```
+-------------------------------------------------+
| Purchase Skill: Rug-Pull Detection         [X]  |
+-------------------------------------------------+
|                                                 |
| Flags high-risk tokens using on-chain data to   |
| help you avoid potential scams.                 |
|                                                 |
| Created by: @skill_creator_1                    |
|                                                 |
| ----------------------------------------------- |
|                                                 |
| Price:              5.00 USDC                   |
| Your Balance:       23.45 USDC                  |
|                                                 |
+-------------------------------------------------+
| [ Purchase with Solana Pay ]                    |
|                                                 |
| Status: Waiting for user action...              |
+-------------------------------------------------+
```
This design document will guide the implementation in the next prompt.
