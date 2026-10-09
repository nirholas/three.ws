# The real-funds agreements

three.ws is experimental technology, and agent wallets are custodial software,
not bank accounts. Before anyone uses real money on the platform, they sign
three agreements in one step:

- the [Terms of Service](https://three.ws/legal/tos) (version 3),
- the [Risk Disclosure](https://three.ws/legal/risk) (version 2),
- the [Agent Wallet Agreement](https://three.ws/legal/agent-wallet) (version 1).

Together they say: this is experimental software; anything deposited into,
held in, or sent from an agent wallet can be lost completely for any reason
(bugs, hacks, lost keys, autonomous agent decisions, third-party failures, the
service shutting down); nothing is insured; withdrawal or recovery is never
guaranteed; deposits by anyone are at the depositor's own risk; and three.ws is
not responsible for any loss.

People review and sign at [/legal/agreements](https://three.ws/legal/agreements),
or in the dialog that opens the first time they reach a real-funds action.

## What signing means

The dialog requires, before the Sign button enables:

1. A checkbox for each document, each linking to its full text.
2. An eligibility attestation (18 or older, not sanctioned, lawful where they live).
3. A no-liability attestation (experimental technology, total loss possible,
   nothing insured, three.ws not responsible).
4. A typed full name, which is the electronic signature.

Pressing **Sign and continue** posts the signature to `POST /api/legal/risk-ack`
and waits for it to be stored. If the write does not land, the dialog stays
open with an error and nothing proceeds: the servers enforce the signature, so
letting someone through on an unrecorded signature would only walk them into a
refusal.

## Enforcement: the server, not the dialog

Every endpoint where the platform signs with a custodial key on a user's
request calls one helper before any transaction is built:

```js
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';

if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network, context: 'withdraw' }))) return;
```

It resolves `true` when the account has a signature at or above the current
version, and otherwise sends the response and resolves `false`:

| Status | `error` | When |
|---|---|---|
| 403 | `risk_ack_required` | The account has not signed the current agreements |
| 401 | `unauthorized` | No user resolved |
| 503 | `agreement_check_unavailable` | The signature lookup failed; fails closed, nothing is sent |

A `403` body tells any client, including scripts and API-key callers, exactly
where to go:

```json
{
  "error": "risk_ack_required",
  "error_description": "Sign the real-funds agreements (Terms of Service, Risk Disclosure, and Agent Wallet Agreement) before using real funds. Nothing was sent. Sign at https://three.ws/legal/agreements",
  "context": "withdraw",
  "version": 2,
  "sign_url": "https://three.ws/legal/agreements",
  "documents": [
    { "key": "tos", "title": "Terms of Service", "version": 3, "url": "https://three.ws/legal/tos" },
    { "key": "risk", "title": "Risk Disclosure", "version": 2, "url": "https://three.ws/legal/risk" },
    { "key": "agentWallet", "title": "Agent Wallet Agreement", "version": 1, "url": "https://three.ws/legal/agent-wallet" }
  ]
}
```

Rules the helper and its call sites follow:

- **Session and API key alike.** An API key acts for its owner's account, so an
  unsigned account's key is refused too. Sign in as the key's owner and sign once.
- **Devnet is exempt.** Pass the request's `network`; `'devnet'` skips the check.
- **Previews, quotes, simulations, and dry runs are never gated.** Nothing moves.
- **Turning spending off is never gated.** Disarming autopilot, a kill switch, or
  cancelling a strategy always works; only turning spending on is gated.
- **Checked before CSRF** where the handler allows it, so a refusal does not burn
  the caller's single-use CSRF token.
- **Scheduled automation is not interrupted.** Crons that act on strategies a user
  already armed keep running (stopping them could strand open positions); the gate
  sits at the moment spending is turned on.
- **Self-custody signing is gated in the client only.** Flows where the user signs
  in their own wallet (self-custody launches, swaps, token pay) are gated by the
  dialog; the platform never holds those keys.

Some money paths are gated on the server only, because they have no
single-click dialog of their own: opening, resuming, depositing into,
redeeming from, owner-trading and fee-claiming a [USDC vault](./vaults.md)
(`vault-open`, `vault-resume`, `vault-deposit`, `vault-redeem`, `vault-trade`,
`vault-claim-fees`), creating or resuming a programmable order
(`order-create`, `order-resume`), and hiring another agent for a paid skill
(`a2a-hire`). Pausing an order, like every other way of turning spending off,
is not gated.

Positive lookups are cached in-process for 10 minutes (signatures are append-only
and the required version only changes on deploy); negative results are never
cached, so a fresh signature takes effect on the next request.

### The coverage guard

[`tests/real-funds-agreement-coverage.test.js`](../tests/real-funds-agreement-coverage.test.js)
scans every route under `api/` (excluding `api/_lib/` and `api/cron/`) that
decrypts a custodial key or imports a library that does. Each one must either
call `requireRealFundsAgreement` or appear in the test's exemption list with a
written reason. A new money endpoint that forgets the gate fails `npm test`.

## The record

Signatures are stored append-only in `legal_signatures`
([migration](../api/_lib/migrations/20260917180000_legal_signatures.sql)):

| Column | Holds |
|---|---|
| `user_id` | The signed-in account, or null for an anonymous signature. No foreign key, so the record outlives account deletion |
| `bundle_version` | The agreement bundle version (`RISK_ACK_VERSION`) |
| `documents` | Per document: the version signed and the sha256 of that page's `<main>` text as served at signing time |
| `signature_name` | The typed name, NFKC-normalized |
| `attestations` | The attestations confirmed |
| `context`, `path` | Which feature and page prompted the signature |
| `ip`, `user_agent`, `created_at` | Where and when |

Each signature also writes a `risk-ack-accept` row to `audit_log`, which the
audit-log-cleanup cron exempts from retention.

### The endpoint

`GET /api/legal/risk-ack` returns the caller's status:

```json
{ "authenticated": true, "signed": true, "signedAt": "2026-09-17T18:04:11.000Z", "signatureName": "Ada Lovelace", "version": 2, "documents": [ ... ] }
```

Add `?history=1` (signed in) to include every past signature. `POST` records a
signature and answers `200 { ok: true, recorded: true, version }`, `400` with
`invalid_version`, `document_not_accepted`, `attestation_missing`, or
`invalid_signature` when the body is not a complete signature, or `503
signature_not_recorded` when the write did not land.

## Anonymous signatures and deposits

Anyone can fund an agent, including visitors with no account, and anyone can
send tokens to a public address without visiting three.ws at all. So:

- The Deposit tab in the agent wallet hub, and the deposit sheet on `/wallet`,
  hide the address on mainnet until the visitor signs. A visitor with no session
  signs anonymously; the signature covers that browser.
- Tips from a connected wallet (the tip modal) require a signature.
- The Agent Wallet Agreement states that every deposit, by anyone and by any
  means, is governed by it, and a notice under the deposit address says so.

For a signed-in visitor, the client never trusts a signature cached in this
browser on its own: it confirms the account's server record once per page, so a
signature left by an anonymous visit or another account does not stand in for
this account's.

## Client API

The canonical module is [`public/risk-ack.js`](../public/risk-ack.js), served
at `/risk-ack.js`, dependency-free so plain pages and third-party embeds can
import it. Bundled app code imports the wrapper
[`src/shared/risk-ack.js`](../src/shared/risk-ack.js), which never rejects and
degrades to a native `confirm()` if the module fails to load.

```js
import { ensureRiskAck, hasRiskAckVerified, fetchWithRiskAck } from './shared/risk-ack.js';

// Gate an action. Resolves false when the person declines: abort.
if (!(await ensureRiskAck({ context: 'trade' }))) return;

// Decide what to render without prompting (e.g. whether to show a deposit address).
const signed = await hasRiskAckVerified();

// Let a request re-prompt on the server's refusal and retry once after signing.
const res = await fetchWithRiskAck('/api/agents/abc/solana/withdraw', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	credentials: 'include',
	body: JSON.stringify({ destination, amount, network: 'mainnet' }),
}, { context: 'withdraw' });
```

`ensureRiskAck({ force: true })` ignores any cached signature and asks again;
`fetchWithRiskAck` uses it after a `risk_ack_required` response.

## Changing a document

1. Edit the page under `public/legal/` and update its version and effective date.
2. Bump that document's `version` in `AGREEMENT_DOCUMENTS` and bump
   `RISK_ACK_VERSION` in [`public/risk-ack.js`](../public/risk-ack.js).
3. Deploy. Every signature below the new bundle version stops counting on the
   client and the server, and everyone signs again before their next real-funds
   action. People who do not accept can ask support to return their agent wallet
   balance (Agent Wallet Agreement, section 15).

Bumping `TOS_VERSION` in [`api/_lib/legal.js`](../api/_lib/legal.js) separately
keeps the sign-in clickwrap record in step with the Terms version.

## Gated surfaces (client)

| Surface | Entry point | Context |
|---|---|---|
| Agent wallet: deposit address | `src/agent-wallet-hub/tabs/deposit.js` | `deposit` |
| Agent wallet: trade | `src/agent-wallet-hub/tabs/trade.js` | `trade` |
| Agent wallet: withdraw | `src/agent-wallet-hub/tabs/withdraw.js` | `withdraw` |
| Agent wallet: give | `src/agent-wallet-hub/tabs/give.js` | `give` |
| Agent wallet: arm sniper | `src/agent-wallet-hub/tabs/snipe.js` | `snipe` |
| Agent wallet: arm autopilot | `src/agent-wallet-hub/tabs/autopilot.js` | `autopilot` |
| Agent wallet: x402 pay | `src/agent-wallet-hub/tabs/pay.js` | `x402-pay` |
| Agent inference credits: top up, arm auto-fund | `src/inference-credits.js` | `inference-topup`, `inference-auto-fund` |
| Tip an agent from a connected wallet | `src/shared/agent-tip-modal.js` | `tip` |
| Master wallet: deposit, send, fund agent | `src/master-wallet.js` | `deposit`, `master-send`, `fund-agent` |
| Oracle arm (live mode only) | `src/arm.js` | `oracle-arm` |
| Jupiter swap modal | `src/swap-jupiter.js` | `swap` |
| pump.fun token launch | `src/pump/launch-token-modal.js` | `launch` |
| The `/launch` launchpad: launch a coin, claim creator rewards | `src/launch/launch-page.js` | `launch`, `claim` |
| Agent-home pump.fun buy/sell | `src/agent-home-pumpfun.js` | `pump-trade` |
| pump.fun x402 access payment | `src/pump/pump-modals.js` | `x402-pay` |
| Skill purchase modal | `src/payment-modal.js` | `skill-purchase` |
| $THREE token payments | `src/token-pay.js` | `token-pay` |
| Forge pay-per-generation | `src/forge-pay.js` | `forge-pay` |
| Add funds / Coinbase onramp | `src/shared/add-funds.js` | `onramp` |
| Drop-in x402 modal (incl. merchant embeds) | `public/x402.js` | `x402-pay` |
| Review and sign page | `public/legal/agreements.js`, loaded as a module by `public/legal/agreements.html` | `agreements-page` |

If you add a surface, add its row here and its gate call in the code, and if it
signs with a custodial key, call `requireRealFundsAgreement` in its handler: all
in the same change.

## Related

- [Agent Wallet Agreement](https://three.ws/legal/agent-wallet)
- [Risk Disclosure](https://three.ws/legal/risk)
- [Terms of Service](https://three.ws/legal/tos), section 8
- [Custody you can verify](./custody.md): the spend limits and freezes that bound what agents can do after signing
