# Agent Task: Write "Authentication" Documentation

## Output file
`public/docs/authentication.md`

## Target audience
Developers integrating three.ws into their app who need to handle user authentication — wallet-based, email-based, or API key auth. Also useful for self-hosters setting up auth infrastructure.

## Word count
1500–2500 words

## What this document must cover

### 1. Authentication overview
three.ws supports three authentication methods:
- **Wallet auth (SIWE)** — Sign-In With Ethereum, the web3-native approach
- **Social/email auth (Privy)** — Email, Google, Twitter login with embedded wallet
- **API keys** — For programmatic server-to-server access

Authentication controls:
- Who can edit/publish an agent
- Which agents a user owns (for on-chain operations)
- Rate limiting and usage tracking
- Access to the user dashboard and API

### 2. Sign-In With Ethereum (SIWE)
SIWE lets users authenticate using their Ethereum wallet — no password needed.

**How it works:**
1. User clicks "Connect Wallet"
2. Backend generates a nonce and challenge message
3. User signs the message in their wallet (MetaMask, Rainbow, Coinbase Wallet, etc.)
4. Signed message sent to `/api/auth/siwe/verify`
5. Backend verifies the signature on-chain
6. Session cookie set — user is authenticated as their wallet address

**Supported wallets:**
- MetaMask (browser extension)
- WalletConnect v2 (mobile wallets — Trust, Rainbow, Metamask Mobile, etc.)
- Coinbase Wallet
- Any EIP-1193 compliant provider

**API routes involved:**
- `GET /api/auth/siwe/nonce` — generate a nonce
- `POST /api/auth/siwe/verify` — verify signed message
- `POST /api/auth/siwe/logout` — clear session

**JavaScript example:**
```js
import { SiweMessage } from 'siwe';

const nonce = await fetch('/api/auth/siwe/nonce').then(r => r.text());
const message = new SiweMessage({
  domain: window.location.host,
  address: walletAddress,
  statement: 'Sign in to three.ws',
  uri: window.location.origin,
  version: '1',
  chainId: 1,
  nonce
});
const signature = await wallet.signMessage(message.prepareMessage());
await fetch('/api/auth/siwe/verify', {
  method: 'POST',
  body: JSON.stringify({ message, signature }),
  headers: { 'Content-Type': 'application/json' }
});
```

### 3. Privy (social/email auth)
Privy provides email, Google, Twitter, and Discord login — each linked to an embedded or external wallet.

**Why Privy?**
Not everyone has a MetaMask. Privy lets non-crypto users log in with email and still get the benefits of wallet-based identity (their wallet is managed by Privy's MPC system).

**How it works:**
1. User clicks "Login with Email" (or Google, Twitter, etc.)
2. Privy OAuth flow — handled by Privy's hosted UI
3. On success, Privy issues a JWT
4. JWT verified at `/api/auth/privy/verify`
5. An embedded wallet is created if the user doesn't have one
6. Session set — user is authenticated

**Configuration:**
```env
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-secret
```

Get these from https://console.privy.io.

**Linking wallets:**
Users can link additional wallets to their Privy account via `/api/auth/wallets`. This is useful for users who start with email login but later connect MetaMask.

### 4. Session management
Sessions are managed with signed cookies (via `jose` JWT):

- Session duration: 7 days (configurable)
- Cookie: `__Host-3dagent-session` (secure, httpOnly, sameSite=strict)
- Multi-session: a user can have sessions on multiple devices simultaneously

**Checking session:**
```js
const me = await fetch('/api/auth/session').then(r => r.json());
// { address: '0x...', name: 'Alex', avatarUrl: '...' }
```

**Logout:**
```js
await fetch('/api/auth/session', { method: 'DELETE' });
```

### 5. API keys
For server-to-server or programmatic access, use API keys instead of session cookies.

**Creating an API key:**
Via dashboard: https://three.ws/dashboard → API Keys → Create Key

Or via API (authenticated):
```js
const { key } = await fetch('/api/api-keys', {
  method: 'POST',
  body: JSON.stringify({ name: 'My Integration', scopes: ['agents:read', 'widgets:write'] }),
  headers: { 'Content-Type': 'application/json' }
}).then(r => r.json());
// key: "3da_live_xxxxx" — store this securely, shown only once
```

**Using an API key:**
```js
fetch('/api/agents', {
  headers: { 'Authorization': 'Bearer 3da_live_xxxxx' }
})
```

**Available scopes:**
| Scope | Access |
|-------|--------|
| `agents:read` | Read agent data |
| `agents:write` | Create/update agents |
| `widgets:read` | Read widget data |
| `widgets:write` | Create/update/delete widgets |
| `memory:read` | Read agent memory |
| `memory:write` | Write agent memory |
| `admin` | Full access (dangerous — use only for trusted services) |

### 6. Multi-wallet support
A user can link multiple wallets to one account:
- Primary wallet: used for signing and on-chain operations
- Secondary wallets: can all authenticate as the same user

Manage at `/api/auth/wallets` (GET to list, POST to add, DELETE to remove).

### 7. Setting up auth for self-hosters
Required env vars:
```env
# Session signing
JWT_SECRET=your-random-256-bit-secret

# SIWE
SIWE_DOMAIN=yourdomain.com

# Privy (optional but recommended)
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-secret

# Database (for user storage)
DATABASE_URL=postgresql://...
```

Generate `JWT_SECRET`:
```bash
openssl rand -hex 32
```

### 8. Auth in embeds
The `<agent-3d>` web component doesn't require authentication to load and display an agent. Auth is only needed for:
- Editing an agent (agent-edit.html)
- Publishing/registering
- Writing to persistent memory (IPFS mode)
- API key-protected endpoints

For embedded widgets with read-only access, no auth is required.

### 9. Wallet connection UI
The `connect-button.js` web component handles wallet connection:
```html
<connect-button></connect-button>
```
Shows "Connect Wallet" → wallet picker → connected state with address truncation.

State is managed in `src/wallet/state.js`. Listen for changes:
```js
import { walletState } from '/src/wallet/state.js';
walletState.subscribe(({ address, connected }) => {
  console.log('Wallet:', address, connected);
});
```

## Tone
Security-aware. Include warnings about key management. Be precise about what requires auth and what doesn't. Developers building on this platform need to know exactly what to secure.

## Files to read for accuracy
- `/api/auth/siwe/` — all handlers
- `/api/auth/session/` — session handlers
- `/api/auth/privy/` — Privy handlers
- `/api/auth/wallets/` — wallet management
- `/api/api-keys/` — API key CRUD
- `/src/erc8004/privy.js`
- `/src/wallet/connect-button.js`
- `/src/wallet/state.js`
- `/src/auth/walletconnect-bridge.js`
- `/src/account.js`
- `/.env.example`
