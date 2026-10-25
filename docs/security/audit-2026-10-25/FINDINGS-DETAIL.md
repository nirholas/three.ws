# Findings detail

All records are `needs_validation` (source-only run, nothing executed).

## Agent update accepts an avatar_id the caller does not own; public manifest emits its CDN URL

Fingerprint: `agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri`

api/agents.js handleUpdate sets avatar_id = COALESCE(body.avatar_id, avatar_id) with no avatars.owner_id check (handleCreate checks at 308-312). Unauthenticated manifest/registration in api/agents/_id/_sub.js join the avatar and call resolveAvatarUrl with visibility hardcoded 'public', emitting the private avatar CDN URL in body.uri and registration. Verifier assessment: Source path holds: handleUpdate writes avatar_id with no owner check; public manifest/registration emit the CDN URL. Attacker needs the victim's random avatar UUID and the CDN may already be public. Non-binding priority hint: low. Suggested fix: Validate UUID and require avatars.owner_id = caller in handleUpdate as handleCreate does; in public manifest/registration only emit URLs for public or unlisted avatars owned by the agent owner.

Claimed root cause: Missing ownership check on update; public resolver forces public visibility.

Trace:
- entrypoint: api/agents.js:447
- propagation: api/agents.js:533
- propagation: api/agents/_id/_sub.js:378
- propagation: api/_lib/avatars.js:545
- propagation: api/_lib/r2.js:439
- sink: api/agents/_id/_sub.js:441

Evidence:
- api/agents.js:308: create path checks avatar ownership
- api/agents/_id/_sub.js:401: visibility hardcoded public
- api/agents/_id/_sub.js:515: registration emits URL

## Anonymous agent-ask visitors write working-tier memories injected into the owner's chat prompt

Fingerprint: `ai-llm-agent-ask-anonymous-working-memory-poisoning`

agent-ask saveTurn (agent-ask.js:191, called 311) stores visitor question (<=1000 chars) and answer as agent_memories tier 'working', salience 0.2, 2h TTL. memory-store.js:481 computeContext selects all non-expired pinned or working rows; chat.js:2120 recallForChat merges them; chat.js:2198 appends '- (type) snippet' (160 char) to system prompt with no untrusted fence. Chat tools include sendSol (chat.js:402); Guardian inspects only user message. Funds impact depends on api/agent/send-sol.js:83 AVATAR_LOCK_RECIPIENT/AVATAR_DEMO_TOKEN config. Verifier assessment: Anonymous agent-ask writes visitor text to the working memory tier, which reaches the owner's chat system prompt unfenced. Rows default to non-public, sendSol is capped and guarded, so impact is bounded to the owner's own chat. Non-binding priority hint: low. Suggested fix: Do not write anonymous turns to the working tier; fence recalled snippets as untrusted data; require the user message to authorize sendSol.

Claimed root cause: Public unauthenticated write path stores attacker text in a tier the owner chat trusts; recall unfenced.

Trace:
- entrypoint: api/agent-ask.js:248
- propagation: api/agent-ask.js:311
- propagation: api/agent-ask.js:191
- propagation: api/_lib/memory-store.js:481
- propagation: api/chat.js:2120
- sink: api/chat.js:2198

Evidence:
- api/agent-ask.js:16: comment claims lowest tier avoids polluting
- api/_lib/memory-store.js:473: working = in-context-now set
- api/chat.js:402: sendSol tool offered
- api/agent/send-sol.js:83: recipient lock depends on env

## agent-ask serves unpublished agents' private persona, system prompt and custom skills to anonymous callers

Fingerprint: `ai-llm-agent-ask-unpublished-persona-skills-disclosure`

POST /api/agent-ask (agent-ask.js:248) selects agent by id and deleted_at only (261), loads agentSkillsForPrompt (289), builds system prompt with persona/system_prompt and skills (70, 290) for anonymous asker. api/chat.js:546 requires is_published OR owner; chat.js:632 says persona prompts are private IP; 685 skills only when agentVisible. Anonymous caller knowing an unpublished agent UUID can have the model reveal persona/skills. Prompt instruction not to reveal is not deterministic. Verifier assessment: agent-ask looks up agents without an is_published/owner filter and injects persona and skills into the prompt; chat.js gates the same data. Needs an unpublished agent UUID. Non-binding priority hint: low. Suggested fix: Add AND (is_published = true OR user_id = caller) to the lookup at agent-ask.js:261 and load skills only for visible agents.

Claimed root cause: Missing visibility predicate on sibling path.

Trace:
- entrypoint: api/agent-ask.js:248
- propagation: api/agent-ask.js:261
- propagation: api/agent-ask.js:289
- sink: api/agent-ask.js:290

Evidence:
- api/chat.js:546: sibling control
- api/chat.js:632: comment: private IP
- api/chat.js:685: skills gated by agentVisible
- api/agent-ask.js:70: persona and skills inserted verbatim

## Sign-in completion endpoints issue a session without binding to the initiating browser (login CSRF)

Fingerprint: `api-auth-login-csrf-unbound-signin-completion`

Handoff exchange GET (api/auth/handoff.js:98,131-132) redeems bearer code, destroySession then createSession for code owner, no origin/cookie binding (mint side line 69 requires isSameSiteOrigin). Telegram widget callback (telegram/[action].js:119 default {i:'login'} when flow cookie absent; signIn 70,180) creates session for payload identity. SAML ACS (saml/[action].js:72,119-120) accepts unsolicited POST. Attacker with own code/payload/assertion makes victim browser sign in as attacker; victim data saved under attacker account. privy/verify.js:40 enforces isSameSiteOrigin as comparable control. Session cookie SameSite=Lax (auth.js:144) so top-level GET carries/sets. Verifier assessment: Handoff exchange GET, Telegram callback without a flow cookie, and SAML ACS complete sign-in with no browser binding, so a victim can be signed in as the attacker (login CSRF). No account takeover; needs victim interaction. Non-binding priority hint: low. Suggested fix: Require the signed flow cookie on Telegram, enforce InResponseTo and bind RelayState for SAML, and add a confirm step or Sec-Fetch-Site check before the handoff replaces a session.

Claimed root cause: Completion handlers set session cookie with no per-flow browser binding.

Trace:
- entrypoint: api/auth/handoff.js:98
- propagation: api/auth/handoff.js:131
- propagation: api/auth/telegram/[action].js:119
- propagation: api/auth/telegram/[action].js:180
- propagation: api/auth/saml/[action].js:72
- sink: api/auth/saml/[action].js:120

Evidence:
- api/auth/handoff.js:69: mint side has same-site check
- api/auth/privy/verify.js:40: comparable endpoint enforces guard
- api/auth/telegram/[action].js:107: flow cookie exists but absence tolerated at 119
- api/_lib/auth.js:144: SameSite=Lax

## Unauthenticated /api/tty SSRF guard bypassed by redirect-following, unpinned fetch

Fingerprint: `api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch`

GET /api/tty?src=<url> is unauthenticated and only IP-rate-limited. It validates src once with assertSafePublicUrl (DNS check only), then passes the URL string to packages/tty-3d loadModel, which calls global fetch with redirect:'follow' and no dispatcher pin. A public URL that 302s to an internal/metadata address passes the guard and is followed with no re-validation; DNS rebinding also works. The avatar branch passes avatar.model_url to loadModel with no SSRF check at all. Error message `could not read that model: ${err.message}` is returned to the caller. Verifier assessment: /api/tty validates the URL once then fetches with default fetch and redirect follow, so a public URL redirecting to an internal address or a rebinding host reaches internal targets. Mostly blind: the body must parse as GLB, but the error text leaks status. Non-binding priority hint: medium. Suggested fix: Pass the pinned per-hop fetcher with redirect manual to loadModel for both src and avatar.model_url branches; return a generic error.

Claimed root cause: tty.js uses assertSafePublicUrl as a one-shot pre-check and then delegates the fetch to loadModel with default global fetch and redirect:'follow', instead of the repo's pinned per-hop fetcher (fetchModel / fetchSafePublicUrlPinned).

Trace:
- entrypoint: api/tty.js:111
- propagation: api/tty.js:85
- propagation: api/_lib/ssrf-guard.js:111
- propagation: api/tty.js:144
- sink: packages/tty-3d/src/index.js:30

Evidence:
- api/tty.js:85: Guard is a pre-check only.
- packages/tty-3d/src/index.js:30: redirect:'follow', global fetch, no pin.
- api/tty.js:95: avatar.model_url passed to loadModel with no SSRF validation.
- api/_lib/fetch-model.js:79: Contrast: sibling proxies use redirect:'manual' with per-hop resolvePublicHost and pinned dispatcher.

## Oracle follower subscriptions are unauthenticated and keyed by caller-supplied Telegram chat_id

Fingerprint: `business-logic-oracle-follow-unauthenticated-chat-subscription-tamper`

api/oracle/follow.js:14 documents no auth; POST (94,131) inserts oracle_followers, DELETE (139) removes, GET (158) lists, keyed by caller-supplied (agent_id, chat_id, network); only IP rate limits. Third party can unsubscribe victim chat, subscribe chats to platform bot messages (alerts.js:349 reads same table), enumerate follows. Verifier assessment: api/oracle/follow has no auth and keys subscriptions on caller-supplied chat_id, so anyone can unsubscribe or subscribe arbitrary chats. GET is a single-pair check, not a list. Content is public signals; delivery needs the chat to have started the bot. Non-binding priority hint: low. Suggested fix: Require proof of chat control, for example a signed /start deep-link nonce bound to chat_id and agent_id, on POST and DELETE.

Claimed root cause: chat_id used as identity with no proof of chat control.

Trace:
- entrypoint: api/oracle/follow.js:14
- propagation: api/oracle/follow.js:59
- propagation: api/oracle/follow.js:94
- propagation: api/oracle/follow.js:131
- sink: api/_lib/oracle/alerts.js:349

Evidence:
- api/oracle/follow.js:158: anonymous list
- api/_lib/oracle/alerts.js:349: dispatch reads same table

## Oracle test-alert sends unescaped owner-controlled HTML to an arbitrary chat from the platform bot

Fingerprint: `business-logic-oracle-test-alert-arbitrary-chat-html-injection`

api/oracle/test-alert.js: chat_id format-validated only (22); ownership of agent only not destination (49); agentName from owner agent record (60) interpolated unescaped (61) in parse_mode HTML message (80). Low confidence: auth exists, Telegram delivers only to chats that started the bot. Verifier assessment: test-alert lets any signed-in user send a bot message with raw agent.name in HTML parse mode to any chat_id. Telegram's tag subset limits it to links and formatting; needs a chat that started the bot. Non-binding priority hint: low. Suggested fix: HTML-escape agentName; bind chat_id to a chat the caller verified.

Claimed root cause: Unescaped interpolation and unrestricted destination.

Trace:
- entrypoint: api/oracle/test-alert.js:22
- propagation: api/oracle/test-alert.js:47
- propagation: api/oracle/test-alert.js:50
- propagation: api/oracle/test-alert.js:64
- sink: api/oracle/test-alert.js:80

Evidence:
- api/oracle/test-alert.js:61: agentName unescaped
- api/oracle/test-alert.js:80: parse_mode HTML

## Vault deposit can mint zero shares after an outside donation inflates NAV

Fingerprint: `business-logic-vault-deposit-zero-share-mint-donation-inflation`

depositToVault (vault-transfer.js:99 transfers USDC first, 114 navBefore, 115 minted=sharesForDeposit with no minted>0 guard). vault-accounting.js:122 par only when shares or navBefore zero else floor(deposit*shares/navBefore). vault-wallet.js:101,124 NAV includes live on-chain USDC of public vault_address (donation-manipulable). deposit.js:44 only checks real-funds agreement; no minimum. First depositor with tiny shares donates to inflate; later smaller deposit mints 0, funds kept by existing holders. Verifier assessment: Vault deposits mint floor(deposit*shares/NAV) with NAV read from the on-chain balance, no minted>0 check, no virtual shares, no min_shares. A first-depositor donation can make a later deposit mint zero shares. Non-binding priority hint: medium. Suggested fix: Reject minted<=0 and refund; add min_shares_out; seed dead or virtual shares; require a minimum first deposit; track accounted balance.

Claimed root cause: Share pricing from donation-manipulable live balance with no zero-mint guard or virtual shares.

Trace:
- entrypoint: api/vaults/deposit.js:44
- propagation: api/vaults/deposit.js:52
- propagation: api/_lib/vault-transfer.js:99
- propagation: api/_lib/vault-transfer.js:115
- propagation: api/_lib/vault-accounting.js:122
- sink: api/_lib/vault-wallet.js:101

Evidence:
- api/_lib/vault-transfer.js:115: no positive-share guard
- api/_lib/vault-accounting.js:122: floor division
- api/_lib/vault-wallet.js:124: NAV from on-chain balance

## Anonymous chat proxy forwards full request body to OpenRouter on platform key; extra fields can reach non-free models/paid features

Fingerprint: `chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate`

POST /api/chat/proxy unauthenticated, per-IP limit only. isFreeModelId (openrouter-free.js:46) checks only body.model ends ':free' (proxy.js:84). proxy.js:128 sends JSON.stringify({...body, model: activeModel}) with platform Bearer key, passing 'models' fallback, 'plugins', 'provider', large max_tokens. Billing effect unobserved. Verifier assessment: /api/chat/proxy gates only on a :free model suffix and then spreads the whole client body upstream with the platform key, so models, plugins, provider and max_tokens pass through. Billing effect depends on OpenRouter behavior. Non-binding priority hint: medium. Suggested fix: Build the upstream payload from an explicit allowlist; clamp max_tokens; cap message size.

Claimed root cause: Allowlist on one field but upstream payload built by spreading untrusted body.

Trace:
- entrypoint: api/chat/proxy.js:65
- propagation: api/chat/proxy.js:84
- propagation: api/_lib/openrouter-free.js:46
- sink: api/chat/proxy.js:128

Evidence:
- api/chat/proxy.js:84: only :free suffix check
- api/chat/proxy.js:128: whole body spread, only model overridden
- api/_lib/openrouter-free.js:46: pure string suffix test

## Go chat tool server exposes shell, file write and arbitrary file read with no auth by default, all interfaces, wildcard CORS

Fingerprint: `chat-server-tool-server-unauthenticated-shell-default`

chat/server/main.go: Addr :8081 (53), CORS origin * headers * (33), authMiddleware only when *password != "" (112) default empty (25). POST /tool InvokeTool (148) runs Shell via mvdan interp (toolfns/shell.go:214, real processes) and Edit (toolfns.go:112 arbitrary file write); GET /read_file reads any path (files.go:83). Web page in browser can hit localhost:8081; LAN host directly. Password compare is raw string 'Basic '+password, not constant-time. Request body (tool args) tee'd to stdout. Verifier assessment: The Go chat tool server defaults to no password, wildcard CORS and a listen address on all interfaces, and exposes shell, edit and file read. Any web page or LAN host could reach it if run with defaults. Non-binding priority hint: high. Suggested fix: Bind 127.0.0.1 by default; refuse to start without a password or generate a token; constant-time compare; restrict CORS; confine read_file and Edit; stop logging bodies.

Claimed root cause: Fail-open auth, non-loopback bind, wildcard CORS in front of OS command and file write surface.

Trace:
- entrypoint: chat/server/main.go:33
- propagation: chat/server/main.go:53
- propagation: chat/server/main.go:112
- propagation: chat/server/main.go:148
- propagation: chat/server/toolfns/shell.go:214
- sink: chat/server/files.go:83

Evidence:
- chat/server/main.go:25: password default empty
- chat/server/main.go:53: :8081 all interfaces
- chat/server/files.go:83: ReadFile no confinement
- chat/server/toolfns/toolfns.go:112: Edit arbitrary write

## Published agent's third-party persona/skills share a prompt with a signed-in visitor's home tools, executed under visitor authority

Fingerprint: `chat-third-party-persona-drives-visitor-home-tools`

POST /api/chat loads any published agent persona (chat.js:545,641), custom skills (688), public memories; offers home tools whenever caller has a home membership (706); model-emitted home calls run via runHomeRound/runHomeTool with visitor userId (1130,1346). Confirmation gate covers only unlock/open/disarm-class services (home/tools.js:528); other write services (lock, close, arm, scenes) execute immediately. sendSol gate applies only to gated imported skills. Verifier assessment: A published agent's persona and skills run for any visitor, and home tools are added for visitors with a home membership, so a malicious owner could try to prompt-inject unrequested home actions. Depends on model compliance and which services the classifier guards. Non-binding priority hint: medium. Suggested fix: Withhold home tools or require confirmation for every write when the agent owner differs from the caller and carries a persona or custom skills; mark persona content untrusted.

Claimed root cause: Visitor authority and untrusted third-party prompt content combined in one turn; no check that a home write was requested in the visitor message or withholding of tools for non-owned persona.

Trace:
- entrypoint: api/chat.js:545
- propagation: api/chat.js:641
- propagation: api/chat.js:688
- propagation: api/chat.js:706
- propagation: api/chat.js:1130
- propagation: api/chat.js:1346
- sink: api/_lib/home/tools.js:528

Evidence:
- api/chat.js:545: any published agent loadable
- api/chat.js:706: tool set depends only on homeCount
- api/chat.js:1346: runs with visitor identity
- api/_lib/home/tools.js:528: confirmation gate only guarded classes

## createAgent authority gate is vacuous, letting the first caller squat any agentToken

Fingerprint: `contracts-agentpayments-createagent-caller-chosen-authority-token-squat`

contracts/src/AgentPayments.sol:136-140 requires msg.sender to be owner or the caller-supplied agentAuthority, so a caller satisfies it by naming themself. First caller squats any agentToken; AgentExists blocks the real owner; acceptPayment (152) and withdraw (306) pay the squatter. Verifier assessment: createAgent accepts msg.sender == the caller-supplied agentAuthority, so any address can register any agentToken and block the real owner with AgentExists; payments then settle to the squatter. Non-binding priority hint: high. Suggested fix: Bind registration to proof of token control (owner-signed EIP-712, token owner check, or owner-only), and add an owner reassign or remove function.

Claimed root cause: Authority is taken from caller input rather than proven.

Trace:
- entrypoint: contracts/src/AgentPayments.sol:136
- propagation: contracts/src/AgentPayments.sol:139
- propagation: contracts/src/AgentPayments.sol:142
- propagation: contracts/src/AgentPayments.sol:152
- sink: contracts/src/AgentPayments.sol:306

Evidence:
- contracts/src/AgentPayments.sol:136: msg.sender == agentAuthority accepted

## Portfolio creator can propose unbounded rebalance targets and drain via open fillRebalance

Fingerprint: `contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain`

Portfolio.sol:440 proposeRebalance checks only targetUnits length. Constructor (198) sets no floor on rebalanceDelay/rebalanceInterval and PortfolioFactory.sol:49 forwards creator Config. quoteFill (312) prices from creator targets and fillRebalance (473) is open to any caller, so a creator-controlled fill can extract value. Verifier assessment: Portfolio proposeRebalance bounds only the targets length and the constructor sets no minimum delay or interval, so a creator can skew targets and let fillRebalance trade at off-market prices. Depositors can redeem during a nonzero delay. Real path is contracts/hood-portfolios/src, not contracts/src/hood. Non-binding priority hint: medium. Suggested fix: Add minimum delay and interval; cap per-leg target change; add an oracle or NAV-loss limit in quoteFill.

Claimed root cause: No bounds on creator-set targets or timing parameters.

Trace:
- entrypoint: contracts/hood-portfolios/src/Portfolio.sol:440
- propagation: contracts/hood-portfolios/src/Portfolio.sol:447
- propagation: contracts/hood-portfolios/src/Portfolio.sol:198
- propagation: contracts/hood-portfolios/src/PortfolioFactory.sol:49
- propagation: contracts/hood-portfolios/src/Portfolio.sol:312
- sink: contracts/hood-portfolios/src/Portfolio.sol:473

Evidence:
- contracts/src/hood/Portfolio.sol:440: length-only check

## Strategy-run buys count as zero toward the agent daily SOL cap

Fingerprint: `custody-spend-policy-daily-cap-ignores-strategy-run-buys`

handleStrategyRun reaches pump-fun-trade handler which persists agent_actions pumpfun.buy with payload {mint, amountSol, sig}; agent-spend-policy.js:78 sums payload->>'solAmount', so strategy buys contribute zero to daily_sol_cap (default 5 SOL). Strategy path uses non-atomic checkBuyAllowed, not reserveSpend, and loadWallet without audit context, skipping assertPlatformSigningAllowed. Verifier assessment: Strategy buys persist payload key amountSol while the daily cap sums solAmount, so they count as zero toward daily_sol_cap. Only the per-tx cap applies. Principal is the agent owner or a spend-scoped key, so this bypasses the owner's cap rather than crossing tenants. The loadWallet audit-context point is not a separate bug. Non-binding priority hint: medium. Suggested fix: Write solAmount in the note or COALESCE(solAmount, amountSol) in the SUM; use atomic reserveSpend in the strategy path.

Claimed root cause: Cap sums a payload key the strategy path never writes.

Trace:
- entrypoint: api/pump/[action].js:3761
- propagation: api/pump/[action].js:3866
- propagation: examples/skills/pump-fun-trade/handlers.js:55
- propagation: api/_lib/skill-runtime.js:135
- sink: api/_lib/agent-spend-policy.js:78

Evidence:
- api/pump/[action].js:3869: checkBuyAllowed instead of reserveSpend
- api/_lib/solana-wallet.js:15: loadWallet without audit context

## Walk Avatar extension stores any token from a three.ws auth-callback URL (login CSRF / session fixation)

Fingerprint: `extensions-walk-avatar-auth-callback-token-injection-no-state-binding`

background.js tabs.onUpdated persists the token query/hash param of any top-level tab whose URL starts with https://three.ws/extension/auth-callback into chrome.storage.local.threews_session, then closes the tab. No state/nonce ties it to a sign-in the user started; no check the token belongs to the current user; callback page treats any ?token= as success. Attacker mints own extension token (POST /api/auth/extension-token) and navigates victim to /extension/auth-callback?token=<attacker token>; extension then holds attacker identity (scope avatars:read). For a victim signed out of three.ws, popup avatar lists and narrator /api/tts/speak run as attacker account. Impact limited: tts/speak.js prefers cookie session over bearer, avatars/mine.js likely too. Verifier assessment: The extension accepts any auth-callback URL token with no state binding and overwrites its stored session (login CSRF). Token has extension scope only; cookie session takes precedence in speak.js. Non-binding priority hint: low. Suggested fix: Add a per-sign-in nonce in chrome.storage.session and accept the token only with a matching state, or deliver the token via runtime messaging.

Claimed root cause: Auth-callback capture is trust-on-navigation: token accepted from URL with no binding to a locally initiated login.

Trace:
- entrypoint: extensions/walk-avatar/background.js:224
- propagation: extensions/walk-avatar/background.js:226
- propagation: extensions/walk-avatar/background.js:231
- propagation: extensions/walk-avatar/background.js:237
- propagation: api/tts/speak.js:67
- sink: api/auth/extension-token.js:76

Evidence:
- extensions/walk-avatar/background.js:226: prefix-only check, no state
- extensions/walk-avatar/background.js:237: unconditional overwrite
- public/extension-auth-callback.html:80: any non-empty token treated as success
- api/auth/extension-token.js:76: any account can mint a token
- api/tts/speak.js:67: cookie session takes precedence over bearer

## CAD Forge parent reads child-controlled artifact paths with symlink-following open

Fingerprint: `glb-media-cad-forge-collect-follows-child-symlink`

main._collect trusts child-written result.json 'files' list; checks name against ARTIFACT_KEYS and os.path.isfile then open(path,'rb') following symlinks. Workdir chowned to nobody; child can create symlinks (seccomp deny list lacks symlink/symlinkat). Symlink part.glb -> /proc/1/environ makes the root parent base64 it into the response; getsize on /proc reports 0 so 24MB cap does not bound it. Needs a child-side primitive (companion candidate). Verifier assessment: cad-forge _collect opens child-named files following symlinks, a conditional privilege gain only if submitted code can already create a symlink in the child. The policy exposes no such primitive on its own, so this is defense in depth. Non-binding priority hint: low. Suggested fix: Open with O_NOFOLLOW, fstat for a regular file, bounded read from the fd; add symlink, symlinkat, link and linkat to SECCOMP_DENY.

Claimed root cause: Privileged parent opens files from a child-controlled dir without lstat/O_NOFOLLOW/realpath confinement.

Trace:
- entrypoint: workers/cad-forge/main.py:311
- propagation: workers/cad-forge/sandbox_child.py:185
- propagation: workers/cad-forge/main.py:264
- propagation: workers/cad-forge/main.py:218
- sink: workers/cad-forge/main.py:228

Evidence:
- workers/cad-forge/main.py:97: workdir chowned to nobody
- workers/cad-forge/sandbox_child.py:49: SECCOMP_DENY lacks symlink/symlinkat
- workers/cad-forge/Dockerfile:22: comment: tests run as root like Cloud Run

## CAD Forge static policy does not block frame/code-object attributes (generator frame walk to real globals/builtins)

Fingerprint: `glb-media-cad-forge-policy-frame-attribute-escape`

workers/cad-forge/cad_policy.py check_source rejects only underscore-prefixed attributes plus format/format_map/vformat/mro. gi_frame, f_back, f_globals, f_builtins, f_locals, gi_code, cr_frame, tb_frame pass. `def g(): yield x.gi_frame.f_back.f_back.f_globals` could reach sandbox_child's globals (os, sys) and real builtins (open, eval, __import__). Program text comes from an LLM prompted by an arbitrary user of api/cad.js and MCP cad tool. If the walk works the AST/builtins layer is void; seccomp, nobody uid, rlimits remain. Verifier assessment: cad_policy blocks only underscore and a few attribute names, so generator and frame attributes such as gi_frame, f_back and f_globals pass and may reach the sandbox_child module globals (os, real builtins). Python behavior inferred; seccomp and uid drop remain. Non-binding priority hint: medium. Suggested fix: Switch to an attribute allowlist or deny gi_*, cr_*, ag_*, f_*, tb_* and co_*; reject Yield and GeneratorExp if unneeded; exec from a module whose frames reach nothing sensitive.

Claimed root cause: Attribute denylist is underscore-prefix based and omits non-underscore frame/generator/traceback introspection attributes.

Trace:
- entrypoint: workers/cad-forge/main.py:311
- propagation: workers/cad-forge/cad_policy.py:58
- propagation: workers/cad-forge/cad_policy.py:118
- propagation: workers/cad-forge/sandbox_child.py:172
- sink: workers/cad-forge/sandbox_child.py:185

Evidence:
- workers/cad-forge/cad_policy.py:58: BANNED_ATTRIBUTES only format,format_map,vformat,mro
- workers/cad-forge/cad_policy.py:130: underscore check only other control
- workers/cad-forge/cad_policy.py:60: safe builtins keep iter,next,super,isinstance; def/yield allowed ~141
- workers/cad-forge/sandbox_child.py:172: run_program frame f_globals is module namespace with os/sys at 22-31

