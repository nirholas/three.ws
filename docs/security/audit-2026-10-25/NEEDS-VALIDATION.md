# Needs validation

Each item lists the exact blocker and the safe check that resolves it.

## Agent update accepts an avatar_id the caller does not own; public manifest emits its CDN URL

`agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri`

Blockers:
- Attacker needs the victim's unguessable avatar UUID; no leak source confirmed.
- Whether /cdn/<key> or r2.dev serves private-visibility keys without auth (api/cdn-object.js suggests the bucket is public).
- Not executed.

Local check: Two dummy users: A PATCHes own agent with B's private avatar_id, then fetch the public manifest and registration unauthenticated and check for B's CDN URL; test whether the URL serves bytes without auth.

Deployment check: Owner checks whether private avatar keys are fetchable without auth and whether avatar UUIDs leak.

## Anonymous agent-ask visitors write working-tier memories injected into the owner's chat prompt

`ai-llm-agent-ask-anonymous-working-memory-poisoning`

Blockers:
- Model compliance with injected text unobserved.
- Production send-sol env (recipient lock, demo token, caps) and GUARDIAN_DISABLE unknown.
- Memories are not public by default, so only the owner chat is exposed.

Local check: POST anonymous /api/agent-ask with a marker instruction, then chat as owner and check the marker appears in recalled memory and the system prompt but not for a non-owner.

Deployment check: Owner checks prod send-sol env and counts anon-originated working rows on a test agent.

## agent-ask serves unpublished agents' private persona, system prompt and custom skills to anonymous callers

`ai-llm-agent-ask-unpublished-persona-skills-disclosure`

Blockers:
- Leak reliability against the model unproven.
- Needs an unpublished agent UUID; check whether any public surface leaks it.
- Product intent for agent-ask on unpublished agents unclear.

Local check: Dummy DB with unpublished agent holding marker strings; anonymous POST /api/agent-ask asking to repeat instructions; compare with /api/chat.

Deployment check: Owner tests own unpublished agent unauthenticated; checks public exposure of unpublished UUIDs.

## Sign-in completion endpoints issue a session without binding to the initiating browser (login CSRF)

`api-auth-login-csrf-unbound-signin-completion`

Blockers:
- Telegram and SAML may not be enabled in production.
- SAML InResponseTo handling untraced.
- Handoff GET is bearer by design for iOS; any fix must keep that flow.
- Attacker needs an account and a victim click.

Local check: Mint a handoff code as A, open the exchange GET in a session signed in as B and confirm the session switches to A; repeat Telegram callback without tgflow cookie and SAML with an unsolicited response.

Deployment check: Confirm Telegram/SAML enabled in prod; any edge origin check on handoff exchange.

## Unauthenticated /api/tty SSRF guard bypassed by redirect-following, unpinned fetch

`api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch`

Blockers:
- Redirect following and rebinding not exercised.
- Whether Cloud Run egress reaches useful internal services.
- GCP metadata needs a header this fetch cannot send.
- Response must be a valid GLB to render.

Local check: Two loopback fixtures, first 302s to second; with a test DNS allowance call resolveSource and loadModel and confirm the second is hit; add a regression test.

Deployment check: Staging: point ?src at owned public host redirecting to an internal canary; check canary log and Cloud Run egress reachability.

## Oracle follower subscriptions are unauthenticated and keyed by caller-supplied Telegram chat_id

`business-logic-oracle-follow-unauthenticated-chat-subscription-tamper`

Blockers:
- Telegram delivers only to chats that started the bot.
- Production rate-limit values unknown.
- Unauthenticated access is documented as intended.

Local check: Anonymous POST, GET, DELETE with a chat_id the caller does not control on a test DB and bot; confirm rows change and alertFollowers delivers.

Deployment check: Staging: anonymous POST/DELETE/GET with arbitrary chat_id.

## Oracle test-alert sends unescaped owner-controlled HTML to an arbitrary chat from the platform bot

`business-logic-oracle-test-alert-arbitrary-chat-html-injection`

Blockers:
- Agent-name write path may restrict characters (not traced).
- Delivery needs the target chat to have started the bot.
- oracleTelegramTestIp ceiling not checked.

Local check: With Telegram stubbed, create an agent named with an anchor tag, POST test-alert with another chat_id and inspect the sendMessage payload.

## Vault deposit can mint zero shares after an outside donation inflates NAV

`business-logic-vault-deposit-zero-share-mint-donation-inflation`

Blockers:
- Not executed.
- transferUsdcGuarded spend policy may impose a minimum amount.
- Vault creation gating not examined.
- No min_shares parameter makes loss silent.

Local check: Unit test sharesForDeposit(1n, 1_000_000_000n, 1n) returns 0n; then on devnet or mocks: deposit 1 atomic, donate USDC to vault_address, second deposit mints 0 shares.

Deployment check: Check transferUsdcGuarded and prod config for minimum deposit.

## Anonymous chat proxy forwards full request body to OpenRouter on platform key; extra fields can reach non-free models/paid features

`chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate`

Blockers:
- OpenRouter handling of models/plugins/provider with a :free primary and whether the key is charged.
- Whether the key has paid credits.
- Actual chatIp limit values.

Local check: Stub fetch, POST a :free model with models, plugins and a large max_tokens, assert the upstream body contains them, then add an allowlist and assert they are dropped.

Deployment check: Owner reviews OpenRouter activity for non-:free generations/plugin charges on the proxy key; test with spend-capped staging key.

## Go chat tool server exposes shell, file write and arbitrary file read with no auth by default, all interfaces, wildcard CORS

`chat-server-tool-server-unauthenticated-shell-default`

Blockers:
- Launch mode of the shipped binary (password flag, firewall, loopback proxy) unknown.
- shell.go and toolfns.go sinks not independently re-read.

Local check: In an isolated VM run with no flags; send a preflight and POST /tool Shell id with a foreign Origin from another host; GET /read_file; repeat with -password set.

Deployment check: Check released docs/commands for omitted -password.

## Published agent's third-party persona/skills share a prompt with a signed-in visitor's home tools, executed under visitor authority

`chat-third-party-persona-drives-visitor-home-tools`

Blockers:
- Model compliance with the injected persona unobserved.
- Classifier guarded verdict per service not read.
- Role scoping may limit guest targets.

Local check: Stub the LLM to return a home tool call; owner A publishes an agent, visitor B has a home membership and mock bridge; confirm an unguarded service executes with B's userId and no confirmation; dump classifier verdicts.

Deployment check: Owner reviews home action logs for agent-actor actions in turns where visitor did not request them and agent not owned by visitor.

## createAgent authority gate is vacuous, letting the first caller squat any agentToken

`contracts-agentpayments-createagent-caller-chosen-authority-token-squat`

Blockers:
- Not executed.
- Deployment status and whether funds are held.
- Whether the platform owner pre-registers legitimate tokens.
- Whether an owner-side reassign or remove function exists (not checked).

Local check: Foundry test: attacker createAgent(token, attacker, 0); real creator call reverts AgentExists; payer acceptPayment; attacker withdraws.

Deployment check: Owner checks deployment and registered agents.

## Portfolio creator can propose unbounded rebalance targets and drain via open fillRebalance

`contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain`

Blockers:
- Not executed.
- Deployed portfolios, delay values and third-party TVL unknown.
- Depositors may redeem during the timelock.
- Constituents are creator-chosen and visible before deposit.

Local check: Foundry test in contracts/hood-portfolios/test: zero delay, valuable and worthless constituents, targets [0, huge], fill by a colluder, assert depositor loss; repeat with a nonzero delay and redeem early.

Deployment check: Owner checks deployed portfolios and balances.

## Strategy-run buys count as zero toward the agent daily SOL cap

`custody-spend-policy-daily-cap-ignores-strategy-run-buys`

Blockers:
- Not executed.
- Whether strategy-run is deployed and reachable.
- Whether delegated or scoped keys are constrained by daily_sol_cap.

Local check: Run a mocked live strategy buy through makeRuntime, confirm payload has amountSol and no solAmount, then checkBuyAllowed with 4.9 SOL spent and expect a block.

Deployment check: Owner sums strategy-run buys per agent per day against daily_sol_cap.

## Walk Avatar extension stores any token from a three.ws auth-callback URL (login CSRF / session fixation)

`extensions-walk-avatar-auth-callback-token-injection-no-state-binding`

Blockers:
- Extension not loaded; storage overwrite unconfirmed.
- Whether APIs attribute to the bearer user when no cookie is present.
- Victim must be induced to navigate to the crafted URL.

Local check: In a throwaway Chrome profile load the extension, mint B's token, open the callback URL while signed out and confirm threews_session is overwritten; repeat while signed in as A.

Deployment check: Two test accounts; victim signed out; check attribution of /api/avatars/mine and /api/tts/speak and whether attacker can see text.

## CAD Forge parent reads child-controlled artifact paths with symlink-following open

`glb-media-cad-forge-collect-follows-child-symlink`

Blockers:
- Needs a companion policy-escape or native primitive in the child.
- Whether production runs as uid 0 and what /proc/1/environ holds.
- Whether getsize on /proc files bypasses the cap.

Local check: As root in the built image run main.run_build with a test-double child that writes part.glb as a symlink to a root-only dummy file; expect _collect to return its bytes.

Deployment check: Owner: confirm container uid 0 and /proc/1/environ contents.

## CAD Forge static policy does not block frame/code-object attributes (generator frame walk to real globals/builtins)

`glb-media-cad-forge-policy-frame-attribute-escape`

Blockers:
- Code not executed; the frame chain on the deployed Python version is inferred.
- Whether the program text can be steered by the user or is only LLM-generated.
- Seccomp, uid drop and rlimit effectiveness under Cloud Run.
- Whether secrets are readable by the sandbox uid.

Local check: Feed sandbox_child.py via test_sandbox.py a generator-based program that reads f_back.f_back.f_globals['os'] and f_builtins['open']; expect a policy refusal; if it runs, add a test to test_cad_policy.py.

Deployment check: Owner: confirm /health seccomp_required true, root->nobody drop, canary build refused.

