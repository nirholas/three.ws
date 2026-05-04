---
status: not-started
---

# Prompt 11: API Security for Purchase Flow

## Objective
Implement essential security measures, including user authentication and input validation, for all monetization-related API endpoints.

## Explanation
Monetization APIs handle real money and user entitlements, making them a prime target for abuse. It's critical to ensure that only authenticated users can make purchases for themselves and that all incoming data is sanitized and validated to prevent exploits.

## Instructions
- [ ] **Implement User Authentication Middleware:**
    - [ ] Ensure all monetization endpoints (`/api/transactions/*`, `/api/skills/purchase/*`) are protected by an authentication middleware.
    - [ ] This middleware should verify the user's session (e.g., via a JWT token, session cookie, or API key).
    - [ ] If the user is not authenticated, the request should be rejected with a `401 Unauthorized` error.
    - [ ] The authenticated user's data (especially `user_id` and `publicKey`) should be attached to the request object for later use.

- [ ] **Enforce Authorization:**
    - [ ] A user should only be able to purchase skills for their own account. The `user_id` used when recording skill ownership should come from the secure session, *not* from the request body.

- [ ] **Implement Input Validation:**
    - [ ] For every monetization endpoint, validate the request body.
    - [ ] Use a library like `zod`, `joi`, or a simple custom validation function.
    - [ ] **Checks for `/api/transactions/create-skill-purchase`:**
        - [ ] `agentId`: should be a valid ID format.
        - [ ] `skillName`: should be a non-empty string.
        - [ ] `buyerPublicKey`: should be a valid Solana public key format.
    - [ ] **Checks for `/api/skills/purchase/verify`:**
        - [ ] `transactionSignature`: should be a valid Solana transaction signature format.
        - [ ] `agentId` and `skillName`: same as above.
    - [ ] If validation fails, return a `400 Bad Request` error with a clear message indicating the invalid field.

## Code Example (Express.js-style Middleware)

```javascript
// middleware/auth.js
export function requireAuth(req, res, next) {
    // Logic to verify session token (e.g., from Authorization header)
    const user = verifyToken(req.headers.authorization); 

    if (!user) {
        return res.status(401).json({ message: "Authentication required." });
    }
    req.user = user; // Attach user to the request
    next();
}

// api/skills/purchase/verify.js
import { requireAuth } from 'middleware/auth';
import { z } from 'zod';

const purchaseSchema = z.object({
    transactionSignature: z.string().min(80).max(100), // Basic validation
    agentId: z.number().int(),
    skillName: z.string().min(1),
});

// Apply middleware and validation
export default async function handler(req, res) {
    requireAuth(req, res, () => {
        const validation = purchaseSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ message: "Invalid input", errors: validation.error.issues });
        }
        
        // --- Main endpoint logic ---
        // Use req.user.id instead of any user ID from the body
        const userId = req.user.id; 
        // ...
    });
}
```
