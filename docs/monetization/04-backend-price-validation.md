# Prompt 4: Backend Price Validation Logic

## Objective
Implement robust server-side validation for skill prices to ensure data integrity and prevent invalid pricing information from being stored.

## Explanation
While the frontend can guide users, the backend must be the ultimate authority on data validity. This prompt focuses on strengthening the `POST /api/agents/:id/skills/price` endpoint by adding comprehensive validation logic for the incoming price data.

## Instructions
1.  **Locate the API Endpoint:**
    *   Open the file for the `POST /api/agents/:id/skills/price` endpoint (e.g., `api/agents/[id]/skills/price.js`).

2.  **Enhance Validation Logic:**
    *   Before interacting with the database, ensure the request body contains all required fields (`skill_name`, `amount`, `currency_mint`).
    *   **Amount Validation:**
        *   Verify that `amount` is a non-negative integer. Floating-point numbers or negative values should be rejected with a `400 Bad Request` error.
        *   Consider setting a maximum allowed price to prevent abuse or user error (e.g., max 100,000,000,000 lamports or 100,000 USDC).
    *   **Currency Mint Validation:**
        *   Check if `currency_mint` is a valid Solana public key.
        *   For now, you might enforce that it must be the official USDC mint address on the target network (Mainnet or Devnet). Create a whitelist of accepted mints.
    *   **Skill Name Validation:**
        *   Verify that the `skill_name` provided in the request actually corresponds to a real skill defined in the agent's configuration. If not, reject the request.

3.  **Return Specific Error Messages:**
    *   Provide clear and specific error messages in the JSON response when validation fails. This helps the frontend display meaningful error feedback to the user.
    *   Example error responses:
        *   `{ "error": "Amount must be a non-negative integer." }`
        *   `{ "error": "Invalid currency mint address." }`
        *   `{ "error": "Skill 'invalid-skill' not found for this agent." }`

## Code Example (Backend - API Endpoint)

```javascript
// Inside your /api/agents/:id/skills/price endpoint handler

// Whitelist of accepted currency mints
const ALLOWED_CURRENCIES = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC Mainnet
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',   // USDC Devnet
};
const MAX_PRICE_LAMPORTS = 100000 * 1e6; // Max 100,000 USDC

// --- Inside the handler function, after auth ---

const { skill_name, amount, currency_mint } = req.body;

// 1. Basic field presence
if (!skill_name || amount == null || !currency_mint) {
  return res.status(400).json({ error: 'Missing required fields: skill_name, amount, currency_mint' });
}

// 2. Amount validation
if (!Number.isInteger(amount) || amount < 0) {
  return res.status(400).json({ error: 'Amount must be a non-negative integer.' });
}
if (amount > MAX_PRICE_LAMPORTS) {
  return res.status(400).json({ error: `Price cannot exceed ${MAX_PRICE_LAMPORTS / 1e6} USDC.` });
}

// 3. Currency mint validation
const network = process.env.SOLANA_NETWORK || 'mainnet'; // Or however you determine the network
if (currency_mint !== ALLOWED_CURRENCIES[network]) {
  return res.status(400).json({ error: 'Invalid or unsupported currency.' });
}

// 4. Skill name validation (assuming agent object has a skills array)
const agent = await db.getAgentById(agentId); // You should have this from auth step
const agentSkills = agent.meta?.skills || []; // Adjust based on your agent data structure
if (!agentSkills.some(s => (typeof s === 'string' ? s : s.name) === skill_name)) {
  return res.status(400).json({ error: `Skill '${skill_name}' is not defined for this agent.` });
}

// If all checks pass, proceed to database logic...
```
