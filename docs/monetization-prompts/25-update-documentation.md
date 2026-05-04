# Prompt 25: Update Documentation for Monetization Feature

## Objective
Update the project's main `README.md` and create a new document in `docs/` to explain the skill monetization feature to both users and new developers.

## Explanation
A feature is not complete until it's documented. We need to explain how the monetization system works, how creators can sell their skills, and how users can buy them. This makes the feature discoverable and understandable.

## Instructions
1.  **Create a New Monetization Document:**
    *   Create a new file: `docs/monetization.md`.
    *   In this file, provide a detailed overview of the feature:
        *   **For Creators:** Explain how to set a price for a skill, the fee structure (if any), and how to withdraw earnings.
        *   **For Users:** Explain how to buy skills, what on-chain ownership means (if NFTs are implemented), and where to view their purchases.
        *   **Technical Details:** Briefly describe the Solana Pay integration and the role of the database tables.

2.  **Update the Main `README.md`:**
    *   Open `README.md`.
    *   Add a new section, perhaps under "Key Features", titled "Skill Monetization".
    *   Write a brief, exciting paragraph summarizing the feature.
    *   Link to the new `docs/monetization.md` file for more details.

3.  **Update Table of Contents:**
    *   Add "Skill Monetization" to the table of contents in the `README.md`.

## Example Text for `README.md`

```markdown
---

## Key Features

...

**Skill Monetization**
Creators can now earn revenue by selling their custom agent skills directly in the marketplace. Using a seamless Solana Pay integration, users can purchase skills with USDC, unlocking new capabilities for their agents. This creates a vibrant economy where developers are rewarded for building powerful extensions to the 3D-Agent ecosystem. [Learn more in our monetization guide...](docs/monetization.md)

...

---
```
