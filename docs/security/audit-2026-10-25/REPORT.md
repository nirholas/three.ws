# Security audit report: three.ws (run-1)

**Candidate validation is incomplete.** The 50-agent budget ran out after 17 of 32 candidates were independently re-checked. These 15 fingerprints were reported by hunters but never independently verified. They are kept out of findings.json and listed in their ledger units as unresolved:

- home-call-gate-first-entity-only-bypass
- home-call-scope-ignores-area-device-targets
- mcp-automation-spend-confirm-unbound-write-tier
- mcp-bridge-url-guard-dns-rebinding-toctou
- mcp-domain-register-contact-not-bound-to-quote
- mcp-persona-spend-session-cap-keyed-by-caller-session-id
- multiplayer-studio-room-owner-id-client-asserted-and-broadcast
- rate-limit-client-ip-xff-spoof-direct-cloud-run
- skill-import-github-server-token-private-readme-disclosure
- upload-presign-anon-declared-size-not-enforced-public-bucket
- upload-presign-content-type-prototype-lookup-bypass-siblings
- webhooks-delivery-claim-before-apply-no-release-shopify-shop-redact
- webhooks-discord-activity-session-unbound-room-and-token-audience
- x402-modal-merchant-402-challenge-fields-unescaped-innerhtml
- x402-pay-execute-budget-rollback-on-402-after-signed-transfer-handed-to-host

## Scope and method
- Profile: quick (one hunter wave of 26 coarse units, one final coverage critic). This is a partial pass. It does not say the rest of the repo is safe.
- Source-only. No OS sandbox was available, so no target code was run and nothing was probed on the network. Because of that, no finding is `confirmed` and none has a severity. The 17 records are `needs_validation`.
- Agents spent: 50 of 50 (6 recon, 26 hunters, 1 critic, 17 verifiers).
- No prior runs exist for this repo.
- Deviation: hunters read the skill files by path instead of receiving the blocks pasted into their prompts.
- Hunter results for covered units did not record per-file review lists, so a covered unit's reviewed paths are its assigned starting paths plus any traced files. Treat "covered" as "sampled by one hunter", not "audited".
- Source ref: see run-metadata.json.

## Coverage counts
{'deferred': 47, 'candidate': 20, 'covered': 1} units in coverage-ledger.json (68 total). Deferred units are hunter-reported gaps, 7 surfaces the critic found, and 5 covered units the critic reopened (h01, h03, h04, h15, h18). Under the quick profile they were not hunted.

## Critic-found surfaces not examined
AWS Marketplace linking and SNS events; inference node operators; agent commerce and A2A mandates; account and credential CRUD; plugin and LobeHub registry; paid upstream RPC/SDP/pinning proxies; teams runtime and social seed ingestion.

## Needs-validation records (17), highest verifier priority hint first
- [high] chat-server-tool-server-unauthenticated-shell-default: Go chat tool server exposes shell, file write and arbitrary file read with no auth by default, all interfaces, wildcard CORS
- [high] contracts-agentpayments-createagent-caller-chosen-authority-token-squat: createAgent authority gate is vacuous, letting the first caller squat any agentToken
- [medium] api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch: Unauthenticated /api/tty SSRF guard bypassed by redirect-following, unpinned fetch
- [medium] business-logic-vault-deposit-zero-share-mint-donation-inflation: Vault deposit can mint zero shares after an outside donation inflates NAV
- [medium] chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate: Anonymous chat proxy forwards full request body to OpenRouter on platform key; extra fields can reach non-free models/paid features
- [medium] chat-third-party-persona-drives-visitor-home-tools: Published agent's third-party persona/skills share a prompt with a signed-in visitor's home tools, executed under visitor authority
- [medium] contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain: Portfolio creator can propose unbounded rebalance targets and drain via open fillRebalance
- [medium] custody-spend-policy-daily-cap-ignores-strategy-run-buys: Strategy-run buys count as zero toward the agent daily SOL cap
- [medium] glb-media-cad-forge-policy-frame-attribute-escape: CAD Forge static policy does not block frame/code-object attributes (generator frame walk to real globals/builtins)
- [low] agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri: Agent update accepts an avatar_id the caller does not own; public manifest emits its CDN URL
- [low] ai-llm-agent-ask-anonymous-working-memory-poisoning: Anonymous agent-ask visitors write working-tier memories injected into the owner's chat prompt
- [low] ai-llm-agent-ask-unpublished-persona-skills-disclosure: agent-ask serves unpublished agents' private persona, system prompt and custom skills to anonymous callers
- [low] api-auth-login-csrf-unbound-signin-completion: Sign-in completion endpoints issue a session without binding to the initiating browser (login CSRF)
- [low] business-logic-oracle-follow-unauthenticated-chat-subscription-tamper: Oracle follower subscriptions are unauthenticated and keyed by caller-supplied Telegram chat_id
- [low] business-logic-oracle-test-alert-arbitrary-chat-html-injection: Oracle test-alert sends unescaped owner-controlled HTML to an arbitrary chat from the platform bot
- [low] extensions-walk-avatar-auth-callback-token-injection-no-state-binding: Walk Avatar extension stores any token from a three.ws auth-callback URL (login CSRF / session fixation)
- [low] glb-media-cad-forge-collect-follows-child-symlink: CAD Forge parent reads child-controlled artifact paths with symlink-following open

Priority hints are the verifiers' non-binding opinion, not severity.

## Hardening notes
Recorded per unit as hardening_notes in coverage-ledger.json. Examples: agent-wallet get-or-create is not atomic; createApprovalRequest does not compare payload hashes; ThreeWSFactory CREATE2 is permissionless; marketplace versions and analytics lack publish filters; global CSP allows unsafe-inline and unsafe-eval.

## Reading order
Start with chat chat/server shell default (high hint), AgentPayments createAgent squat (high hint), then the medium hints. Each record in NEEDS-VALIDATION.md has a local test plan.
