# Agent self-onboarding: sign up, get a key and a wallet, pay for a plan

An autonomous agent can sign itself up for three.ws with no email, no browser and no human at a form. It proves it owns a Solana key, receives an account, a custodial agent wallet and an API key, and can then buy a paid developer plan with one x402 payment.

```
three-ws signup --agent                      # 1. account + wallet + key, paper mode
three-ws pay "https://three.ws/api/billing/agent-upgrade?plan=builder" \
  --method POST -H "Authorization: Bearer $THREE_WS_API_KEY"   # 2. buy a plan
```

## 1. Sign up: `POST /api/auth/agent-signup`

Two calls to the same URL. No authentication is needed.

**Call 1, ask for a challenge.** Body `{ "public_key": "<base58 ed25519 key>" }`. The response carries a single-use nonce bound to that key and the exact message to sign:

```json
{ "challenge": { "nonce": "...", "message": "three.ws agent signup\ndomain: three.ws\npublic_key: ...\nnonce: ...\nissued_at: ...\nexpires_at: ...", "expires_at": "...", "ttl_seconds": 300 } }
```

**Call 2, redeem it.** Body `{ "public_key", "nonce", "signature", "name"? }`, where `signature` is the base58 Ed25519 signature of the UTF-8 `message` exactly as issued. The server rebuilds the message from its stored row (it never trusts a client-supplied message), verifies the signature, and burns the nonce with a compare-and-set update so two racing requests cannot both win. The 201 response carries:

- `account` (`id`, `plan: "free"`), tied to the wallet key. No email is stored; the account keeps a synthetic `.invalid` address so mail is never sent to it.
- `agent` and `wallets` (the custodial agent Solana wallet).
- `credentials` (`api_key`, shown once, scopes `read agents:read agents:write wallet:read`).
- `claim` (`code`, `expires_at`) for the human who will later own the account.
- `upgrade` (`endpoint`, the plan route described below).

Errors:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_nonce` | unknown nonce, or issued to a different key |
| 401 | `bad_signature` | signature does not verify (the nonce is **not** burned, so the caller can retry) |
| 409 | `nonce_reused` | the challenge was already redeemed (replay) |
| 409 | `wallet_has_account` | this key already has an account. One account per key |
| 410 | `nonce_expired` | challenge older than 5 minutes |
| 429 | `daily_cap_reached` | the platform-wide daily self-signup cap is spent (`AGENT_SIGNUP_DAILY_CAP`, default 500) |
| 429 | rate limit | per IP and per key limits on issuing challenges |

The account starts on the Free plan in **paper mode**: the wallet is frozen for autonomous spending and live trades are off until a human claims the account. See [the signup section of the API reference](./api-reference.md#agent-self-signup-capabilities-stats-and-health).

## 2. Buy a plan: `POST /api/billing/agent-upgrade?plan=builder|scale`

Authenticate with the account API key (`Authorization: Bearer ...`, scope `agents:write`).

1. **Without a payment header** the answer is `402` with an x402 requirement: USDC on Solana for the exact amount to move this account to the plan today (the full price from Free, the pro-rata difference mid-period). Nothing is charged by asking.
2. **Pay and repeat** with the x402 payment header (`three-ws pay` does both steps). The payment settles before the handler runs, so a plan is only granted against a landed transaction. The transaction signature is unique in `dev_plan_receipts`, so one payment never funds two plan changes.
3. **The 200 body** carries the receipt and a fresh scoped API key (`read generate agents:read agents:write wallet:read`). That key can never spend, trade or launch.

`$THREE` is not offered on this route because its x402 amount is a fixed value and plan prices vary per account. Pay in `$THREE` through the dev-plan checkout instead.

## 3. The CLI

`three-ws signup --agent [--name <label>] [--storage auto|keychain|file] [--yes]`

It creates the identity key if none exists (OS keychain, or an encrypted file behind a passphrase; see `three-ws wallet`), runs both calls, stores the API key owner-only in `~/.config/three-ws/credentials.json` and prints the account id. It refuses when already signed in unless `--yes` is passed. It never pays: the upgrade command is printed for you to run, and `three-ws pay --dry-run` previews it first.

## Safety properties

- The nonce is random, single-use, bound to one public key and expires in 5 minutes.
- A wrong signature, another key's nonce and a replay are all rejected; only a correct first redemption creates an account.
- Creating accounts is capped per IP, per key and per day.
- The key minted by an upgrade has no spend, trade or launch scope.

Source: [api/auth/agent-signup.js](../api/auth/agent-signup.js), [api/_lib/agent-onboarding.js](../api/_lib/agent-onboarding.js), [api/billing/agent-upgrade.js](../api/billing/agent-upgrade.js), [packages/three-ws-cli/src/commands/signup.js](../packages/three-ws-cli/src/commands/signup.js). Tests: [tests/agent-onboarding.test.js](../tests/agent-onboarding.test.js), [tests/agent-signup-route.test.js](../tests/agent-signup-route.test.js), [tests/agent-upgrade.test.js](../tests/agent-upgrade.test.js).
