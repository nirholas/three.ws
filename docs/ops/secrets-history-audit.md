# Secrets-in-history audit (gitleaks 8.30.1)

First full run: 2026-11-10, 20,544 commits across all refs, `.gitleaks.toml` default rules plus the allowlist. Result: 1,079 findings in 313 commits. Nothing was rewritten, nothing was printed. The scan takes about 45 minutes, so it is a manual guard (`npm run audit:secrets-history`), not part of the gate.

| Rule | Count | Triage |
|---|---|---|
| generic-api-key | 799 | Entropy matches on public data: vendored libraries under `contracts/lib`, locale files, base58 addresses and hashes in docs, fixtures and tests, shot scripts. No rotation action. Candidate for allowlist tuning by path once someone reviews a sample. |
| jwt | 175 | 6 files, almost all `prompts/okx-ai/e2e-evidence/*` (expired, garbage and cross-service tokens captured as negative-test evidence) and a connector probe capture. Short-lived or deliberately invalid. No rotation action. |
| curl-auth-header, curl-auth-user | 54 | Documentation examples (`Authorization: Bearer <placeholder>`). No rotation action. |
| stripe-access-token | 12 | Test fixtures with obviously synthetic `sk_live_` names (abc, guard, hermes, revoke, second). Allowlisted by pattern in `.gitleaks.toml`. |
| discord-client-id | 7 | `.env.example` files. Client ids are public. No rotation action. |
| private-key | 7 | `character-studio/key.pem`, added 2026-04, removed from HEAD: private key paired with a self-signed `CN=local.webaverse.com` dev certificate that expired 2023-01-08. No rotation action. The other 6 are the `PERSONA_JWKS_PRIVATE_KEY_PEM` docs examples (`docs/persona-hub.md`, `docs/ALL.md`), which show the variable shape. |
| sourcegraph-access-token | 7 | `third_party/threeui/public/source-code.json`, a vendored bundle of third-party source. Not a three.ws credential. No rotation action. |
| gcp-api-key | 18 | Two Firebase web `apiKey` values inside the removed `rider/` game bundle (2026-05). Firebase web keys are public client identifiers by design. Checked 2026-11-10: project `aerial-vehicle-466722-p5` has zero API keys (the API Keys API was enabled to list them, read-only use), so no live key there matches. The two other accessible projects belong to a different account and were not touched. No live key matches. Allowlisted by rule and path. |

To re-triage with exact positions, run `npm run audit:secrets-history`. Output is rule, file, line and commit only.

## Unresolved: one real EVM key (owner action)

`scripts/x402-test.mjs` (commit `ee271afdc`, 2026-05-20) and `scripts/x402-all.mjs` (commit `f5b5395bc`, 2026-05-21) once hardcoded a 32-byte EVM private key (prefix `0x5e306b`). Later commits replaced it with `X402_PAYER_PRIVATE_KEY`, but history still holds it. Its address is `0x33369135724F53521dF38e69262792a1EC068cd7`. On 2026-11-10 it held dust on Base (about 1.5e9 wei, no USDC) and nothing on BSC. This finding is deliberately not allowlisted, so `npm run audit:secrets-history` keeps exiting 1 on it. Owner action: treat the key as compromised, confirm no live service or contract still uses that address, and sweep or retire it. Once the owner accepts the risk, add its fingerprint to `.gitleaks.toml`. History is not rewritten.

## Allowlist policy

Each `[[allowlists]]` entry in `.gitleaks.toml` names one rule (`targetRules`), the paths it was reviewed for, and a one-line reason. No rule is disabled. The generic-api-key classes cover reviewed directories (tests, docs, vendored libraries, locale data, fixtures) and an explicit list of reviewed source files. The reviewed paths contain no 64-hex private-key shape other than zero-balance test keys (`0x4918ba...` has no balance on Base or BSC). New files in a reviewed directory inherit the allowance for generic-api-key only, so a new real key of any other rule still fails the scan.
