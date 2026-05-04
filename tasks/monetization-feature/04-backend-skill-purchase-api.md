---
status: not-started
---

# Prompt 4: Backend - Skill Purchase API

**Status:** Not Started

## Objective
Create the backend infrastructure for users to purchase access to a paid skill. This involves creating a Solana Pay-compatible API endpoint.

## Explanation
When a user wants to use a paid skill, our platform needs to facilitate the transaction. We will create a Solana Pay endpoint that, when called, returns the details of the transaction that the user needs to sign and send.

## Instructions
- [ ] **Create a new API endpoint, e.g., `POST /api/skills/purchase`**.
- [ ] **Define the request body.** It should include:
    - `agent_id`: The ID of the agent whose skill is being purchased.
    - `skill_name`: The name of the skill.
    - `account`: The user's Solana public key.
- [ ] **Implement the endpoint logic:**
    - 1. **Fetch skill price:** Look up the price of the skill in the `agent_skill_prices` table.
    - 2. **Construct the transaction:** Create a Solana transaction that transfers the specified `amount` of the `currency_mint` from the user's `account` to the agent creator's wallet.
    - 3. **Add a memo:** Include a memo in the transaction to identify the purchase (e.g., "Purchase of skill 'text-to-speech' for agent 'AI Assistant'").
    - 4. **Serialize the transaction:** The transaction should be partially signed (if necessary) and serialized.
    - 5. **Return the Solana Pay response:** The response should follow the Solana Pay specification, including the serialized `transaction` and a `message`.

## Solana Pay
Refer to the official [Solana Pay documentation](https://docs.solanapay.com/spec) for the exact request and response formats. This will ensure compatibility with Solana wallets.
