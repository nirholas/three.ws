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
| gcp-api-key | 18 | `rider/build/build.js` and `rider/src/scene.html` (directory removed from HEAD, commits from 2026-05-01). I could not locate the matched string by reading the files at those commits (it is likely inside minified vendor code). Owner action: in the Google Cloud console for project `aerial-vehicle-466722-p5`, confirm every API key is application-restricted and that none was issued for `rider`; delete any unused key. |

To re-triage with exact positions, run `npm run audit:secrets-history`. Output is rule, file, line and commit only.
