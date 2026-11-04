# Closure record for the 2026-10-25 audit

Measured 2026-11-04 against the code and `git log`. Every "fixed" row names the commit that landed the fix (or the test that pins it) and the regression test file. Where a record is a design property rather than a defect, the row says "mitigated" and names the control. This file does not edit `findings.json`.

Honest limits of this pass: the vitest runner was unavailable while this record was written (the shared `node_modules` was mid-reinstall), so the test files below were located and read, not re-run in this session. Re-run them with `npx vitest run <file>` before treating the rows as green. Foundry and Go suites were not run either.

## The 17 needs-validation records

| Slug | Status | Fix commit | Regression test |
|---|---|---|---|
| chat-server-tool-server-unauthenticated-shell-default | fixed: `-password` flag or a generated token, enforced by `guard.Auth` in `chat/server/main.go` | see `git log -- chat/server` | `chat/server/guard/guard_test.go` |
| contracts-agentpayments-createagent-caller-chosen-authority-token-squat | fixed: `createAgent` is owner-only | fd08959cf | `contracts/test/AgentPayments.t.sol` (`testAttackerCannotSquatTokenByNamingThemself`). A redeploy of an already-deployed contract is an owner on-chain action |
| api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch | fixed: pinned per-hop fetcher | c67769be5 | `tests/api-tty-ssrf.test.js` |
| business-logic-vault-deposit-zero-share-mint-donation-inflation | fixed: quote checked before transfer, `min_shares_out` honoured | 2ecf6c61d | `tests/vault-deposit-zero-share.test.js`, `tests/vault-accounting.test.js` |
| chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate | fixed: upstream body field allowlist (`buildUpstreamBody`), `:free` gate, clamped `max_tokens` | 38b8ccfe8 | `tests/api/chat-proxy-body-allowlist.test.js` |
| chat-third-party-persona-drives-visitor-home-tools | fixed: home tools are not offered in a turn that carries a third-party persona | deba79614 | `tests/chat-home-tools-third-party-persona.test.js` |
| contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain | mitigated: schedule floor (`RebalanceDelayTooShort`, `RebalanceIntervalTooShort`), creator cannot touch assets, `cancelRebalance`, timelock lets depositors redeem. Target bounds remain a creator-trust design property disclosed by the manifest | fd08959cf | `contracts/hood-portfolios/test/HoodPortfolios.t.sol` |
| custody-spend-policy-daily-cap-ignores-strategy-run-buys | fixed: strategy-run buys carry `amountSol` into the daily cap and reservation | bf3b376ca, ff3950e51 | `tests/spend-policy-strategy-amountsol.test.js`, `tests/spend-policy-strategy-reserve.test.js` |
| glb-media-cad-forge-policy-frame-attribute-escape | fixed: frame and code-object attributes refused by `cad_policy.py` | c832c83c3 | `workers/cad-forge/test_cad_policy.py` |
| agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri | fixed: update scopes `avatar_id` to the caller | eb0cdbbd7 | `tests/agents-update-avatar-ownership.test.js` |
| ai-llm-agent-ask-anonymous-working-memory-poisoning | fixed: visitor turns no longer reach the owner's chat context | 8288a51bd | `tests/agent-ask-access.test.js` |
| ai-llm-agent-ask-unpublished-persona-skills-disclosure | fixed: unpublished agents answer only their owner | 8288a51bd | `tests/agent-ask-access.test.js` |
| api-auth-login-csrf-unbound-signin-completion | fixed: flow binding on the completion endpoints, iOS handoff kept | 37d3a6d9d | `tests/auth-login-csrf.test.js`, `tests/auth-handoff.test.js`, `tests/ios-safari-handoff.test.js` |
| business-logic-oracle-follow-unauthenticated-chat-subscription-tamper | fixed: chat_id must be the caller's verified Telegram chat | 2753f9403 | `tests/oracle/chat-control-proof.test.js` |
| business-logic-oracle-test-alert-arbitrary-chat-html-injection | fixed: verified chat only, agent name HTML-escaped | 2753f9403 | `tests/oracle/chat-control-proof.test.js` |
| extensions-walk-avatar-auth-callback-token-injection-no-state-binding | fixed: one-time state minted by the extension and checked on the callback | 4f14c091d | `tests/walk-extension-auth-state.test.js` |
| glb-media-cad-forge-collect-follows-child-symlink | fixed: `O_NOFOLLOW` open of child artifacts | c832c83c3 | `workers/cad-forge/test_sandbox.py` (`test_collect_does_not_follow_symlinked_artifacts`) |

## The 15 hunter-reported fingerprints

| Fingerprint | Status | Fix commit | Regression test |
|---|---|---|---|
| home-call-gate-first-entity-only-bypass | fixed: every target is classified, not the first | ef8863b58 | `tests/home-turn-gate.test.js`, `tests/home-call-targets.test.js` |
| home-call-scope-ignores-area-device-targets | fixed: area, device and floor selectors held to the member's scope | 0f3b36aed | `tests/home-call-scope-selectors.test.js` |
| mcp-automation-spend-confirm-unbound-write-tier | fixed: handler-gated automation tools named and pinned | d6c5fb2e7, 279c955ce | `tests/mcp-confirm-flag-tier.test.js`, `tests/mcp-spend-gate.test.js` |
| mcp-bridge-url-guard-dns-rebinding-toctou | fixed: connect-time DNS pinning | e2a44bed5 | `tests/mcp-bridge-url-guard-rebinding.test.js` |
| mcp-domain-register-contact-not-bound-to-quote | fixed: contact bound to the quote | 82a1eae32 | `tests/mcp-domain-register-contact-bind.test.js` |
| mcp-persona-spend-session-cap-keyed-by-caller-session-id | fixed: cap keyed by owner | 82a1eae32, 8c61e84e7 | `tests/mcp3d-persona-spend-owner.test.js` |
| multiplayer-studio-room-owner-id-client-asserted-and-broadcast | fixed: owner keys stay server-side, broadcast uses a stable owner handle | 1c3b47da0, 280ce6bfd | `tests/studio-room.test.js` |
| rate-limit-client-ip-xff-spoof-direct-cloud-run | fixed: forwarded-hop trust on direct run.app | 93f4a514e | `tests/client-ip-proxy.test.js` |
| skill-import-github-server-token-private-readme-disclosure | fixed: private repos are never imported with the platform token | 3d07630b2 | `tests/skill-import-github-private-repo.test.js` |
| upload-presign-anon-declared-size-not-enforced-public-bucket | mitigated: a signed PUT cannot carry `ContentLength`, so the hourly sweep HEAD-checks and deletes oversize anonymous objects; audio presign requires a declared size | 5803b4579, 84662e25d | `tests/anon-upload-sweep.test.js`, `tests/api/avatar-presign-audio-cap.test.js` |
| upload-presign-content-type-prototype-lookup-bypass-siblings | fixed: inherited property names refused on every presign sibling | aab4241d9 | `tests/upload-presign-content-type.test.js` |
| webhooks-delivery-claim-before-apply-no-release-shopify-shop-redact | fixed: `applyClaimed` releases the claim when the effect throws | 023a991d3 | `tests/shopify-webhooks.test.js` |
| webhooks-discord-activity-session-unbound-room-and-token-audience | fixed: instance bound to its guild and channel, token audience verified | 1c3b47da0 | `tests/discord-activity-session-binding.test.js`, `tests/discord-activity-auth.test.js` |
| x402-modal-merchant-402-challenge-fields-unescaped-innerhtml | fixed: every challenge field passes `escapeHtml` in the SDK source and the shipped `/x402.js` | 3d07630b2 | `tests/x402-modal-challenge-escaping.test.js` |
| x402-pay-execute-budget-rollback-on-402-after-signed-transfer-handed-to-host | fixed: budget stays spent once the signed transfer is handed over | c00cd5a6a | `tests/pay-execute-402-after-sign.test.js` |

## The 7 surfaces the critic found

| Surface | Status | Evidence |
|---|---|---|
| AWS Marketplace linking and SNS events | reviewed: SNS signature verified against the SNS endpoint host and cert path with no redirects, topic ARN pinned (delivery refused when unset), `SubscribeURL` host-checked, EventBridge shared secret compared in constant time, key issue is compare-and-swap | `tests/api/aws-marketplace-sns.test.js`, `-subscription-guard`, `-eventbridge`, `-issue-race`, `-issue-key`, `-link`, `-rate-limit` |
| Inference node operators | reviewed at the test-coverage level (billing, settlement, funding agreement, coordinator); no defect found | `tests/inference-billing.test.js`, `inference-settlement.test.js`, `inference-funding-agreement.test.js`, `inference-nodes-coordinator.test.js`, `inference-livepeer*.test.js` |
| Agent commerce and A2A mandates | reviewed at the test-coverage level (mandate scope, cart mandate, spend ledger, settlement asset, platform ceiling reserve/release in `a2a-call.js`); no defect found | `tests/a2a-*.test.js`, `tests/agent-a2a-payments.test.js` |
| Account and credential CRUD | covered by the existing credential and CSRF suites; no new defect found | `tests/csrf-bearer-exemption.test.js`, `tests/csrf-call-sites.test.js`, `tests/agent-identity-csrf.test.js` |
| Plugin and LobeHub registry | reviewed: publish URL scheme check and registry endpoints covered; no defect found | `tests/plugins-publish-url-scheme.test.js`, `tests/plugins-marketplace-endpoint.test.js`, `tests/lobehub-plugin-endpoint.test.js`, `tests/chat-plugin-*.test.js` |
| Paid upstream RPC, SDP and pinning proxies | reviewed: pinning `sourceUrl` is prefix-locked to the owned R2 origin with a trailing slash and redirects refused; RPC and SDP are rate-limited. Handler-level pass found and fixed three defects: `eth_estimateGas` skipped the two-param cap that `eth_call` has (state-override argument), the pinning daily byte quota was a check-then-insert race (now reserve-first, released on failure), and a malformed percent-encoded `data:` URL threw a 500 instead of a 400 | `tests/pinning-endpoint.test.js`, `tests/api-sdp-proxy.test.js`, `tests/evm-rpc-proxy.test.js`, `tests/solana-rpc-*.test.js` |
| Teams runtime and social ingestion | covered by runtime, injection and escalation suites; no new defect found | `tests/teams-runtime.test.js`, `tests/team-chat-injection.test.js`, `tests/team-chat-escalation.test.js`, `tests/social-sentiment-endpoints.test.js` |

The plugin, LobeHub, chat-plugin, teams, social and AWS handlers were read line by line with no further defect. The inference, A2A and account rows are a coverage read, not a line-by-line audit of every handler. A handler-level pass on those three surfaces is the remaining follow-up.

## Hardening notes

| Note | Status | Test |
|---|---|---|
| agent-wallet get-or-create not atomic | fixed | `tests/agent-wallet-get-or-create-race.test.js` (14e0af6bf) |
| `createApprovalRequest` does not compare payload hashes | fixed: `assertSamePayload` on reuse | `tests/approvals.test.js` (65810bddb) |
| marketplace versions and analytics lack publish filters | fixed in this change: versions read joins the agent and requires published and undeleted; the three analytics joins on `agent_identities` carry the same filter | `tests/marketplace-public-reads-published-only.test.js` |
