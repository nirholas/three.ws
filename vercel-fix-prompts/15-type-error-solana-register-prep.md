# Fix: TypeError in /api/agents/solana-register-prep

## Problem

`/api/agents/solana-register-prep` returns 500 with:

```
TypeError: The first argument must be of type string or an instance of Buffer
```

This error typically comes from Node.js crypto functions, Buffer operations, or similar APIs that require a string or Buffer but received something else (undefined, null, object, number).

## What to investigate

1. Find the handler for `/api/agents/solana-register-prep`.
2. Search for Buffer operations, crypto calls (`crypto.createHash`, `crypto.sign`, etc.), or Solana SDK calls that take a key or data argument.
3. Identify which argument is receiving the wrong type — add logging before the failing call to print the actual type and value of the argument.
4. Trace back where that value comes from — request body, environment variable, database lookup, or derived value.

## Expected fix

- Add input validation at the top of the handler to verify all required fields are present and of the correct type before any crypto/Buffer operations.
- If the value comes from an environment variable, add a startup check with a clear error message if missing.
- If it comes from the request body, return 400 with a descriptive error instead of letting the TypeError propagate.

Example guard:
```js
const { publicKey } = req.body;
if (typeof publicKey !== 'string') {
  return res.status(400).json({ error: 'publicKey must be a string' });
}
```
