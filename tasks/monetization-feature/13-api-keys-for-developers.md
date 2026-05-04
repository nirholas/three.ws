---
status: not-started
---

# Prompt 13: Backend & Frontend - API Key Generation

## Objective
Allow users to generate and manage API keys from their profile, enabling programmatic access to the platform.

## Explanation
To grow into a true platform, third-party developers need a way to interact with your services. Providing API keys is the first step. This involves creating a secure system for generating, storing, and revoking keys, as well as a user-friendly interface for managing them.

## Instructions

### Backend
1.  **Create an `api_keys` Table:**
    *   Create a migration for a table to store API keys.
    *   Columns: `id`, `user_id`, `key_prefix`, `token_hash` (store a hash, not the raw key), `scope`, `created_at`, `revoked_at`, `last_used_at`.

2.  **Create API Endpoints (`/api/api-keys.js`):**
    *   `GET /`: Fetches all non-revoked API keys for the logged-in user. (Return only non-sensitive data like `key_prefix`, `scope`, `created_at`).
    *   `POST /`: Generates a new API key.
        *   Create a cryptographically secure key (e.g., `sk_live_` + random bytes).
        *   Hash the key before storing it in the database.
        *   **Important:** Return the full, unhashed key to the user **only once** upon creation. It cannot be retrieved again.
    *   `DELETE /:key_id`: Revokes an API key by setting `revoked_at`.

### Frontend
1.  **Create New UI (`api-keys.html`):**
    *   Create a new page accessible from the user's main navigation.
    *   Add a section to list the user's existing API keys.
    *   Include a button to "Generate New Key".
    *   Each key in the list should have a "Revoke" button.

2.  **Implement Frontend Logic (`src/api-keys.js`):**
    *   On page load, `GET` keys from the API and render the list.
    *   When the "Generate" button is clicked, `POST` to the API. The response will contain the new key. Display this key in a modal and make it clear that it must be saved immediately.
    *   When a "Revoke" button is clicked, send a `DELETE` request for that key's ID and remove it from the list on success.

## API Key Generation Snippet (Backend)

```javascript
import { randomBytes } from 'crypto';
import { sha256 } from '../_lib/crypto.js';
import { sql } from '../_lib/db.js';

// Inside POST /api/api-keys
const user = await getSessionUser(req);
if (!user) return error(res, 401);

const apiKey = `sk_live_${randomBytes(16).toString('hex')}`;
const hash = await sha256(apiKey);
const prefix = apiKey.substring(0, 10); // e.g., "sk_live_..."

await sql`
  INSERT INTO api_keys (user_id, token_hash, key_prefix, scope)
  VALUES (${user.id}, ${hash}, ${prefix}, 'default');
`;

// Return the raw key ONLY this one time.
return json(res, 201, { new_key: apiKey, message: "Save this key securely. You won't see it again." });
```
