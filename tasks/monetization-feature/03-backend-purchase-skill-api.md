---
status: not-started
---
# Prompt 3: Backend for Skill Purchase

**Status:** Not Started

## Objective
Create the backend API endpoint and logic to handle a user's purchase of an agent skill using Solana Pay.

## Explanation
When a user clicks the "Purchase" button, the frontend will need to request a transaction from the backend. The backend will construct a Solana transaction, sign it, and send it back to the frontend for the user to approve and send to the network.

## Instructions
1.  **Create a New API Endpoint:**
    *   Create a new file or use the existing router to handle `POST /api/payments/purchase-skill`.
    *   This endpoint should expect an `agentId` and `skillName` in the request body.
2.  **Input Validation:**
    *   Verify the user is authenticated.
    *   Check that the agent and skill exist.
    *   Fetch the skill price from the `agent_skill_prices` table. Ensure the skill is actually for sale.
    *   Verify the user does not already own this skill.
3.  **Construct the Solana Transaction:**
    *   Use the Solana Web3.js library (`@solana/web3.js`).
    *   Create a transaction to transfer the correct amount of USDC (or other currency) from the user's wallet to the agent creator's wallet.
    *   You will need the agent creator's wallet address, which should be stored with the agent's data.
    *   The transaction should include a memo instruction with the skill name and agent ID for record-keeping.
4.  **Record the Transaction:**
    *   Before returning to the user, record the pending transaction in a database table (`skill_purchases`). Mark its status as "pending".
    *   Include the transaction signature.
5.  **Return the Transaction:**
    *   Serialize the transaction and send it back in the API response. The frontend will then prompt the user to sign and submit it.
    *   You will need a separate webhook or confirmation listener to update the purchase status from "pending" to "completed" once the transaction is confirmed on the blockchain.

## API Endpoint (`/api/payments/purchase-skill`)

*   **Method:** `POST`
*   **Body:**
    ```json
    {
      "agentId": "agent_id_here",
      "skillName": "skill_name_here",
      "userWallet": "user_public_key_here"
    }
    ```
*   **Success Response (200):**
    ```json
    {
      "transaction": "base64_serialized_transaction_here",
      "signature": "transaction_signature_here"
    }
    ```
*   **Error Response (400/500):**
    ```json
    {
      "error": "Descriptive error message."
    }
    ```
