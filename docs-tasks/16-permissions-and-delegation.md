# Agent Task: Write "Permissions & Delegation" Documentation

## Output file
`public/docs/permissions.md`

## Target audience
Developers building agents that perform sensitive actions (signing transactions, accessing external APIs, spending on behalf of users) and need to understand the permission model.

## Word count
1500–2500 words

## What this document must cover

### 1. Why permissions?
As agents become more capable — making blockchain transactions, calling external APIs, storing data — the question of *what is the agent allowed to do* becomes critical.

Without a permission system:
- A skill installed from a third-party URL could read your wallet balance
- An agent given your API key could make unlimited requests
- There's no way for a user to revoke what they previously granted

three.ws uses **ERC-7710 delegation** as its permission model — a standard for granting on-chain capabilities to agents (or any address) with specific constraints.

### 2. ERC-7710 overview
ERC-7710 defines a "delegation" standard:
- An **authority** (you, the user) grants a **delegate** (the agent) permission to perform specific actions
- Permissions are scoped: an agent can only do exactly what you've granted
- Permissions can be time-limited, rate-limited, or revoked at any time
- The permission grant is signed by your wallet (not submitted on-chain — off-chain delegation)

Think of it like OAuth scopes, but for blockchain operations + skill permissions.

### 3. Permission types
Built-in permission types:

| Permission | Description |
|-----------|-------------|
| `speak` | Allow agent to speak aloud |
| `remember` | Allow agent to write to memory |
| `sign-action` | Allow agent to sign actions with connected wallet |
| `load-model` | Allow agent to load new 3D models |
| `call-external-api` | Allow agent to make HTTP requests to external URLs |
| `spend` | Allow agent to spend tokens (with amount limit) |
| `register-on-chain` | Allow agent to submit on-chain transactions |
| `read-memory` | Allow reading memory (default: always allowed) |
| `write-memory` | Allow writing to persistent memory |
| `manage-skills` | Allow installing/removing skills |

Custom permissions can be defined by third-party skills.

### 4. Granting permissions
**Via the permission grant modal (UI):**
When a skill or agent action requires a permission not yet granted, the permission modal appears:
- Shows what is being requested and why
- User can approve or deny
- Optional: set expiry, rate limit, or scope constraint
- Signing with connected wallet creates the delegation

**Programmatically:**
```js
import { PermissionToolkit } from '@3dagent/sdk/permissions';

const toolkit = new PermissionToolkit({ wallet });
const delegation = await toolkit.grant({
  delegate: agentAddress,
  permissions: ['speak', 'remember', 'call-external-api'],
  expiry: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  rateLimit: { calls: 100, window: '1h' }
});
```

### 5. Checking permissions (inside a skill handler)
Skills must check permissions before performing sensitive actions:

```js
// handlers.js for a skill that calls an external API
export async function fetch_data({ url }, ctx) {
  // Check permission
  const allowed = await ctx.permissions.check('call-external-api', { url });
  if (!allowed) {
    return { ok: false, error: 'Permission denied: call-external-api' };
  }

  const data = await ctx.fetch(url);
  return { ok: true, data };
}
```

The context's `permissions.check()` method:
- Returns `true` if the user has granted this permission
- Returns `false` if denied or not yet granted
- If `throwOnDeny: true` option set, throws an error (triggers the permission modal)

### 6. Revoking permissions
**Via the manage panel (UI):**
At https://three.ws/dashboard → Permissions:
- Lists all active delegations
- Revoke individual permissions or all permissions for an agent
- View expiry dates and rate limit usage

**Programmatically:**
```js
await toolkit.revoke({ delegationId: 'delegation-uuid' });
// or revoke all for an agent:
await toolkit.revokeAll({ delegate: agentAddress });
```

### 7. Redeeming a delegation
When an agent needs to use a permission, it "redeems" the delegation:

```js
import { redeemDelegation } from '@3dagent/sdk/erc7710';
const result = await redeemDelegation({
  delegation,
  action: 'remember',
  args: { key: 'user-name', value: 'Alex' }
});
```

The `delegation-redeem.js` module handles this flow:
1. Validates delegation signature
2. Checks constraints (expiry, rate limit, scope)
3. Executes the action if valid
4. Logs the redemption (for rate limiting)

### 8. Skill trust modes
When the skill registry loads skills, it applies trust rules:

| Trust mode | Who can install |
|-----------|----------------|
| `any` | Any skill from any URL |
| `owned-only` | Only skills authored by the agent owner's wallet |
| `whitelist` | Only skills on an explicit allow-list |

Skills installed from unverified URLs don't automatically get permissions — they must request them explicitly.

### 9. The permissions API
```
GET /api/permissions          — list current user's permissions
POST /api/permissions         — create a delegation
DELETE /api/permissions/:id   — revoke a delegation
GET /api/permissions/check    — check if a permission is granted
```

### 10. Security model
**What permissions protect:**
- Actions with real-world consequences (signing, spending, calling external APIs)
- Memory writes (in case memory contains sensitive data)
- Installing new skills (prevent supply chain attacks)

**What permissions don't protect:**
- Read-only viewer operations (loading models, playing animations)
- UI rendering (the agent will always be visible once loaded)
- Speaking (TTS output visible to the user)

**Rate limiting:**
Permissions can include rate limits: e.g., "allow `call-external-api` up to 50 times per hour". Exceeding the rate limit triggers a new permission request.

**Time-limited grants:**
Permissions can have an expiry date. After expiry, the agent must request permission again. This is good practice for high-value permissions.

### 11. ERC-7710 contract
The delegation is enforced by the ERC-7710 contract:
```
DelegationManager: 0x... (deployed on Base, Ethereum, Sepolia)
```

ABIs and deployment addresses in `/src/erc7710/abi.js`.

The contract's `execute()` function is called when redeeming a delegation — it verifies the signature and constraints before executing the action.

### 12. For skill authors
If your skill performs any of the following, declare it in your skill manifest:
```json
{
  "name": "weather",
  "permissions": ["call-external-api"],
  "tools": [...]
}
```

The skill registry uses this declaration to:
1. Prompt for permission before the skill runs for the first time
2. Show users what permissions a skill needs before they install it

## Tone
Security-focused and precise. Analogies to OAuth help. Code examples for both granting and checking permissions. Be honest about what the permission system protects and what it doesn't.

## Files to read for accuracy
- `/src/permissions/toolkit.js` (12446 bytes)
- `/src/permissions/grant-modal.js`
- `/src/permissions/manage-panel.js`
- `/src/erc7710/abi.js`
- `/src/runtime/delegation-redeem.js` (11829 bytes)
- `/api/permissions/` — permission API routes
- `/specs/PERMISSIONS_SPEC.md`
- `/specs/SKILL_SPEC.md`
- `/scripts/smoke-permissions.js`
- `/scripts/test-toolkit.js`
