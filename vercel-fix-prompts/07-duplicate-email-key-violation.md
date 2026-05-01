# Fix: Duplicate Email Key Constraint Violation on User Registration

## Problem

`/api/auth/siwe/verify` returns 500 errors due to:

```
duplicate key value violates unique constraint "users_email_key"
```

This happens when a user tries to register or authenticate and the system attempts to INSERT a user record with an email that already exists.

## What to investigate

1. Find the handler for `/api/auth/siwe/verify`.
2. Locate where a new user record is inserted into the `users` table.
3. Determine if the code does an upsert (INSERT ... ON CONFLICT DO UPDATE) or a plain INSERT. If it's a plain INSERT, it will fail for returning users.
4. Check if the flow should be: look up existing user by wallet address or email → create only if not found → issue JWT. If a user reconnects their wallet, we should NOT try to create a new record.

## Expected fix

Replace the plain INSERT with an upsert:
```sql
INSERT INTO users (email, wallet_address, ...)
VALUES ($1, $2, ...)
ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
RETURNING *;
```

Or add a lookup-before-insert pattern:
```js
let user = await db.users.findByEmail(email) ?? await db.users.create({ email, ... });
```

Ensure the error is handled gracefully (return the existing user, not a 500) even if the upsert approach is used.
