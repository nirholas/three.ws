# Planning corpus coverage ledger

Every tracked markdown file in the repository on 2026-11-03 (2969 files), and what became of it in the sweep that produced the `plan-` work orders. Use it to answer "was this doc turned into a task?" for any file. The queue itself is [plan-00-INDEX.md](plan-00-INDEX.md).

| Disposition | Files | Meaning |
|---|---:|---|
| order | 204 | Outstanding work was found; it is now the linked work order(s), with this file copied verbatim inside. |
| shipped | 200 | The work it describes exists in the code today (the note names the evidence). |
| covered-by-existing | 94 | An order that was already in the queue covers it. |
| no-open-work | 803 | Reviewed: reference or descriptive doc with nothing outstanding. |
| not-a-plan | 269 | Content, rules, or configuration rather than work to do. |
| owner-only | 95 | Open, but only the owner can do it (no agent-doable part). |
| retired-by-owner | 16 | The owner retired this work on 2026-09-09 (finish/_context/00-RETIRED-BY-OWNER.md). |
| excluded | 1288 | Not reviewed for tasks by category (vendored code, skill bundles, published content, existing orders). |

| File | Disposition | Detail |
|---|---|---|
| `.agents/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/anatomy/reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/anatomy/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/authenticate-wallet/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/build-an-agent-skill/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/connect-three-ws-mcp/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/create-3d-avatar/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/create-a-three-ws-agent/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/embed-three-ws-avatar/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/find-3d-assets/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/fund/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/gcp-triage/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/generate-3d-model/reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/generate-3d-model/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/hire-an-agent/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/auth.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/chain.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/decode.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/errors.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/market-data.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/perps.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/polling.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/predict.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/signing.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/swap.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/transaction.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/transfer.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/references/wallet.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-borrow.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-collateral.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-positions.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-repay.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-supply.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/aave-withdraw.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/bridge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/login.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/market-data.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/onboarding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/perps-close-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/perps-modify-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/perps-open-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/predict-funding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/predict-manage-orders.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/predict-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/predict-place-order.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/predict-portfolio.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/predict-setup.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/swap.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-wallet/workflows/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-borrow.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-collateral.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-positions.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-repay.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-supply.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/aave-withdraw.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/bridge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/login.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/market-data.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/onboarding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/perps-close-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/perps-modify-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/perps-open-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/predict-funding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/predict-manage-orders.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/predict-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/predict-place-order.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/predict-portfolio.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/predict-setup.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/swap.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/metamask-agent-workflows/workflows/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/monetize-service/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-chat/ensure-okx-a2a-communication-ready.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-chat/file-attachment.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-chat/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-chat/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/discover.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/errors.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/invariants.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/manage.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/register.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/reputation.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/references/update.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-identity/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/_shared/amount-display.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/references/a2a_charge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/references/accepts-schemes.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/references/charge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/references/multi-scheme.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/references/session.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-payments-protocol/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/_shared/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/_shared/exception-escalation.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/_shared/state-machine.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/_shared/user-intent-routing.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/asp-accept.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/asp.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/evaluator.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/references/evaluator-decision-rubric.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/references/evaluator-staking.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/user-actions-publish.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/user-actions.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/user-playbook.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agent-task/user-sub-playbook.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/gas-station-edge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/gas-station-faq.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/gas-station.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/mev-protection.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/plugin-preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/portal-actions.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/references/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-agentic-wallet/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-ai-guide/references/intro.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-ai-guide/references/registered-home.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-ai-guide/references/unregistered-role-selection.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-ai-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-ai-support/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-audit-log/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dapp-discovery/references/keyword-glossary.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dapp-discovery/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-defi-invest/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-defi-invest/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-defi-portfolio/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-bridge/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-bridge/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-bridge/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-bridge/references/transit-fallback.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-bridge/references/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-bridge/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/_shared/payment-notifications.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/references/keyword-glossary.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/references/ws-protocol.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-market/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-signal/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-signal/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-signal/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-signal/references/keyword-glossary.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-signal/references/ws-protocol.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-signal/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-social/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-social/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-social/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-social/references/keyword-glossary.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-social/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-strategy/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-strategy/references/backend-schema.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-strategy/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-swap/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-swap/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-swap/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-swap/references/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-swap/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-token/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-token/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-token/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-token/references/keyword-glossary.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-token/references/ws-protocol.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-token/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-trenches/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-trenches/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-trenches/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-trenches/references/keyword-glossary.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-trenches/references/ws-protocol.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-trenches/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-dex-ws/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-growth-competition/references/claim.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-growth-competition/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-growth-competition/references/details.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-growth-competition/references/participation.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-growth-competition/references/rank.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-growth-competition/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-how-to-play/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-how-to-play/references/welcome.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-how-to-play/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-onchain-gateway/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-onchain-gateway/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-onchain-gateway/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-security/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-security/references/risk-approval-monitoring.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-security/references/risk-domain-detection.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-security/references/risk-token-detection.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-security/references/risk-transaction-detection.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-security/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-task-watch/references/background-recovery.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-task-watch/references/outdated-list.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-task-watch/references/wake-scheduling.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-task-watch/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-wallet-portfolio/_shared/chain-support.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-wallet-portfolio/_shared/preflight.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-wallet-portfolio/references/cli-reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/okx-wallet-portfolio/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/pay-for-service/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/query-onchain-data/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/rig-a-model/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/search-for-service/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/sell-an-agent-skill/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/send-usdc/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/SKILLS.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/trade/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.agents/skills/x402/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.claude-plugin/README.md` | no-open-work | reference doc, no open work |
| `.claude/agents/completionist.md` | excluded | agent configuration |
| `.claude/agents/deploy-preflight.md` | excluded | agent configuration |
| `.claude/agents/x402-economy-triage.md` | excluded | agent configuration |
| `.claude/skills/changelog-and-docs/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.claude/skills/deploy-runbook/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.claude/skills/engineering-standards/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.claude/skills/maintain-claude-md/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.claude/skills/self-unblock-playbook/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `.github/PULL_REQUEST_TEMPLATE.md` | excluded | license, changelog or repository boilerplate |
| `.github/SECURITY.md` | excluded | license, changelog or repository boilerplate |
| `agent-payments-sdk/docs/api.md` | no-open-work | reference doc, no open work |
| `agent-payments-sdk/docs/events.md` | no-open-work | reference doc, no open work |
| `agent-payments-sdk/docs/pdas.md` | no-open-work | reference doc, no open work |
| `agent-payments-sdk/docs/x402.md` | no-open-work | reference doc, no open work |
| `agent-payments-sdk/FORK_NOTES.md` | no-open-work | reference doc, no open work |
| `agent-payments-sdk/README.md` | no-open-work | reference doc, no open work |
| `agent-payments-sdk/src/solana/examples/README.md` | no-open-work | reference doc, no open work |
| `agent-protocol-sdk/README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). program id AgEnt...Zfo not deployed on devnet or mainnet |
| `agent-ui-sdk/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `agent-ui-sdk/README.md` | no-open-work | reference doc, no open work |
| `AGENTS.md` | not-a-plan | agent rules file |
| `agents/endpoint-shopper/README.md` | no-open-work | agent README |
| `agents/fact-checker/README.md` | no-open-work | agent README |
| `agents/README.md` | no-open-work | agent README |
| `agents/tutor/README.md` | no-open-work | agent README |
| `agents/unstoppable/README.md` | no-open-work | agent README |
| `agents/x402-buildout/README.md` | shipped | all 83 pack prompts are registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/001-mcp-model-validation-sweep.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/002-avatar-optimization-pipeline.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/003-avatar-search-index-warmup.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/004-solana-agent-registration-ping.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/005-reputation-score-refresh.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/006-mcp-latency-monitor.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/007-granite-inference-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/008-bazaar-search-warmup.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/009-cross-network-payment-probe.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/010-streaming-mcp-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/011-glb-canonicalization-pipeline.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/012-animation-retargeting-test.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/013-scene-capture-processing.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/014-forge-content-generation.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/015-avatar-thumbnail-regen.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/016-model-metadata-enrichment.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/017-rig-complexity-scoring.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/018-glb-compression-optimizer.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/019-vrm-compatibility-checker.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/020-avatar-pricing-engine.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/021-sniper-data-enrichment.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/022-three-intel-signal-feed.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/023-token-intel-sniper-gate.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/024-wallet-balance-monitor.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/025-payment-feed-seeder.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/026-volume-bootstrap-loop.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/027-revenue-reconciliation.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/028-fee-calculation-validator.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/029-payment-proof-audit.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/030-builder-code-attribution.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/031-charity-split-verifier.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/032-subscription-status-checker.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/033-api-key-rotation-test.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/034-spend-reservation-audit.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/035-cross-chain-cost-analysis.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/036-bazaar-catalog-refresh.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/037-service-pricing-tracker.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/038-service-uptime-monitor.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/agent-registration-sweep.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/analytics-agent-leaderboard.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/analytics-club-activity.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/analytics-marketplace-catalog.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/analytics-sniper-performance.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/analytics-user-activity.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/analytics-x402-volume.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/api-key-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/auth-session-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/bazaar-new-listings.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/bazaar-price-trends.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/club-membership-snapshot.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/club-revenue-summary.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/cross-chain-bridge-status.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/did-registry-sweep.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/did-verification-canary.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/forge-generation-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/forge-image-canary.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/json-api-schema-check.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/llm-proxy-latency.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/llm-proxy-quality.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/mcp-tool-catalog-sync.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/mcp-tool-discovery.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/notification-delivery-probe.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/pay-by-name-resolution.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/pump-launch-monitor.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/pump-trending-score.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/pump-volume-anomaly.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/pump-whale-tracker.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/rate-limit-probe.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/reputation-decay-check.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/reputation-leaderboard.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/rss-feed-validity.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/skill-execution-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/skill-marketplace-popular.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/skill-marketplace-pricing.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/spend-session-audit.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/spend-session-canary.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/symbol-availability-scan.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/telegram-bot-health.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/token-intel-sol-price.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/token-intel-three.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/token-intel-usdc.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `agents/x402-buildout/self/wallet-connect-probe.md` | shipped | registered in api/_lib/x402/autonomous-registry.js |
| `animation-sources/README.md` | no-open-work | source catalog reference; animation identity order reads the manifest, not this doc |
| `api/_lib/avatar-composer/README.md` | order | [774](../774-plan-avatar-composer-parametric-variety.md). roadmap: body-shape variety and bone accessories now possible on parametric base |
| `api/_lib/launch/README.md` | no-open-work | reference doc, no open work |
| `api/_lib/x-guest/README.md` | no-open-work | reference doc, no open work |
| `api/_lib/x402/agents/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/_okx3d/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/agents/REGISTER_FLOW.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/agents/SOLANA_OPS.md` | no-open-work | shipped ops reference |
| `api/avatars/REGENERATE.md` | order | [790](../790-plan-docs-avatar-regenerate-api-reference-refresh.md). stale stub/501/future-migration text; pipeline shipped in api/_lib/regen-provider.js |
| `api/coin/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/defi/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/irl/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/news/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/notifications/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `api/v1/README.md` | no-open-work | provider table is rendered live from the registry; only a hand-kept quota note remains |
| `api/x402-prepaid/README.md` | shipped | api/x402-prepaid endpoints documented |
| `api/x402/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `apple/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `apps-sdk/embodiment/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `apps-sdk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `apps/desktop/README.md` | no-open-work | reference README for shipped companion app |
| `apps/forge-desktop/api/README.md` | no-open-work | reference README |
| `apps/forge-desktop/api/texture_baker/README.md` | no-open-work | reference README |
| `apps/forge-desktop/api/uv_unwrapper/README.md` | no-open-work | reference README |
| `apps/forge-desktop/arch/decisions/AMD-ROCM-SUPPORT.md` | no-open-work | implemented in electron/main/gpu-detect.ts; Windows run needs AMD hardware |
| `apps/forge-desktop/arch/decisions/APPLE-SILICON-SUPPORT.md` | no-open-work | decision record, implemented; hardware-dependent verification only |
| `apps/forge-desktop/arch/decisions/README.md` | no-open-work | index of decision records |
| `apps/forge-desktop/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `apps/forge-desktop/docs/running-on-amd-rocm.md` | no-open-work | user guide for shipped behavior |
| `apps/forge-desktop/docs/running-on-jetson.md` | no-open-work | user guide, unsupported platform by design |
| `apps/forge-desktop/README.md` | no-open-work | reference README |
| `apps/forge-desktop/tools/forge-cli/SKILL.md` | not-a-plan | skill file |
| `apps/hq/AGENTS.md` | not-a-plan | agent config file |
| `apps/hq/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `apps/hq/docs/crypto-rss-feeds.md` | not-a-plan | feed list reference |
| `apps/hq/docs/deploy-cloud-run.md` | owner-only | deploy runbook; HQ Cloud Run deploy is owner-gated |
| `apps/hq/docs/DOCUMENTATION.md` | no-open-work | reference documentation |
| `apps/hq/docs/fix-crypto-news-agents.md` | not-a-plan | prompts for a different repository (free-crypto-news) |
| `apps/hq/docs/local-backend-audit.md` | no-open-work | parity matrix with closure status recorded |
| `apps/hq/README.md` | no-open-work | reference README |
| `apps/hq/ROADMAP.md` | order | [737](../737-plan-hq-agent-defi-tools-and-context-bridge.md), [746](../746-plan-hq-protocol-dashboards-and-risk-heatmap.md). AI integration items and protocol dashboards/risk heatmap unbuilt; many checkboxes stale |
| `ARCHITECTURE.md` | order | [776](../776-plan-docs-architecture-known-gaps-truth-pass.md). Known Gaps rows stale vs api/_lib/env.js, secret-box.js, reflection.js |
| `assistant-sdk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `avatar-sdk/examples/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `avatar-sdk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `avatar-sources/anny/LICENSE.md` | excluded | vendored third-party source |
| `avatar-sources/anny/README.md` | excluded | vendored third-party source |
| `avatar-sources/README.md` | excluded | vendored third-party source |
| `awesome/CONTRIBUTING.md` | excluded | published curated list |
| `awesome/README.md` | excluded | published curated list |
| `blog/autonomous-trading-experiment-x-article.md` | excluded | published or archived content |
| `blog/autonomous-trading-experiment-x.md` | excluded | published or archived content |
| `blog/decision-optimization-3d-ai-crypto.md` | excluded | published or archived content |
| `blog/external-autonomous-trading-agent-draft.md` | excluded | published or archived content |
| `blog/internets-second-species.md` | excluded | published or archived content |
| `blog/README.md` | excluded | published or archived content |
| `blog/we-are-the-provider.md` | excluded | published or archived content |
| `blog/x402-stripe-for-agent-payments.md` | excluded | published or archived content |
| `CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `character-studio/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `character-studio/src/library/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `chat-plugin/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `chat/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `CLAUDE.md` | not-a-plan | agent rules file |
| `CODE_OF_CONDUCT.md` | excluded | license, changelog or repository boilerplate |
| `community-skills/.github/PULL_REQUEST_TEMPLATE.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/CONTRIBUTING.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/agent-hiring/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/alpha-scanner/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/dca-planner/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/honest-social-posts/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/launch-a-token/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/meme-token-scoring/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/pool-and-candles/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/risk-manager/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/three-ws-mcp/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/token-safety-check/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/whale-watch/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `community-skills/skills/x402-service-buyer/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `concierge-sdk/examples/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `concierge-sdk/examples/self-hosted-endpoint.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `concierge-sdk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `contracts/AGENT_PAYMENTS.md` | order | [984](../984-plan-evm-agentpayments-create2-deploy-readiness.md). deploy guide for undeployed EVM contract |
| `contracts/agent-invocation/README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). program not deployed; devnet smoke documented but not run |
| `contracts/AUDIT-README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). audit scope; programs not deployed on any cluster |
| `contracts/audit/static-analysis.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `contracts/DEPLOYMENTS.md` | order | [984](../984-plan-evm-agentpayments-create2-deploy-readiness.md). AgentPayments TODO rows and Basescan verification pending; BNB testnet items retired (910); other rows are history |
| `contracts/event-markets-stake/README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). program not deployed; owner-gated deploy steps in docs/event-markets-staking.md |
| `contracts/hood-portfolios/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `contracts/idl/pump/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `contracts/knock-escrow/README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). program not deployed; api/knock depends on it |
| `contracts/lib/forge-std/CONTRIBUTING.md` | excluded | vendored third-party source |
| `contracts/lib/forge-std/README.md` | excluded | vendored third-party source |
| `contracts/lib/forge-std/RELEASE_CHECKLIST.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/better-tires-pull.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/blue-jars-lay.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/bright-cooks-brush.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/chatty-dryers-joke.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/curly-pandas-flow.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/flat-flies-hear.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/floppy-symbols-burn.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/fruity-coats-smash.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/gentle-apples-dance.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/happy-pants-decide.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/heavy-pots-reply.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/legal-cameras-sin.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/rare-bushes-march.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/red-gifts-appear.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/silver-falcons-lay.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/smooth-cows-notice.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/some-dolls-shine.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/spicy-seals-bake.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/sweet-houses-cheer.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/tangy-jokes-begin.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.changeset/tidy-turkeys-build.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.github/ISSUE_TEMPLATE/bug_report.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.github/ISSUE_TEMPLATE/feature_request.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/.github/PULL_REQUEST_TEMPLATE.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/audits/2017-03.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/audits/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/CHANGELOG.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/CODE_OF_CONDUCT.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/CONTRIBUTING.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/docs/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/fv/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/GUIDELINES.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/lib/erc4626-tests/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/lib/forge-std/CONTRIBUTING.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/lib/forge-std/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/lib/forge-std/RELEASE_CHECKLIST.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/lib/halmos-cheatcodes/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/RELEASING.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/scripts/upgradeable/README.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/SECURITY.md` | excluded | vendored third-party source |
| `contracts/lib/openzeppelin-contracts/test/TESTING.md` | excluded | vendored third-party source |
| `contracts/paired-launchpad/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `contracts/program-tests/README.md` | no-open-work | LiteSVM suite shipped and documented |
| `contracts/README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md), [984](../984-plan-evm-agentpayments-create2-deploy-readiness.md). status table: Solana programs and AgentPayments not deployed |
| `contracts/skill-license/DEPLOYMENT.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). program absent on devnet and mainnet; keypair missing |
| `contracts/skill-license/README.md` | order | [969](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md). program not deployed |
| `contracts/v4-hooks/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `contracts/vanity/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `crates/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `crates/vanity-grinder/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `data/grok-skill-md.template.md` | not-a-plan | skill template rendered at build |
| `data/quality-bench/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `data/quality-bench/refs/SOURCES.md` | not-a-plan | reference source list |
| `data/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `data/reports/README.md` | excluded | published or archived content |
| `data/reports/x402-ring/COVERAGE.md` | excluded | published or archived content |
| `data/rss/SCHEMA.md` | excluded | published or archived content |
| `data/skill-md.template.md` | not-a-plan | skill template rendered at build |
| `data/skills/analysis/binance-crypto-market-rank/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/binance-token-info/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/crypto-data-aggregation-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/crypto-price-data-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/defillama-analytics-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/lstm-price-prediction-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/nft-analytics-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/onchain-metrics-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/token-discovery-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/token-research/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/tokenomics-evaluation/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/vc-research-intelligence/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/analysis/whale-wallet-tracking/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/community/crypto-governance-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/community/dao-governance-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/ai-agent-defi-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/cross-chain-bridge-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/defi-agent-definitions-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/dust-sweeping-defi-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/impermanent-loss-calculator/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/lending-protocol-comparison/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/liquidity-pool-assessment/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/restaking-explained/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/stablecoin-risk-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/x402-gas-station/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/yield-farming-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/defi/yield-vault-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/abi-to-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/agenti-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/ai-game-world-design/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/ai-plugin-marketplace-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/bnb-chain-toolkit-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/bnbchain-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/crypto-market-dashboard-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/crypto-market-data-service-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/decentralized-proxy-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/defi-dashboard-building/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/elizaos-plugin-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/ethereum-wallet-toolkit-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/github-to-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/giza-zkml-visualization/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/llms-txt-extraction-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/mcp-gateway-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/mcp-registry-monitoring-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/mcp-servers-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/mcp-tool-discovery-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/recommendation-algorithm-design/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/repo-intelligence-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/smart-contract-reading-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/smart-contract-testing/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/solana-toolkit-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/solidity-best-practices/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/solidity-playground-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/subgraph-development-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/tool-registry-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/universal-crypto-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/vanity-address-generation/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/web3-accessibility-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/x-twitter-automation-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/development/xeepy-python-twitter-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/general/ai-agents-library-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/general/data-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/general/openrouter-ai-models-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/general/research-assistant/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/general/web3-glossary/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/general/xai-grok-api-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/auth.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/chain.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/decode.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/errors.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/market-data.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/perps.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/polling.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/predict.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/signing.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/swap.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/transaction.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/transfer.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/references/wallet.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-borrow.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-collateral.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-positions.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-repay.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-supply.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/aave-withdraw.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/bridge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/login.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/market-data.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/onboarding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/perps-close-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/perps-modify-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/perps-open-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/predict-funding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/predict-manage-orders.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/predict-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/predict-place-order.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/predict-portfolio.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/predict-setup.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/swap.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-wallet/workflows/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-borrow.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-collateral.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-positions.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-repay.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-supply.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/aave-withdraw.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/bridge.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/login.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/market-data.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/onboarding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/perps-close-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/perps-modify-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/perps-open-position.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/predict-funding.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/predict-manage-orders.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/predict-markets.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/predict-place-order.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/predict-portfolio.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/predict-setup.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/swap.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/metamask-agent-workflows/workflows/troubleshooting.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/news/crypto-news-summary/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/news/free-crypto-news-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/news/social-sentiment-tracker/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/binance-query-address-info/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/crypto-tax-basics/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/portfolio-rebalancing/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/portfoliometa/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/risk-assessment/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/savvy-trader/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/portfolio/tax-loss-harvesting/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/aave-lending-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/arbitrum-defi-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/bitcoin-inscription-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/chainlink-oracle-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/erc8004-agent-creation-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/erc8004-agent-identity/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/ethereum-gas-optimization/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/sperax-ecosystem-overview/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/sperax-farms-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/sperax-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/sperax-spa-staking/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/sperax-usds-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/uniswap-v3-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/protocol/x402-agent-payments-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/agent-wallet-security/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/binance-token-audit/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/mev-protection-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/rug-pull-detection/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/smart-contract-auditing/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/token-approval-safety/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/wallet-security-review/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/security/web3auth-integration-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/airdrop-hunting-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/binance-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/binance-meme-rush/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/binance-spot/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/binance-trading-signal/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/binance-us-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/dca-strategy-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/four-meme-ai/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/four-meme-tool/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/market-sentiment-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/pump-fun-mcp-guide/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/technical-analysis/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/token-swap-best-practices/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/trade-execution-checklist/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/skills/trading/volume-trading-strategies/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `data/snapshots/README.md` | excluded | published or archived content |
| `data/x-archive/README.md` | excluded | published or archived content |
| `data/x-content/articles/agents-board-article.md` | excluded | published or archived content |
| `data/x-content/articles/any-skeleton-article.md` | excluded | published or archived content |
| `data/x-content/articles/embed-article.md` | excluded | published or archived content |
| `data/x-content/articles/forge-article.md` | excluded | published or archived content |
| `data/x-content/articles/holo-material-article.md` | excluded | published or archived content |
| `data/x-content/articles/how-we-render-3d-article.md` | excluded | published or archived content |
| `data/x-content/articles/keeper-article.md` | excluded | published or archived content |
| `data/x-content/articles/mcp-article.md` | excluded | published or archived content |
| `data/x-content/articles/partner-ibm-article-20261011.md` | excluded | published or archived content |
| `data/x-content/articles/proof-reels-article.md` | excluded | published or archived content |
| `data/x-content/articles/quality-gate-article.md` | excluded | published or archived content |
| `data/x-content/articles/run-receipts-article.md` | excluded | published or archived content |
| `data/x-content/articles/three-hold-to-access.md` | excluded | published or archived content |
| `data/x-content/articles/voice-article.md` | excluded | published or archived content |
| `data/x-content/articles/wardrobe-article.md` | excluded | published or archived content |
| `data/x-content/inputs/README.md` | excluded | published or archived content |
| `deploy/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `deploy/sniper/README.md` | owner-only | simulate-to-live cutover moves real funds and is an owner decision; worker and guardrails shipped |
| `deploy/world/README.md` | owner-only | hyperfy-world service deleted by owner 2026-10-23; redeploy is the owner call |
| `deploy/x-partners/README.md` | owner-only | applying the job publishes to @trythreews, owner decision; tooling shipped |
| `DESIGN-TOKENS.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `distributions/pay-skills/providers/three-ws/3d/PAY.md` | not-a-plan | generated PAY.md listing from service catalog (npm run build:pay-skills) |
| `distributions/pay-skills/providers/three-ws/agent-trust/PAY.md` | not-a-plan | generated PAY.md listing from service catalog (npm run build:pay-skills) |
| `distributions/pay-skills/providers/three-ws/market-data/PAY.md` | not-a-plan | generated PAY.md listing from service catalog (npm run build:pay-skills) |
| `distributions/pay-skills/README.md` | owner-only | upstream solana-foundation/pay-skills PR is external posting; generator, verify and runbook exist |
| `docs/3d-api.md` | no-open-work | reference doc, no open work found |
| `docs/3d-asset-pipeline.md` | no-open-work | reference doc, no open work found |
| `docs/3d-pipeline.md` | no-open-work | reference doc, no open work found |
| `docs/3d-vision.md` | no-open-work | reference doc, no open work found |
| `docs/a2a-payments.md` | no-open-work | reference doc, no open work found |
| `docs/accessibility.md` | no-open-work | reference doc, no open work found |
| `docs/account-linking.md` | no-open-work | reference doc, no open work found |
| `docs/agenc.md` | no-open-work | reference doc, no open work found |
| `docs/agent-abilities.md` | no-open-work | index of live abilities; states it is not a roadmap |
| `docs/agent-abilities/ABILITIES.md` | not-a-plan | generated editorial dossier of shipped abilities |
| `docs/agent-abilities/chapters/01-the-body.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/02-motion.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/03-creation-studios.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/04-the-mind.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/05-the-voice.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/06-identity-reputation.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/07-skills.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/08-screens.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/09-the-agent-economy.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/10-the-agent-wallet.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/11-markets-intelligence.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/12-live-worlds-social-irl.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/13-agents-everywhere.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/14-the-developer-platform.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/chapters/15-appendix.md` | not-a-plan | editorial chapter describing shipped abilities |
| `docs/agent-abilities/FULL-ARTICLE.md` | not-a-plan | editorial article source for the abilities dossier |
| `docs/agent-abilities/PRODUCTION-NOTES.md` | not-a-plan | video and article production notes |
| `docs/agent-abilities/TTS-SCRIPT.md` | not-a-plan | voiceover script copy |
| `docs/agent-abilities/wallet/01-balance.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/02-go-live.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/03-portfolio.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/04-deposit.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/05-copilot.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/06-trust.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/07-signals.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/08-trade.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/09-pulse.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/10-snipe.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/11-earn.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/12-orders.md` | covered-by-existing:614-beat-14-deploy-orders-engine-with-ratcheting-exits.md | rollout note says the agent-orders sweep worker is not yet hosted; existing order deploys it |
| `docs/agent-abilities/wallet/13-autopilot.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/14-intents.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/15-pay.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/16-vanity.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/17-policy.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/18-withdraw.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/19-give.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/20-proof-of-custody.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/21-access.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/22-recovery.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-abilities/wallet/23-self-defense.md` | not-a-plan | editorial segment script for a shipped wallet ability |
| `docs/agent-allowance-budgets.md` | shipped | api/_lib/onchain-allowance.js and onchain-allowance-store.js; guard allowance_pull in api/agent/guard.js |
| `docs/agent-commerce.md` | no-open-work | shipped commerce reference |
| `docs/agent-economy-volume.md` | no-open-work | shipped volume page reference |
| `docs/agent-identities.md` | no-open-work | shipped identity-studio service and showcase |
| `docs/agent-index.md` | no-open-work | indexer operations reference |
| `docs/agent-mail.md` | no-open-work | shipped mail reference |
| `docs/agent-manifest.md` | no-open-work | manifest spec reference; links resolve |
| `docs/agent-reputation.md` | no-open-work | explainer; open problems are conceptual not tasks |
| `docs/agent-runtime.md` | no-open-work | shipped runtime reference |
| `docs/agent-screen-control.md` | order | [269](../269-plan-agent-screen-pool-egress-guard.md). DNS-rebinding on nav stated out of scope; worker has no request-level egress guard |
| `docs/agent-self-onboarding.md` | no-open-work | shipped self-signup flow reference |
| `docs/agent-shell.md` | no-open-work | shipped shell reference |
| `docs/agent-skills.md` | no-open-work | shipped skills reference |
| `docs/agent-sniper.md` | no-open-work | operations reference for shipped sniper |
| `docs/agent-studio.md` | no-open-work | shipped Agent Studio reference |
| `docs/agent-symphony.md` | no-open-work | shipped /symphony reference |
| `docs/agent-system.md` | order | [769](../769-plan-agent-skill-trust-allowlist-attributes.md). stale 'whitelist not wired' line; registry enforces it (src/skills/index.js) but element cannot pass lists |
| `docs/agent-tasks/fix-x402-502-bursts.md` | order | [267](../267-plan-x402-loop-failure-classes-remeasure-fix.md). July brief, post-fix distribution never measured. |
| `docs/agent-tasks/fix-x402-caller-mismatches.md` | order | [267](../267-plan-x402-loop-failure-classes-remeasure-fix.md). July brief, caller mismatches need re-measure and a registry contract test. |
| `docs/agent-tasks/fix-x402-wallet-health.md` | order | [267](../267-plan-x402-loop-failure-classes-remeasure-fix.md). July brief, wallet roster and floor classes need re-measure. |
| `docs/agent-tasks/new-trading-arm-x402-signals.md` | order | [976](../976-plan-x402-paid-intel-sniper-arm.md). Never built; additive arm, spend steps gated. |
| `docs/agent-tasks/README.md` | order | [267](../267-plan-x402-loop-failure-classes-remeasure-fix.md). Index of the four July briefs; folded into the loop re-measure order. |
| `docs/agent-tokens.md` | no-open-work | shipped agent token plan and devnet rehearsal lane |
| `docs/agent-vitals.md` | no-open-work | shipped vitals reference |
| `docs/agent-wallet-api.md` | covered-by-existing:614-beat-14-deploy-orders-engine-with-ratcheting-exits.md | only open item: workers/agent-orders built but not deployed, covered by 614 |
| `docs/agent-wallets.md` | no-open-work | shipped wallets reference |
| `docs/agents-vs-avatars.md` | no-open-work | concept doc |
| `docs/agi.md` | no-open-work | reference doc, no open work found |
| `docs/agora.md` | order | [711](../711-plan-agora-citizens-daemon-deploy-and-liveness.md). daemon undeployed, trust grades open |
| `docs/agora/tasks/00-INDEX.md` | order | [707](../707-plan-agora-fleet-render-animation-budget.md), [770](../770-plan-agora-cartographer-profession-reactivation.md). Index shows task 12 open and Cartographer deferred. |
| `docs/agora/tasks/01-verify-foundation.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/02-life-engine.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/03-task-supply.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/04-professions.md` | order | [770](../770-plan-agora-cartographer-profession-reactivation.md). Cartographer runner is complete but not in WORK_RUNNERS. |
| `docs/agora/tasks/05-commons-scaffold.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/06-economy-visuals.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/07-verify-and-passport.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/08-humans-first-class.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/09-arena-and-guilds.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/10-agora-mcp.md` | shipped | Marked shipped in the index and present in the tree. |
| `docs/agora/tasks/11-production-hardening.md` | order | [707](../707-plan-agora-fleet-render-animation-budget.md). One unchecked box: fleet performance, carved out as task 12. |
| `docs/agora/tasks/12-fleet-render-performance.md` | order | [707](../707-plan-agora-fleet-render-animation-budget.md). Open: ~1fps with the full fleet, no recorded post-fix measurement. |
| `docs/airdrops.md` | no-open-work | reference doc, no open work found |
| `docs/ALL.md` | not-a-plan | generated concatenation of docs/ (scripts/combine-docs.mjs); each source file was reviewed individually |
| `docs/alpha-copilot.md` | no-open-work | reference doc, no open work found |
| `docs/alpha-drip.md` | no-open-work | reference doc, no open work found |
| `docs/analytics-retention.md` | no-open-work | reference doc, no open work found |
| `docs/anatomy.md` | no-open-work | reference doc, no open work found |
| `docs/animation-seeding.md` | shipped | rebaseToCanonicalRest described as done |
| `docs/animation-studio.md` | no-open-work | reference doc, no open work found |
| `docs/animations.md` | covered-by-existing:085-partners-02-animation-library-license.md | empty prod animation library (total 0) tracked by existing order |
| `docs/announce-voice.md` | not-a-plan | voice contract, ready post or historical coverage audit |
| `docs/announcement-coverage-telegram.md` | not-a-plan | voice contract, ready post or historical coverage audit |
| `docs/announcement-coverage.md` | not-a-plan | voice contract, ready post or historical coverage audit |
| `docs/announcement-factory.md` | order | [749](../749-plan-x-content-queue-clear-validator-errors.md). 25 validator errors and stale proofs block the queue |
| `docs/announcements/activity-mcp.md` | excluded | published or archived content |
| `docs/announcements/assistant.md` | excluded | published or archived content |
| `docs/announcements/avatar-mcp.md` | excluded | published or archived content |
| `docs/announcements/awesome.md` | excluded | published or archived content |
| `docs/announcements/aws-builder-center-authorization-spine.md` | excluded | published or archived content |
| `docs/announcements/data-desk.md` | excluded | published or archived content |
| `docs/announcements/forge-max.md` | excluded | published or archived content |
| `docs/announcements/forged.md` | excluded | published or archived content |
| `docs/announcements/galaxy.md` | excluded | published or archived content |
| `docs/announcements/genesis.md` | excluded | published or archived content |
| `docs/announcements/knock.md` | excluded | published or archived content |
| `docs/announcements/materialize.md` | excluded | published or archived content |
| `docs/announcements/open-source-friday.md` | excluded | published or archived content |
| `docs/announcements/openai-partner-benefits.md` | excluded | published or archived content |
| `docs/announcements/product-demo.md` | excluded | published or archived content |
| `docs/announcements/README.md` | excluded | published or archived content |
| `docs/announcements/text-to-3d.md` | excluded | published or archived content |
| `docs/announcements/three-token-mcp.md` | excluded | published or archived content |
| `docs/announcements/walk.md` | excluded | published or archived content |
| `docs/api-reference.md` | no-open-work | 470KB reference; open-work grep found only incidental wording, links and paths resolve |
| `docs/api/forge-x402.md` | order | [716](../716-plan-forge-share-distribution-funnel-metrics.md). API reference; share funnel counters are the open gap, doc gets the privacy note. |
| `docs/api/readme-3d.md` | no-open-work | Short API reference for a shipped endpoint. |
| `docs/approvals.md` | no-open-work | reference |
| `docs/apps.md` | owner-only | Play listing and Apple enrollment are owner actions |
| `docs/ar-studio.md` | no-open-work | shipped reference doc |
| `docs/ar.md` | no-open-work | shipped reference doc |
| `docs/architecture.md` | no-open-work | shipped reference doc |
| `docs/assistant-widget.md` | no-open-work | shipped reference doc |
| `docs/atlas.md` | no-open-work | shipped reference doc |
| `docs/atomic.md` | no-open-work | shipped reference doc |
| `docs/audit/console-sweep-2026-09-04.md` | order | [275](../275-plan-site-console-resweep-and-fix.md). Stale sweep, superseded by a fresh quiet-box run. |
| `docs/audit/console-sweep-2026-09-07.md` | order | [275](../275-plan-site-console-resweep-and-fix.md). Stale sweep, superseded by a fresh quiet-box run. |
| `docs/audit/console-sweep-2026-09-09.md` | order | [275](../275-plan-site-console-resweep-and-fix.md). 31 failing routes mostly load flake; re-sweep needed. |
| `docs/audit/python-deps-2026-09-07.md` | order | [725](../725-plan-workers-python-osv-residual-bumps.md). Most items fixed; 84 advisories on 9 pins remain by live scan. |
| `docs/authentication.md` | no-open-work | shipped reference doc |
| `docs/autonomous-economy.md` | no-open-work | shipped reference doc |
| `docs/autonomous-x402.md` | no-open-work | shipped reference doc |
| `docs/autopilot.md` | no-open-work | shipped reference doc |
| `docs/avatar-artifact.md` | no-open-work | shipped avatar artifact reference |
| `docs/avatar-cli.md` | no-open-work | shipped CLI reference |
| `docs/avatar-creation.md` | no-open-work | shipped creation guide |
| `docs/avatar-engines.md` | no-open-work | engine comparison data page reference |
| `docs/avatar-fidelity-program.md` | order | [712](../712-plan-avatar-parametric-body-type-reconstruction.md), [730](../730-plan-avatar-dense-identity-fit-rtx.md), [736](../736-plan-avatar-unseen-head-texture-synthesis.md). Tracks 0 and 1 and projective texturing shipped; Track 5, Track 3+4 and Track 2 imagery remain |
| `docs/avatar-inspector.md` | no-open-work | shipped inspector reference |
| `docs/avatar-pipeline.md` | no-open-work | pipeline reference |
| `docs/avatar-reconstruction.md` | order | [712](../712-plan-avatar-parametric-body-type-reconstruction.md), [730](../730-plan-avatar-dense-identity-fit-rtx.md), [736](../736-plan-avatar-unseen-head-texture-synthesis.md). roadmap rows v2 dense identity, v3 texture inpaint and v3 owned body are unbuilt |
| `docs/avatar-studio.md` | no-open-work | shipped studio reference |
| `docs/avatar-thumbnails.md` | no-open-work | operations reference for shipped crons and backfill script |
| `docs/avatar-wardrobe.md` | no-open-work | shipped wardrobe reference |
| `docs/awesome-solana-ai-submission.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | listing PR covered by existing order |
| `docs/aws-builder-center-agent-commerce-spine.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-agent-payment-sessions.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-before-the-signature.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-claims-ledger.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-immutable-embed-releases.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-marketplace-x402.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-mcp-agents.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-open-weight-3d-forge.md` | owner-only | article draft awaiting owner publishing |
| `docs/aws-builder-center-universal-retargeting.md` | order | [285](../285-plan-avatar-humanik-sanitized-bone-names.md). HumanIK sanitized names still unmapped; Biped and ValveBiped shipped |
| `docs/aws-builder-center.md` | owner-only | article series awaiting owner publishing |
| `docs/aws-marketplace-listing-kit.md` | owner-only | AMMP console listing creation |
| `docs/aws-marketplace.md` | owner-only | AMMP console listing creation |
| `docs/aws-partner-spotlight.md` | owner-only | partner submission awaiting owner |
| `docs/backtest-integrity.md` | no-open-work | shipped reference doc |
| `docs/big-tech-recognition-week.md` | owner-only | dispatch board; agent-doable parts covered by 938/939 existing orders |
| `docs/blender-mcp.md` | no-open-work | shipped reference doc |
| `docs/bnb-babt-findings.md` | shipped | api/bnb/babt-check.js and api/_lib/bnb/babt.js |
| `docs/bnb-payments.md` | no-open-work | shipped reference doc |
| `docs/bnb-vault.md` | retired-by-owner | 910-backlog-07 bnb testnet deploys, funded key wall |
| `docs/bnb-world.md` | retired-by-owner | 910-backlog-07 bnb testnet deploys, funded key wall |
| `docs/brain.md` | no-open-work | shipped reference doc |
| `docs/brownout.md` | no-open-work | shipped reference doc |
| `docs/btn-pill-migration.md` | order | [784](../784-plan-ui-button-pill-migration-long-tail.md). long-tail migration and audit script |
| `docs/build.md` | no-open-work | shipped reference doc |
| `docs/ca2x402.md` | no-open-work | shipped reference doc |
| `docs/cad-forge.md` | no-open-work | shipped reference doc |
| `docs/capture.md` | no-open-work | shipped reference doc |
| `docs/carplay.md` | order | [786](../786-plan-drive-android-automotive-build-flavor.md), [985](../985-plan-drive-open-head-unit-carplay-lane.md). AAOS flavor and Lane D; Apple entitlement is owner-only |
| `docs/changelog.md` | excluded | license, changelog or repository boilerplate |
| `docs/character-library.md` | no-open-work | shipped reference doc |
| `docs/character-studio.md` | shipped | face morph limitation superseded by Avatar Studio 306 sliders (docs/avatar-studio.md) |
| `docs/chart-companion.md` | no-open-work | shipped reference doc |
| `docs/chat-gateways.md` | no-open-work | shipped gateway reference |
| `docs/chatgpt-3d-studio-gpt.md` | owner-only | GPT config doc; only open item is the owner's ChatGPT Builder domain verification TXT record |
| `docs/chatgpt-ar.md` | no-open-work | shipped ChatGPT AR/MCP surface reference |
| `docs/checkout-companion.md` | no-open-work | shipped reference doc |
| `docs/choreography.md` | no-open-work | shipped reference doc |
| `docs/circulation-engine.md` | no-open-work | shipped reference doc |
| `docs/clash.md` | no-open-work | shipped reference doc |
| `docs/cli.md` | no-open-work | shipped reference doc |
| `docs/clip-director.md` | no-open-work | shipped reference doc |
| `docs/coin-control.md` | shipped | feature doc for Coin Control, added with its code and tests in 26cafafd5 (api/_lib/coin-control/, tests/coin-control.test.js) |
| `docs/coin-launches.md` | no-open-work | shipped reference doc |
| `docs/coin-pages.md` | no-open-work | shipped reference doc |
| `docs/coin-wars.md` | no-open-work | shipped reference doc |
| `docs/coin3d-embed.md` | no-open-work | shipped reference doc |
| `docs/coingecko-listing-update-2026-08.md` | owner-only | form submission and posts |
| `docs/coinmarketcap-article-2026-09-agent-economy.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-2026-10-copy-trading.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-2026-10-radar-strategy-lab.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-2026-10-sniper-oracle.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-2026-10-solana-reputation.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-2026-10-vanity-mints.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-2026-10-x402-failure-paths.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article-play.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-article.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/coinmarketcap-live-article.md` | not-a-plan | Marketing article draft, not a plan |
| `docs/community.md` | no-open-work | Community links page, nothing outstanding |
| `docs/companion.md` | shipped | Feature reference for a live surface |
| `docs/competitions.md` | shipped | Reference for live competitions, no gaps listed |
| `docs/compose.md` | shipped | Feature reference for a live surface |
| `docs/concierge.md` | shipped | Feature reference for a live surface |
| `docs/configuration.md` | not-a-plan | Env var reference plus a deploy checklist of owner config steps |
| `docs/content/use-cases/ai-agent-developer.md` | excluded | published or archived content |
| `docs/content/use-cases/brand-marketer.md` | excluded | published or archived content |
| `docs/content/use-cases/crypto-community.md` | excluded | published or archived content |
| `docs/content/use-cases/game-studio.md` | excluded | published or archived content |
| `docs/content/use-cases/indie-creator.md` | excluded | published or archived content |
| `docs/content/use-cases/README.md` | excluded | published or archived content |
| `docs/contributing.md` | excluded | license, changelog or repository boilerplate |
| `docs/cookbook/asset-quality-gate.md` | excluded | end-user tutorial or example |
| `docs/cookbook/mcp-3d-tool.md` | excluded | end-user tutorial or example |
| `docs/cookbook/parallel-asset-pack.md` | excluded | end-user tutorial or example |
| `docs/cookbook/text-to-3d-cli.md` | excluded | end-user tutorial or example |
| `docs/copy-coach.md` | shipped | Feature reference for a live surface |
| `docs/copy-trading.md` | shipped | Reference with honest limits (advisory intents by design), no open build items |
| `docs/cosmos.md` | shipped | Feature reference for a live surface |
| `docs/crawl.md` | shipped | Feature reference for a live surface |
| `docs/create-agent.md` | shipped | Feature reference for a live surface |
| `docs/creator-payouts.md` | shipped | Feature reference for a live surface |
| `docs/creator-portfolio.md` | shipped | Feature reference for a live surface |
| `docs/crews.md` | shipped | Feature reference for a live surface |
| `docs/crypto-api.md` | shipped | API reference, only mention of coming soon is a documented empty state |
| `docs/custody.md` | order | [265](../265-plan-custody-proof-anchor-restore.md). Honest limits verified live: 522 epochs, 0 anchored (devnet attester unfunded), /integrity down |
| `docs/daily-forge.md` | shipped | Feature reference for a live surface |
| `docs/daily-match.md` | shipped | Feature reference for a live surface |
| `docs/dance-off.md` | shipped | Feature reference for a live surface |
| `docs/demo-routes.md` | no-open-work | Route catalogue, nothing outstanding |
| `docs/deployment.md` | no-open-work | deployment guide |
| `docs/deployments.md` | no-open-work | shipped /deployments page reference |
| `docs/DESIGN-TOKENS.md` | no-open-work | Design token reference |
| `docs/desktop-local-runtime.md` | shipped | Reference for shipped desktop runtime |
| `docs/desktop-menu-bar-panel.md` | shipped | Reference for shipped desktop panel |
| `docs/desktop-widgets.md` | shipped | Reference for shipped desktop widgets |
| `docs/desktop.md` | shipped | Reference for shipped desktop app |
| `docs/destination-whitelist.md` | shipped | Withdrawal whitelist reference, no open items |
| `docs/developer-plans.md` | shipped | Plan and quota reference, no open items |
| `docs/developer-platform.md` | shipped | Developer platform reference, no open items |
| `docs/devto-mcp-fleet-post.md` | not-a-plan | Marketing post draft |
| `docs/dextools.md` | shipped | Integration reference, no open items |
| `docs/diorama.md` | shipped | Feature reference for a live surface |
| `docs/discord-activity.md` | shipped | Feature reference for a live surface |
| `docs/dissolve.md` | shipped | Short effect reference |
| `docs/do-i-need-crypto.md` | not-a-plan | Explainer copy for users |
| `docs/doc-freshness.md` | no-open-work | Describes the docs freshness tooling, already built |
| `docs/docs-world.md` | shipped | Feature reference for a live surface |
| `docs/domains.md` | no-open-work | Domain reference, nothing outstanding |
| `docs/draft-agent-mint.md` | shipped | Feature reference for a live surface |
| `docs/drops.md` | order | [978](../978-plan-drops-onchain-core-collection-mint.md). Section Not yet wired: minting a drop on-chain; schema columns exist, nothing writes them |
| `docs/economy-heartbeat.md` | shipped | Reference for shipped economy loop |
| `docs/economy-master.md` | shipped | Reference for shipped master wallet and rebalancer |
| `docs/economy-solver.md` | shipped | Reference for shipped solver |
| `docs/editor.md` | order | [743](../743-plan-avatar-editor-attribute-and-export-fidelity.md). Pre-1.0 rough edges verified still present in src/editor and src/element.js |
| `docs/education-pilot-bucharest.md` | order | [783](../783-plan-sign-language-packs-and-signer-review.md). Pack format and signer review groundwork is agent work; outreach reply and school call are owner actions |
| `docs/embedding.md` | no-open-work | embedding guide; pages/_document.js mention is a Next.js example |
| `docs/embody.md` | shipped | Feature reference for a live surface |
| `docs/engine-bridges.md` | shipped | Bridge package reference |
| `docs/engine-qa.md` | no-open-work | QA procedure reference |
| `docs/engine-store-publishing.md` | owner-only | Unity, Godot and Fab store submissions are manual owner portal steps |
| `docs/erc8004.md` | shipped | Reference; mainnet Validation Registry is an external deployment, secondary EVM chain |
| `docs/erc8004/validation-attestation.md` | no-open-work | Design reference for the shipped validation attestation flow. |
| `docs/event-markets-staking.md` | order | [973](../973-plan-event-markets-staking-devnet-proof-and-launch-kit.md). Built but not deployed to any cluster; buyback executor not built; owner steps are prose |
| `docs/event-markets.md` | shipped | Core markets shipped; staking follow-up tracked by the staking order |
| `docs/event-readiness/01-play-first-impression.md` | order | [256](../256-plan-play-meetup3-client-ux-audit.md). repeatable client audit pack not re-run against the current build before the 2026-11-06 meetup |
| `docs/event-readiness/02-play-mobile.md` | order | [256](../256-plan-play-meetup3-client-ux-audit.md). repeatable client audit pack not re-run against the current build before the 2026-11-06 meetup |
| `docs/event-readiness/03-play-performance.md` | order | [256](../256-plan-play-meetup3-client-ux-audit.md). repeatable client audit pack not re-run against the current build before the 2026-11-06 meetup |
| `docs/event-readiness/04-play-multiplayer-net.md` | order | [252](../252-plan-play-meetup3-net-economy-audit.md). repeatable net and economy audit pack not re-run against the current build |
| `docs/event-readiness/05-play-economy-loops.md` | order | [252](../252-plan-play-meetup3-net-economy-audit.md). repeatable net and economy audit pack not re-run against the current build |
| `docs/event-readiness/06-play-auth-errors.md` | order | [256](../256-plan-play-meetup3-client-ux-audit.md). repeatable client audit pack not re-run against the current build before the 2026-11-06 meetup |
| `docs/event-readiness/07-platform-smoke-sweep.md` | order | [251](../251-plan-play-meetup3-event-day-runbook.md). production health and smoke battery plus LIVE-OPS.md still describes the August event |
| `docs/event-readiness/08-api-production-health.md` | order | [251](../251-plan-play-meetup3-event-day-runbook.md). production health and smoke battery plus LIVE-OPS.md still describes the August event |
| `docs/event-readiness/09-accessibility-i18n.md` | order | [256](../256-plan-play-meetup3-client-ux-audit.md). repeatable client audit pack not re-run against the current build before the 2026-11-06 meetup |
| `docs/event-readiness/10-event-day-runbook.md` | order | [251](../251-plan-play-meetup3-event-day-runbook.md). production health and smoke battery plus LIVE-OPS.md still describes the August event |
| `docs/event-readiness/11-event-live-ops.md` | order | [254](../254-plan-play-event-config-live-override.md). broadcast and go-live shipped; live event config override has no implementation |
| `docs/event-readiness/12-photo-mode-share.md` | shipped | src/game/photo-mode.js and photo-mode.css |
| `docs/event-readiness/13-event-quests-leaderboard.md` | shipped | src/game/quests-ui.js, api/play/event-leaderboard.js, api/internal/event-score.js |
| `docs/event-readiness/14-welcome-concierge.md` | order | [723](../723-plan-play-concierge-greeter-tour.md). no greeter NPC, persona or tour exists in src/game |
| `docs/event-readiness/15-live-hype-feed.md` | shipped | src/game/activity-ticker.js and activity-feeds.js mounted in coincommunities.js |
| `docs/event-readiness/16-invite-flow.md` | order | [717](../717-plan-play-invite-sheet-qr-og.md). no invite sheet, QR or share control in the HUD; OG card unverified |
| `docs/event-readiness/17-plaza-live-show.md` | order | [704](../704-plan-play-plaza-live-show-mount-and-client.md). plaza-stage.js is unmounted and its lazy-imported plaza-stage-show.js does not exist |
| `docs/event-readiness/18-coin-wars-portal.md` | order | [767](../767-plan-play-war-results-ticker-jumbotron.md). portal shipped; only the ticker row and jumbotron echo of war-result remain |
| `docs/event-readiness/19-forge-props-live.md` | order | [253](../253-plan-play-forge-props-hologram-size-limits.md). no triangle or size ceiling, no per-world server limits, no hologram placement |
| `docs/event-readiness/20-world-chat-scrollback.md` | order | [727](../727-plan-play-chat-scrollback-community-bridge.md). WalkRoom chat is relay only, no scrollback or community bridge |
| `docs/event-readiness/21-party-system.md` | shipped | src/game/party.js and party.css |
| `docs/event-readiness/22-venue-projector-mode.md` | shipped | src/game/director-shots.js and director-mode projector view |
| `docs/event-readiness/23-signature-wall.md` | shipped | src/game/signature-wall.js, api/play/signature-wall.js, api/play/signature-wall-og.js |
| `docs/event-readiness/24-dance-off.md` | shipped | dance-off event surface and runbook already live; no open build work |
| `docs/event-readiness/LIVE-OPS.md` | owner-only | event-day operator runbook; open items are people and attendance |
| `docs/event-readiness/README.md` | not-a-plan | event readiness index |
| `docs/event-souvenirs.md` | shipped | public/event.json and the GLB/thumb exist; multiplayer revision 00012-fhl postdates crown catalog |
| `docs/everything.md` | no-open-work | reference page for /everything |
| `docs/examples.md` | no-open-work | examples gallery reference |
| `docs/exit-lab.md` | no-open-work | shipped feature reference |
| `docs/experiments-agent-launch-funnel.md` | order | [276](../276-plan-launch-funnel-default-coin-path.md). 2 of 788 agents launched; auto-draft and instrumentation missing |
| `docs/experiments-autonomous-trading.md` | order | [763](../763-plan-sniper-experiment-judge-cost-and-exit-giveback.md). judge cost columns and giveback analysis missing |
| `docs/experiments.md` | no-open-work | process doc for publishing experiments |
| `docs/fact-check.md` | no-open-work | shipped feature reference |
| `docs/fade-radar.md` | no-open-work | shipped feature reference |
| `docs/farcaster-memory-seeding.md` | no-open-work | shipped seeding reference |
| `docs/fee-bridge.md` | owner-only | held, not public by owner decision |
| `docs/feedback.md` | no-open-work | shipped feature reference |
| `docs/field.md` | no-open-work | shipped feature reference |
| `docs/financial-controls.md` | order | [250](../250-plan-payments-withdrawal-send-idempotency.md), [257](../257-plan-payments-x402-audit-ledger-durability.md), [274](../274-plan-payments-platform-fee-events-ledger.md), [722](../722-plan-payments-accounting-export-and-durable-ledgers.md), [758](../758-plan-payments-retention-kill-switch-and-alerting.md). open gap register items verified against code |
| `docs/first-contribution.md` | not-a-plan | contributor guide |
| `docs/forge-background-generation.md` | no-open-work | shipped background job design |
| `docs/forge-desktop.md` | no-open-work | shipped; apps/forge-desktop, cloudbuild.yaml and live /releases/forge/release.json; signing certs are owner secrets already wired |
| `docs/forge-off.md` | no-open-work | shipped Forge-Off voting reference |
| `docs/forge-pipeline.md` | no-open-work | pipeline reference |
| `docs/forge-workflows.md` | no-open-work | shipped workflows reference |
| `docs/forge.md` | no-open-work | forge reference; Tripo gaps are external, no live Tripo splat endpoint exists |
| `docs/forged.md` | no-open-work | shipped /forged gallery reference |
| `docs/fork-trade.md` | no-open-work | shipped feature reference |
| `docs/free-crypto-apis.md` | owner-only | keyless providers integrated; remaining lanes need owner-created API keys |
| `docs/free-llm-providers.md` | no-open-work | failover chain reference |
| `docs/fundraising/nvidia-inception-capital-connect.md` | owner-only | Fundraising application actions belong to the owner. |
| `docs/galaxy.md` | no-open-work | shipped feature reference |
| `docs/generation-watch.md` | no-open-work | shipped feature reference |
| `docs/genesis.md` | no-open-work | shipped feature reference |
| `docs/genome.md` | no-open-work | shipped feature reference |
| `docs/ghost-copy.md` | no-open-work | shipped feature reference |
| `docs/github-benchmark/own-repos.md` | owner-only | fix list for the owner's other GitHub repositories, not three.ws code; fixes are prepared locally by the docs/github-benchmark scripts and pushing them to those repos is owner-gated |
| `docs/github-benchmark/README.md` | owner-only | Findings concern the owner personal GitHub repos (CI, releases); needs pushes to external repos. |
| `docs/github-growth.md` | not-a-plan | growth kit content |
| `docs/github-memory-seeding.md` | no-open-work | shipped seeding reference |
| `docs/github-trending-patterns.md` | owner-only | remaining items are owner-only or held (PAT swap, translation review, SDK move) |
| `docs/glance.md` | no-open-work | shipped widget reference |
| `docs/glasses.md` | covered-by-existing:docs/glasses/meta-ray-ban-display.md | lanes 2 and 3 tracked in batch b13 doc |
| `docs/glasses/meta-ray-ban-display.md` | order | [739](../739-plan-glasses-meta-display-lens-web-app.md), [982](../982-plan-glasses-native-wearables-toolkit-lane.md). Phased build plan; /glass does not exist yet; phase 6 native lane gated on hardware. |
| `docs/glasses/research.md` | order | [739](../739-plan-glasses-meta-display-lens-web-app.md). Research input for the lens app order. |
| `docs/globe.md` | no-open-work | shipped feature reference |
| `docs/google-adk.md` | no-open-work | integration reference |
| `docs/google-cloud-community-post.md` | not-a-plan | published community post |
| `docs/google-x-accounts.md` | not-a-plan | account list |
| `docs/grok-bot.md` | no-open-work | connector reference |
| `docs/grok.md` | no-open-work | integration reference |
| `docs/growth-programs.md` | covered-by-existing:917-roadmap-pumpfun-trading.md | arming steps are owner-only and tracked there |
| `docs/guardian.md` | no-open-work | shipped feature reference |
| `docs/guards.md` | no-open-work | guard catalog reference |
| `docs/haunted-graveyard.md` | no-open-work | shipped feature reference |
| `docs/herald.md` | no-open-work | shipped feature reference |
| `docs/hold-to-access.md` | order | [715](../715-plan-three-hold-activate-worlds-private.md), [728](../728-plan-three-hold-activate-early-drops-and-name-dibs.md). five entitlements still enforced:false |
| `docs/home-assistant-community-post.md` | not-a-plan | published community post |
| `docs/home-households.md` | retired-by-owner | Home campaign |
| `docs/home-plans.md` | retired-by-owner | Home campaign plans/entitlements order 313 |
| `docs/home-privacy.md` | retired-by-owner | Home campaign |
| `docs/home-relay-threat-model.md` | retired-by-owner | Home campaign add-on relay |
| `docs/home-relay.md` | retired-by-owner | Home campaign add-on relay |
| `docs/home-satellite.md` | retired-by-owner | Home campaign Wyoming satellite |
| `docs/home-scene.md` | retired-by-owner | Home campaign 3D home scene |
| `docs/home-security.md` | retired-by-owner | Home campaign security |
| `docs/home-voice.md` | retired-by-owner | Home campaign voice loop |
| `docs/how-forge-works.md` | no-open-work | explainer |
| `docs/how-it-works.md` | no-open-work | explainer |
| `docs/huggingface-3d-ai-agent-platform.md` | not-a-plan | published article |
| `docs/huggingface-agent-feedback-loop.md` | not-a-plan | published article |
| `docs/huggingface.md` | no-open-work | integration reference |
| `docs/i18n.md` | order | [262](../262-plan-i18n-restore-language-picker-manifest.md). manifest lists only English; 623 keys missing in all locales |
| `docs/ibm-community-any-skeleton-animation-post.md` | not-a-plan | published community post |
| `docs/ibm-community-any-skeleton-animation-thread.md` | not-a-plan | social thread |
| `docs/ibm-community-article.md` | not-a-plan | published article |
| `docs/ibm-community-blog-meetup-jessica.md` | not-a-plan | event copy |
| `docs/ibm-community-defi-3d-sperax-post.md` | not-a-plan | published community post |
| `docs/ibm-community-defi-3d-sperax-publishing-kit.md` | not-a-plan | publishing kit |
| `docs/ibm-community-defi-3d-sperax.md` | not-a-plan | published community post |
| `docs/ibm-community-doc-freshness-post.md` | not-a-plan | published community post |
| `docs/ibm-community-doc-freshness-thread.md` | not-a-plan | social thread |
| `docs/ibm-community-governed-agents-post.md` | not-a-plan | published IBM Community post |
| `docs/ibm-community-governed-agents-thread.md` | not-a-plan | published thread copy |
| `docs/ibm-community-live-reaction-jessica.md` | not-a-plan | community reaction copy |
| `docs/ibm-community-long-running-mcp-tools-post.md` | not-a-plan | published IBM Community post |
| `docs/ibm-community-long-running-mcp-tools-thread.md` | not-a-plan | published thread copy |
| `docs/ibm-community-recap-jessica.md` | not-a-plan | event recap content |
| `docs/ibm-community-recap-nichxbt.md` | not-a-plan | event recap content |
| `docs/ibm-community-thread.md` | not-a-plan | published thread copy |
| `docs/ibm-community.md` | no-open-work | post catalog and cadence reference |
| `docs/ibm-event-offer-map.md` | order | [279](../279-plan-ibm-granite-guardian-lane-live.md), [741](../741-plan-play-world-moderation-mute-kick-report.md). Granite lane dark in prod and no mute/kick/ban in /play |
| `docs/ibm-meetup-3/event-form.md` | owner-only | Event form to be filled by the owner. |
| `docs/ibm-meetup-3/jessica-article.md` | not-a-plan | Event and marketing copy. |
| `docs/ibm-meetup-3/README.md` | not-a-plan | Event and marketing copy. |
| `docs/ibm-meetup-3/thread.md` | not-a-plan | Event and marketing copy. |
| `docs/ibm-meetup-3/x-posts.md` | not-a-plan | Event and marketing copy. |
| `docs/ibm-next-event.md` | order | [771](../771-plan-forge-off-themed-event-boards-landing.md). Forge-Off Open needs daily boards and a landing page |
| `docs/ibm-visibility-map.md` | owner-only | surface map of IBM intake actions; Agent Connect prep is in docs/partners/ibm-partner-plus.md (other batch) |
| `docs/ibm-x402-mcp.md` | shipped | api/ibm-mcp.js serves the documented tools; fail-fast on missing IBM credentials is by design |
| `docs/ibm.md` | order | [279](../279-plan-ibm-granite-guardian-lane-live.md). no IBM model serving in production |
| `docs/image-to-3d.md` | no-open-work | shipped feature reference |
| `docs/in-game-economy.md` | no-open-work | shipped feature reference |
| `docs/inference-billing.md` | no-open-work | shipped spend cap and top-up reference |
| `docs/inference-node-operator.md` | order | [755](../755-plan-inference-network-buyer-endpoint-and-earnings.md). no buyer enqueues jobs and no earnings ledger |
| `docs/integrations.md` | no-open-work | reference |
| `docs/internal/fable-playbook.md` | order | [716](../716-plan-forge-share-distribution-funnel-metrics.md), [731](../731-plan-diorama-text-to-microgame-win-rules.md). Playbook says instrument the shipped funnel first; microgame is Tier 2 item 8. |
| `docs/internal/MAINNET-TEST-2026-07-03.md` | shipped | Historical test report; blocking outage resolved per its own status note. |
| `docs/internal/README.md` | no-open-work | Index and handling rules for the internal tree. |
| `docs/introduction.md` | no-open-work | reference |
| `docs/ios-app.md` | owner-only | App Store submission and Apple account steps |
| `docs/irl.md` | no-open-work | shipped feature reference |
| `docs/irl/street-demo.md` | no-open-work | Runbook for a shipped feature; used as the on-hardware script by the glasses order. |
| `docs/irl/THREAT-MODEL.md` | no-open-work | Threat model with accepted residuals stated; no open items. |
| `docs/issue-resolution-2026-09-15.md` | no-open-work | resolution log, items closed |
| `docs/js-api.md` | no-open-work | API reference |
| `docs/knock.md` | order | [286](../286-plan-notifications-page-category-tab-parity.md). knock_received is mis-filed under Account on /notifications |
| `docs/kol-tracker.md` | no-open-work | shipped feature reference |
| `docs/labor-market.md` | no-open-work | shipped feature reference |
| `docs/launch-intents.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/launch-lanes.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/launch-usecases.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/launchpad.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/layers.md` | no-open-work | reference |
| `docs/likeness-eval.md` | no-open-work | harness reference; fidelity track lives in docs/avatar-fidelity-program.md |
| `docs/lipsync.md` | no-open-work | shipped feature reference with designed error states |
| `docs/liquid-glass.md` | no-open-work | design note, nothing owed |
| `docs/listings-registry.md` | owner-only | external directory submissions and verification by the owner |
| `docs/listings.md` | owner-only | external directory listings tracker |
| `docs/live-docs.md` | no-open-work | reference |
| `docs/live-steps.md` | no-open-work | shipped feature reference |
| `docs/make-your-agent.md` | no-open-work | reference |
| `docs/market-anomalies.md` | no-open-work | shipped feature reference |
| `docs/market-data-api.md` | no-open-work | API reference |
| `docs/marketplace.md` | shipped | stale limitation: api/skills/index.js has browse and sort, src/runtime/skill-access.js enforces entitlement |
| `docs/materialize.md` | no-open-work | shipped feature reference |
| `docs/mcp-3d-studio.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-agent.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-registry-sentinel.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-safety.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-solana-memo-media.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-studio.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-tools.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp-x402-bazaar.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/mcp.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/media-api.md` | no-open-work | API reference; listed error codes are documented behavior |
| `docs/memetic-launcher.md` | no-open-work | reference |
| `docs/memory.md` | order | [747](../747-plan-memory-file-layer-semantic-recall.md). src/memory/index.js recall is a substring placeholder |
| `docs/meta-allocator.md` | no-open-work | shipped page and API (api/meta-allocator.js) |
| `docs/metered-router.md` | no-open-work | reference |
| `docs/microsoft.md` | owner-only | Microsoft partner and store account steps |
| `docs/mint-mark.md` | no-open-work | reference |
| `docs/minted.md` | no-open-work | reference |
| `docs/mobile-launch/aws-builder-center-article.md` | not-a-plan | Launch article copy. |
| `docs/mobile-launch/coinmarketcap-article.md` | not-a-plan | Launch article copy. |
| `docs/mobile-launch/ibm-community-article.md` | not-a-plan | Launch article copy. |
| `docs/mobile-launch/nvidia-forum-article.md` | not-a-plan | Launch article copy. |
| `docs/mobile-launch/README.md` | not-a-plan | Launch article copy. |
| `docs/mobile-launch/x-article.md` | not-a-plan | Launch article copy. |
| `docs/mocap-studio.md` | no-open-work | shipped feature reference |
| `docs/model-diff.md` | no-open-work | shipped feature reference |
| `docs/modly.md` | no-open-work | shipped feature reference |
| `docs/money-feed.md` | no-open-work | reference |
| `docs/money-flow-map.md` | no-open-work | reference |
| `docs/money-map.md` | order | [966](../966-plan-token-rail-receiver-wallets-preflight.md). THREE_TREASURY_WALLET and THREE_REWARDS_WALLET unset in production |
| `docs/monitor.md` | no-open-work | reference |
| `docs/motion-swap.md` | no-open-work | reference |
| `docs/mpp-solana.md` | no-open-work | reference |
| `docs/multi-agent.md` | no-open-work | reference |
| `docs/native-launchpad.md` | order | [718](../718-plan-launchpad-native-coin-page-and-sol-buy.md). no native coin page and no SOL one-click buy; mainnet config creation is owner-gated |
| `docs/native-widgets.md` | no-open-work | reference |
| `docs/news-rights.md` | no-open-work | reference |
| `docs/notifications.md` | order | [286](../286-plan-notifications-page-category-tab-parity.md). client TYPE_CATEGORY drifted from the 13-category server map |
| `docs/nvidia-apps-catalog-listing.md` | owner-only | NVIDIA catalog submission is an owner action |
| `docs/nvidia-apps-catalog-request.md` | owner-only | NVIDIA catalog request is an owner action |
| `docs/nvidia-forum-browser-digital-human.md` | not-a-plan | published forum post |
| `docs/nvidia-forum-gpu-fleet-post.md` | not-a-plan | published forum post |
| `docs/nvidia-forum-model-retirement-post.md` | not-a-plan | published forum post |
| `docs/nvidia-gtc-2027-poster.md` | order | [967](../967-plan-nvidia-gtc-poster-submission-pack-refresh.md). submission closes 2026-11-10 and evidence numbers are stale |
| `docs/nvidia-inception.md` | no-open-work | membership explainer, shipped |
| `docs/nvidia-models.md` | no-open-work | reference for shipped NIM lanes and free-first ladder |
| `docs/nvidia-nemotron-ask-the-experts-questions.md` | not-a-plan | question prompts for an NVIDIA panel, external posting |
| `docs/nvidia-nemotron-spotlight.md` | not-a-plan | draft post for NVIDIA, owner-gated publishing |
| `docs/nvidia-ngc-listing.md` | order | [981](../981-plan-nvidia-ngc-trellis-image-validation.md). Gate 2 GPU validation, two-stage build and staging script remain; legal agreement is owner |
| `docs/nvidia-visibility-map.md` | order | [981](../981-plan-nvidia-ngc-trellis-image-validation.md). NGC build work becomes an order; the rest is owner outreach, social posting and portal work |
| `docs/object-library.md` | no-open-work | shipped feature reference |
| `docs/okx-marketplace.md` | covered-by-existing:913-okx-ai-04-e2e-real-payment-test.md | funded end-to-end settlement on X Layer and legacy rails not yet demonstrated |
| `docs/onboarding-tier.md` | no-open-work | shipped nav/homepage tier behavior |
| `docs/onchain-agents.md` | no-open-work | shipped reference and troubleshooting |
| `docs/open-source-credits.md` | no-open-work | how-to for generated credits page |
| `docs/open-source-ecosystem.md` | no-open-work | reference copy, no unbuilt items |
| `docs/open-source-footprint.md` | no-open-work | reference table; AWS listing and OKX resubmission are owner/existing orders |
| `docs/open-source-friday-plan.md` | owner-only | application and stream booking with GitHub staff; issue 254 opened, owner books and posts |
| `docs/openai-community-3d-studio-post.md` | not-a-plan | draft community post, owner-gated |
| `docs/openai-community-physical-world-post.md` | not-a-plan | draft community post, owner-gated |
| `docs/openai-listing-channels.md` | owner-only | plugin directory, showcase and cookbook submissions; packet exists at prompts/store-submissions/_generated/openai-submission.md |
| `docs/ops/agent-index.md` | no-open-work | reference |
| `docs/ops/avatar-asset-orphans.md` | no-open-work | reference runbook for orphan sweep |
| `docs/ops/avatar-reconstruction-capacity.md` | no-open-work | capacity explainer |
| `docs/ops/cron-auth.md` | no-open-work | reference |
| `docs/ops/db-retention.md` | no-open-work | reference |
| `docs/ops/economy-wallet-rotation.md` | owner-only | rotation moves real mainnet funds; owner-gated runbook |
| `docs/ops/evolve.md` | no-open-work | runbook for the evolve loop |
| `docs/ops/examples-repo-export.md` | no-open-work | export tooling documented and working |
| `docs/ops/forge-desktop-release.md` | owner-only | publishing and CDN edits are owner-gated |
| `docs/ops/forge-error-triage.md` | order | [273](../273-plan-forge-image-lane-licence-and-model-currency.md). error classes feed the lane reliability tasks |
| `docs/ops/forge-funnel.md` | no-open-work | reference |
| `docs/ops/forge-multiview-migration-handoff.md` | no-open-work | historical June hand-off; ISSUES.md states all migrations applied |
| `docs/ops/forge-storage-failover.md` | no-open-work | reference runbook |
| `docs/ops/gcp-credits-plan.md` | owner-only | remaining ranked items are quota grants and console billing steps; video2scene worker covered by capture-video2scene-worker-live |
| `docs/ops/gcp-credits.md` | no-open-work | reference |
| `docs/ops/gcp-logs.md` | no-open-work | reference |
| `docs/ops/gcp-model-workers.md` | no-open-work | reference; undeployed workers covered by workers-fleet-status-and-ship-readiness and capture-video2scene-worker-live |
| `docs/ops/gcp-production.md` | no-open-work | deploy runbook |
| `docs/ops/growth-satellite-export.md` | not-a-plan | marketing export tooling notes |
| `docs/ops/guard-wiring.md` | no-open-work | reference |
| `docs/ops/home-operations.md` | retired-by-owner | Home campaign retired |
| `docs/ops/hosting-and-credentials.md` | no-open-work | reference |
| `docs/ops/ibm-hosted-page-audit.md` | no-open-work | audit method reference |
| `docs/ops/image-selfie-3d-review-2026-10-09.md` | order | [273](../273-plan-forge-image-lane-licence-and-model-currency.md). section 5 follow-ups; engine chain covered by 067/068, selfie by avatar-lhm-photoreal-selfie-lane |
| `docs/ops/ISSUES.md` | order | [271](../271-plan-ops-world-health-retired-state.md), [268](../268-plan-solana-rpc-call-volume-budget-and-read-cache.md), [726](../726-plan-ops-alerts-email-push-channel.md). items 1 to 6 are owner money or credentials; 7 recovered; 8 covered by 907 |
| `docs/ops/livepeer-federation.md` | no-open-work | guard in tree, awaits routine deploy |
| `docs/ops/llm-lanes.md` | no-open-work | reference |
| `docs/ops/materialize-fulfillment.md` | owner-only | partner signing and credentials are owner actions |
| `docs/ops/mcp-clients.md` | no-open-work | reference |
| `docs/ops/mcp-registry-namespace.md` | no-open-work | reference with dry-run publish script |
| `docs/ops/nvidia-inception-response-2026-09-14.md` | not-a-plan | drafted partner response |
| `docs/ops/page-audit.md` | no-open-work | audit tooling reference |
| `docs/ops/payment-outcomes.md` | no-open-work | reference |
| `docs/ops/play-store-developer-page.md` | owner-only | Play Console steps |
| `docs/ops/production-log-triage.md` | no-open-work | runbook; used as context for rpc and alerts orders |
| `docs/ops/production-sweep-2026-09-15.md` | order | [262](../262-plan-i18n-restore-language-picker-manifest.md). only surviving finding is the i18n backlog; rest re-measured and resolved |
| `docs/ops/pump-upstream-watch.md` | no-open-work | reference |
| `docs/ops/README.md` | no-open-work | index |
| `docs/ops/redis.md` | no-open-work | reference |
| `docs/ops/repo-audit-2026-07.md` | no-open-work | historical audit, re-verified resolved |
| `docs/ops/runtime-flags.md` | no-open-work | reference |
| `docs/ops/search-indexing.md` | owner-only | Search Console and indexing submissions |
| `docs/ops/security-exceptions.md` | no-open-work | reference |
| `docs/ops/seo-keyword-plan.md` | not-a-plan | keyword strategy content |
| `docs/ops/site-health-audit-2026-09-15.md` | order | [262](../262-plan-i18n-restore-language-picker-manifest.md). i18n lint backlog; other findings covered by site-console-resweep-and-fix |
| `docs/ops/sniper-fleet-review-2026-10-01.md` | order | [980](../980-plan-sniper-moonbag-manager-and-latency-telemetry.md). plan items 9 and 11 unbuilt; 8 and 12 are on-chain owner actions |
| `docs/ops/solana-rpc-lanes.md` | order | [268](../268-plan-solana-rpc-call-volume-budget-and-read-cache.md). live rpc_lanes degraded |
| `docs/ops/stranded-wallets.md` | order | [972](../972-plan-wallet-key-dedicated-reseal-rotation.md). shared key finding and rotation tooling |
| `docs/ops/swarm-100-audit.md` | order | [262](../262-plan-i18n-restore-language-picker-manifest.md). only open finding is i18n coverage |
| `docs/ops/trading-bot-report.md` | no-open-work | report |
| `docs/ops/wallet-key-migration.md` | order | [972](../972-plan-wallet-key-dedicated-reseal-rotation.md). duplicate key values not fixed |
| `docs/ops/wallet-rescue.md` | owner-only | moves real funds, owner action |
| `docs/ops/worker-and-avatar-rules.md` | no-open-work | rules reference |
| `docs/ops/x-story-findings-2026-09-30.md` | order | [277](../277-plan-site-announced-surfaces-defect-sweep.md), [738](../738-plan-site-demo-defaults-tpose-and-account-hygiene.md). verified open: concierge empty rung, agent-identities viewer, labs categorize, tty, herald, T-pose defaults |
| `docs/ops/x402-discovery-listings.md` | owner-only | directory submissions |
| `docs/ops/x402-prepaid.md` | no-open-work | reference |
| `docs/oracle-model.md` | no-open-work | shipped model reference |
| `docs/oracle-trading-mcp-plan.md` | order | [702](../702-plan-mcp-oracle-and-agent-trader-servers.md). nothing built: no api/mcp-oracle.js, no packages/oracle-mcp or agent-trader-mcp, 404 live |
| `docs/oracle.md` | no-open-work | shipped reference; MCP packaging gap is in the oracle-trading-mcp-plan order |
| `docs/orphaned-avatar-campaign.md` | covered-by-existing:934-best3d-07-orphaned-avatar-campaign.md | draft campaign wording awaiting owner approval |
| `docs/oss-adoption-2026-09.md` | order | [740](../740-plan-platform-opentelemetry-gcp-traces.md), [744](../744-plan-avatar-lhm-photoreal-selfie-lane.md), [782](../782-plan-platform-dead-code-and-secret-history-scans.md). Tier 1 OTel, LHM and dead-code/secrets tooling unbuilt; Spark, BiRefNet, A2F, PartCrafter/HoloPart shipped or covered by 070/081; Tier 2 models not ordered (speculative) |
| `docs/overlay-audit.md` | no-open-work | shipped audit tool reference |
| `docs/package-extraction.md` | owner-only | standalone-repo publishing needs owner gh/npm creds; vscode-x402 is already published on Marketplace and Open VSX |
| `docs/page-performance.md` | no-open-work | rules reference |
| `docs/paired-coins.md` | no-open-work | shipped API reference |
| `docs/papertrade.md` | no-open-work | shipped API reference |
| `docs/partner-benefits.md` | not-a-plan | guidance for quoting partner designations |
| `docs/partners.md` | owner-only | AWS Marketplace listing creation and partner portal work are owner actions; kit exists |
| `docs/partners/dextools-collab-kit.md` | not-a-plan | partner outreach material |
| `docs/partners/dextools-proposal.md` | not-a-plan | partner proposal |
| `docs/partners/grok-bot-listings.md` | covered-by-existing:929-x-grok-48-connector-directory-listings.md | same listings |
| `docs/partners/ibm-partner-plus.md` | owner-only | program application |
| `docs/partners/openai-ibm-nvidia-growth-plan.md` | not-a-plan | growth narrative |
| `docs/partners/openai-partner-benefits-2026.md` | owner-only | program benefits to claim |
| `docs/partners/opportunities.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | agent-doable parts are orders 085 to 095, owner parts 936 to 940 |
| `docs/partners/outreach-plan.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | engineering is partners orders 084 to 095 |
| `docs/partners/owner-day-2026-10-09.md` | owner-only | owner day packet |
| `docs/partners/proof-brief-2026-10.md` | not-a-plan | proof brief content |
| `docs/partners/prospects-solana.md` | not-a-plan | prospect list |
| `docs/partners/prospects.md` | not-a-plan | prospect list |
| `docs/partners/sperax-proposal.md` | not-a-plan | partner proposal |
| `docs/partners/sponsorships.md` | covered-by-existing:937-partners-14-sponsorships.md | same |
| `docs/partners/tripo.md` | covered-by-existing:936-partners-13-tripo-reply-and-house-key.md | same |
| `docs/partners/x-player-card-submission.md` | covered-by-existing:931-x-grok-50-player-card-approval.md | player card approval order covers it |
| `docs/pay-skills-listing.md` | not-a-plan | listing text for a paid-API directory |
| `docs/payment-sessions.md` | no-open-work | shipped API reference |
| `docs/permissions.md` | no-open-work | shipped reference |
| `docs/perps.md` | no-open-work | shipped reference; second venue work is existing order 615 |
| `docs/persona-hub.md` | no-open-work | shipped reference |
| `docs/pill-mascot.md` | no-open-work | shipped reference |
| `docs/plan-checkout.md` | no-open-work | shipped /api/payments/solana plans checkout |
| `docs/play-activity-ticker.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-boot-performance.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-director-mode.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-forge-in-world.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-gacha.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-hardening.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-live-events.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-parties.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-ufo.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/play-vehicles.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/pocket.md` | no-open-work | shipped feature reference |
| `docs/pons-launch.md` | no-open-work | shipped API reference |
| `docs/popular-3d-github-repos.md` | not-a-plan | popularity snapshot |
| `docs/portal.md` | no-open-work | shipped API reference |
| `docs/portfolio.md` | no-open-work | shipped feature reference |
| `docs/predictions.md` | no-open-work | shipped shadow-mode reference; broader work is existing order 616 |
| `docs/premium.md` | no-open-work | shipped reference |
| `docs/press-kit.md` | not-a-plan | press kit content |
| `docs/procedural-animation.md` | no-open-work | shipped contract reference |
| `docs/product-demo.md` | no-open-work | tool usage reference |
| `docs/prompts.md` | no-open-work | prompt library guidance |
| `docs/prompts/01-cli-setup-login.md` | shipped | packages/three-ws-cli/src |
| `docs/prompts/03-mcp-tool-policy-skill.md` | shipped | packages/mcp-policy; remaining unified serve in order |
| `docs/prompts/04-community-skills-registry.md` | shipped | community skills registry routes and pages in api/ and pages/ |
| `docs/prompts/05-agents-rest-parity.md` | shipped | api/v1/rest.js defineRouter |
| `docs/prompts/06-agents-sdk.md` | shipped | sdk/ and packages agents SDK |
| `docs/prompts/07-perps.md` | shipped | api/v1/agents/[id]/perps |
| `docs/prompts/08-lending.md` | order | [970](../970-plan-lending-agent-earn-venue-routes-ui.md). venue and math built, routes tools UI missing |
| `docs/prompts/09-prediction-markets.md` | shipped | api/v1/agents/[id]/predictions |
| `docs/prompts/10-agent-marketplace-bids.md` | shipped | marketplace bid routes in api/ |
| `docs/prompts/11-agent-mail.md` | shipped | src/agent-mail.js and api/_lib/mail |
| `docs/prompts/12-agent-cards.md` | shipped | agent card routes and share images |
| `docs/prompts/13-chat-gateways.md` | shipped | workers/agent-gateway discord and telegram; more in order |
| `docs/prompts/14-desktop-app-release.md` | covered-by-existing:961-desktop-agent-runtime.md | desktop runtime order |
| `docs/prompts/15-gasless-launch.md` | shipped | gasless launch path in api/pump |
| `docs/prompts/16-self-funded-inference.md` | covered-by-existing:626-beat-26-metered-openai-compatible-router.md | metered router order |
| `docs/prompts/17-unified-mcp-endpoint.md` | order | [258](../258-plan-mcp-unified-endpoint-serve-and-publish.md). registry built, no handler or route |
| `docs/prompts/18-open-model-roster.md` | shipped | model roster in api/_lib/evals/models.js and brain proxy |
| `docs/prompts/19-self-custody-and-signers.md` | order | [259](../259-plan-wallet-self-custody-routes-export-history.md). custody library built, no routes |
| `docs/prompts/20-local-agent-runtime-tui.md` | covered-by-existing:961-desktop-agent-runtime.md | desktop runtime order |
| `docs/prompts/21-agent-memory-and-self-improvement.md` | order | [261](../261-plan-agent-memory-settings-page-and-api.md). library wired in run.js, no owner surface |
| `docs/prompts/22-external-mcp-integrations-for-agents.md` | order | [266](../266-plan-mcp-external-integrations-agent-connections.md). catalog and client built, no routes or runtime |
| `docs/prompts/23-distribution-into-agent-frameworks.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | tool packages order |
| `docs/prompts/24-more-gateways-and-voice.md` | order | [708](../708-plan-gateway-slack-whatsapp-voice-adapters.md). adapters missing |
| `docs/prompts/25-sandboxed-code-execution.md` | order | [701](../701-plan-agent-sandbox-code-execution-tools-runner.md). lib built, no runner or tools |
| `docs/prompts/26-tool-gateway-bundle.md` | order | [703](../703-plan-mcp-tool-gateway-metered-routes-tools.md). lib built, no routes |
| `docs/prompts/27-bounties-and-hackathons.md` | order | [706](../706-plan-bounties-build-program-routes-and-pages.md). schema and sources built, no routes or pages |
| `docs/prompts/28-public-economics-dashboard.md` | shipped | api/three-token/[action].js and /three-token |
| `docs/prompts/29-free-tier-and-hosting-plan.md` | shipped | plans and entitlements in api/_lib |
| `docs/prompts/30-trading-tool-parity.md` | shipped | trading tools in api/_mcp and api/_mcpagent |
| `docs/prompts/31-human-task-fulfillment.md` | order | [974](../974-plan-human-tasks-escrow-marketplace-routes-pages.md). schema and lib built, no routes or pages |
| `docs/prompts/32-evm-secondary-leg.md` | shipped | EVM rails in api/_lib/x402 and wallets |
| `docs/prompts/33-account-social-and-sso.md` | order | [719](../719-plan-mcp-account-status-dashboard-url-tools.md). status and URL tools missing |
| `docs/prompts/34-localization.md` | shipped | locale files and src i18n |
| `docs/prompts/35-always-on-strategy-loop.md` | shipped | api/v1/agents/[id]/loop and start/stop |
| `docs/prompts/36-agent-evals-and-replay.md` | order | [705](../705-plan-agent-evals-cli-replay-evaluate-tab.md). runner built, no CLI replay or UI |
| `docs/prompts/event-markets/01-core-markets-and-picks.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/02-market-pages-and-share-cards.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/03-auto-resolution.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/04-auto-open-for-every-event.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/05-announcement-automation.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/06-entrant-amplification-kit.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/07-pick-leaderboard-and-rewards.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/08-live-odds-feed.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/09-agents-as-forecasters.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/event-markets/10-staked-markets-solana.md` | order | [973](../973-plan-event-markets-staking-devnet-proof-and-launch-kit.md). built locally, devnet proof and launch runbook missing |
| `docs/prompts/event-markets/README.md` | shipped | tests/event-market*.test.js |
| `docs/prompts/README.md` | not-a-plan | prompt pack index |
| `docs/PROTOCOL-vanity.md` | no-open-work | protocol spec for shipped vanity grinder |
| `docs/provenance.md` | no-open-work | shipped reference |
| `docs/publishing-program-2026-09.md` | not-a-plan | index of unposted owner-gated drafts |
| `docs/pump-claims-channel.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/pump-fun-mcp-edge.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/pump-launch-repos.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/pump-launcher.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/pump-platform-fee.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/pumpfun-program/docs/BREAKING_FEE_RECIPIENT.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/CPI_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/FAQ.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/FEE_PROGRAM_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/FEE_RECIPIENTS.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/HOLDER_REWARDS_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/BUY.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/CLAIM_CASHBACK.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/COIN_CREATION.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/COLLECT_CREATOR_FEE.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/CREATOR_FEE_SHARING.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/MULTI_HOP_SWAP.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/PUMP_SWAP_TRADE_V2.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/SELL.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/SWEEP_FEES.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/instructions/TRADE_V3.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/NEGATIVE_VIRTUAL_QUOTE_RESERVES.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/PUMP_CASHBACK_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/PUMP_CREATOR_FEE_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/PUMP_PROGRAM_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/PUMP_SWAP_CREATOR_FEE_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/PUMP_SWAP_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/PUMP_SWAP_SDK_README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/SYNTHETIC_MIGRATION.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/README.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/UPSTREAM-buy-sell-v2-announcement.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/UPSTREAM-pumpswap-virtual-quote-reserves.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpfun-program/UPSTREAM-v3-trades-fee-sweeps-announcement.md` | not-a-plan | vendored pump.fun program reference |
| `docs/pumpkin-carving.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/quick-start.md` | no-open-work | shipped how-to |
| `docs/radar.md` | no-open-work | shipped feature reference |
| `docs/README.md` | no-open-work | docs index |
| `docs/readme/README.ja.md` | not-a-plan | Translated README copy. |
| `docs/readme/README.ko.md` | not-a-plan | Translated README copy. |
| `docs/readme/README.zh-CN.md` | not-a-plan | Translated README copy. |
| `docs/reasoning-ledger.md` | no-open-work | shipped; attester funding is an ops/owner matter documented in the doc |
| `docs/recurring-payments.md` | no-open-work | shipped reference |
| `docs/remix.md` | no-open-work | shipped reference |
| `docs/reputation-staking-market.md` | owner-only | mainnet open is one env flip REPUTATION_MARKET_ALLOW_MAINNET=1 by owner; devnet shipped |
| `docs/reputation.md` | no-open-work | shipped reference |
| `docs/research/3d-landscape-2026-10.md` | order | [721](../721-plan-forge-ultratex-texture-rung.md). texture and 3D adoption items; rest covered by best3d orders |
| `docs/research/competitor-teardown-2026-09.md` | no-open-work | beat campaigns closed; findings consumed by those orders |
| `docs/research/crypto-agent-oss-landscape-2026-10.md` | no-open-work | integrate campaign orders consumed it; other-coin research only |
| `docs/research/forge-3d-adoption-2026-10-30.md` | order | [721](../721-plan-forge-ultratex-texture-rung.md), [757](../757-plan-forge-replace-nvdiffrast-bake-rasteriser.md). UltraTex rung and nvdiffrast license |
| `docs/research/grok-ecosystem-2026-10.md` | not-a-plan | survey for standalone repos; states none of it is three.ws work |
| `docs/research/gta-multiplayer-world-2026-11.md` | owner-only | product direction decision for the owner |
| `docs/research/launchpad-landscape-2026-09.md` | no-open-work | launch campaign orders consumed it |
| `docs/research/oss-landscape-2026-10-notes/3d-generation.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10-notes/agent-commerce.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10-notes/agent-frameworks.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10-notes/avatars-voice.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10-notes/chat-memory-evals.md` | order | [759](../759-plan-memory-temporal-facts-benchmark-scores.md). feeds temporal memory order |
| `docs/research/oss-landscape-2026-10-notes/coding-mcp-skills.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10-notes/irl-home-robotics.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10-notes/worlds-engines.md` | no-open-work | research notes; actionable items captured in the oss-landscape orders |
| `docs/research/oss-landscape-2026-10.md` | order | [760](../760-plan-agent-ag-ui-event-stream.md), [773](../773-plan-identity-web-bot-auth-signed-requests.md), [759](../759-plan-memory-temporal-facts-benchmark-scores.md), [732](../732-plan-screen-autonomous-browser-agent-owner-lease.md), [766](../766-plan-play-generative-npc-loop.md). gaps 5 8 10 12 14; others covered by existing orders |
| `docs/research/solana-robinhood-playbook-2026-10.md` | order | [975](../975-plan-robinhood-crypto-connector-spend-capped.md), [710](../710-plan-agent-follow-button-capped-copy-trading.md), [735](../735-plan-actions-hire-agent-blink-discovery.md). items 4 7 8; others covered by 548 512 627 622 958 |
| `docs/resilience.md` | no-open-work | shipped reference |
| `docs/restyle.md` | no-open-work | shipped reference |
| `docs/revenue-ledger.md` | no-open-work | shipped reference; reinvest work is existing order 965 |
| `docs/rig-doctor.md` | no-open-work | shipped tool reference |
| `docs/risk-acknowledgment.md` | no-open-work | shipped gate reference |
| `docs/rivalries.md` | no-open-work | shipped reference |
| `docs/robinhood-chain-markets.md` | no-open-work | shipped reference |
| `docs/robinhood-portfolios.md` | no-open-work | shipped reference with stated limits |
| `docs/run-receipts-x-reply-and-thread.md` | not-a-plan | draft X reply, owner-gated |
| `docs/run-receipts.md` | no-open-work | shipped reference |
| `docs/sas-attestations.md` | no-open-work | shipped reference |
| `docs/scene-studio.md` | no-open-work | shipped feature reference |
| `docs/sdk.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/seasonal-drops.md` | no-open-work | shipped reference |
| `docs/security.md` | excluded | license, changelog or repository boilerplate |
| `docs/security/audit-2026-10-25/FINDINGS-DETAIL.md` | order | [260](../260-plan-security-close-oct25-audit-and-sweep-gaps.md). 17 needs_validation records and seven unexamined surfaces never closed out. |
| `docs/security/audit-2026-10-25/NEEDS-VALIDATION.md` | order | [260](../260-plan-security-close-oct25-audit-and-sweep-gaps.md). 17 needs_validation records and seven unexamined surfaces never closed out. |
| `docs/security/audit-2026-10-25/REPORT.md` | order | [260](../260-plan-security-close-oct25-audit-and-sweep-gaps.md). 17 needs_validation records and seven unexamined surfaces never closed out. |
| `docs/security/review-2026-06-24.md` | order | [714](../714-plan-security-csp-drop-unsafe-eval.md). unsafe-eval is the one security header item still tracked. |
| `docs/security/SECURITY_AUDIT.md` | order | [714](../714-plan-security-csp-drop-unsafe-eval.md). H12 unsafe-eval still in 26 vercel.json lines; other findings fixed |
| `docs/security/SECURITY_REMEDIATION.md` | order | [714](../714-plan-security-csp-drop-unsafe-eval.md). item 7 (scope unsafe-eval) is the only open item |
| `docs/seed-quality.md` | order | [748](../748-plan-seed-vision-gate-own-cron.md). vision stage is off in the prod cron; own-cron phase is the fix |
| `docs/seeker-app.md` | no-open-work | shipped reference |
| `docs/seeker-publishing.md` | no-open-work | publish runbook, submission done |
| `docs/seeker-submission-day.md` | owner-only | v1.0.0 submitted 2026-08-28; remaining steps are owner phone check and store approval |
| `docs/seeker-video.md` | no-open-work | filming tooling shipped |
| `docs/selfie-to-avatar.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/sentiment-scout.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/seo.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/share-and-embed.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/shared-utilities.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/shipfeed.md` | no-open-work | known limits are deliberate |
| `docs/shopify-app.md` | covered-by-existing:091-partners-08-shopify-product-media.md | app shipped; remaining is Partner account setup in owner actions |
| `docs/short-form-venue-kit-2026-09.md` | not-a-plan | paste-ready posting copy, needs owner approval to post |
| `docs/showcase.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/sign-language.md` | order | [768](../768-plan-sign-asl-word-level-recognition.md). roadmap item 2 unbuilt; item 4 shipped (@three-ws/sign-language 0.1.1 on npm); items 1 and 3 need signers |
| `docs/signals.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/signature-wall.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/sim-readiness.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/simready-assets.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/site-performance.md` | order | [713](../713-plan-perf-forge-marketplace-thumbs-cls.md). open thumbnail sizing, marketplace hero budget, forge composer CLS, brand mark |
| `docs/sketchfab.md` | covered-by-existing:940-partners-17-sketchfab-retag.md | retag backfill script shipped; the run is the owner-gated order |
| `docs/skill-bundles.md` | order | [709](../709-plan-marketplace-bundle-buyer-storefront.md). buyer browser surface missing |
| `docs/skill-candidates.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/skill-directory-listings.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/skill-import.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/skill-rails.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/skill-royalties.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/skill-supply-scan.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/skills.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/smart-contracts.md` | no-open-work | reference; mainnet ValidationRegistry undeployed externally |
| `docs/smart-home.md` | retired-by-owner | Home campaign; not-shipped list and Matter direct control are retired scope |
| `docs/smart-money.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/sniper-autonomy.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/social-layer.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/solana-agent-registry.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/solana-pumpfun.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/solana-reputation.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/solana.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/sonar.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/spatial-mcp.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/specs/agent-trading.md` | order | [968](../968-plan-autopilot-trade-action-and-trading-mcp.md). no trade kind in api/_lib/autopilot.js and no packages/trading-mcp |
| `docs/splat.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/spotlight.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/stage.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/standalone-repo-playbook.md` | not-a-plan | generic discovery checklist template, not repo-specific work |
| `docs/standalone-repos.md` | no-open-work | generated catalog of mirrors |
| `docs/start-here.md` | no-open-work | reference index |
| `docs/strategy-objects.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/support/stranded-wallet-ownership-proof.md` | order | [280](../280-plan-wallet-recovery-ownership-proof-verifier.md). scripts/verify-wallet-ownership.mjs still not built |
| `docs/swarms.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/syndicates.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/syndication.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/talking-avatar-video.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/team-chat.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/teams.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/terminal.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/the-first-19-weeks.md` | not-a-plan | published roundup article |
| `docs/three-microbuy.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/three-thesis.md` | order | [255](../255-plan-three-gate-fail-closed-on-rpc-failure.md), [715](../715-plan-three-hold-activate-worlds-private.md), [728](../728-plan-three-hold-activate-early-drops-and-name-dibs.md). fail-open balance gate (api/_lib/three-gate.js) and unenforced holder perks |
| `docs/threejs-forum-post.md` | not-a-plan | published forum post copy |
| `docs/timeline.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/token-due-diligence.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/token-gated-3d-embeds.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/tokens-xyz.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/trade-receipts.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trade-rooms.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trader-card-embed.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trader-card.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trader-duels.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trader-passport.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trader-wrapped.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trading-arenas.md` | no-open-work | shipped; user pool settlement is by design a creator action |
| `docs/trading-copilot.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trading-experiment.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trading-hub.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trading-quests.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trading-surfaces.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trading-tools.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/transaction-landing-race.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/trenches.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/triage.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/troubleshooting.md` | no-open-work | reference |
| `docs/trust-primitives.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/tty-avatar.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/tty.md` | no-open-work | shipped reference; native widgets roadmap retired (916) |
| `docs/tutorials/add-a-3d-assistant.md` | excluded | end-user tutorial or example |
| `docs/tutorials/agent-personality.md` | excluded | end-user tutorial or example |
| `docs/tutorials/agent-reputation.md` | excluded | end-user tutorial or example |
| `docs/tutorials/agent-spending-envelope.md` | excluded | end-user tutorial or example |
| `docs/tutorials/animate-your-agent.md` | excluded | end-user tutorial or example |
| `docs/tutorials/animate-your-avatar.md` | excluded | end-user tutorial or example |
| `docs/tutorials/arm-an-agent-sniper.md` | excluded | end-user tutorial or example |
| `docs/tutorials/build-a-3d-asset-pipeline.md` | excluded | end-user tutorial or example |
| `docs/tutorials/build-a-scene.md` | excluded | end-user tutorial or example |
| `docs/tutorials/build-a-site-concierge.md` | excluded | end-user tutorial or example |
| `docs/tutorials/character-library-to-embed.md` | excluded | end-user tutorial or example |
| `docs/tutorials/claim-threews-name.md` | excluded | end-user tutorial or example |
| `docs/tutorials/connect-ai-brain.md` | excluded | end-user tutorial or example |
| `docs/tutorials/connect-your-home.md` | excluded | end-user tutorial or example |
| `docs/tutorials/create-and-edit-memory.md` | excluded | end-user tutorial or example |
| `docs/tutorials/custom-skill.md` | excluded | end-user tutorial or example |
| `docs/tutorials/customize-appearance.md` | excluded | end-user tutorial or example |
| `docs/tutorials/deploy-to-vercel-custom-domain.md` | excluded | end-user tutorial or example |
| `docs/tutorials/earn-and-spend-in-play.md` | excluded | end-user tutorial or example |
| `docs/tutorials/embed-in-30-seconds.md` | excluded | end-user tutorial or example |
| `docs/tutorials/embed-on-website.md` | excluded | end-user tutorial or example |
| `docs/tutorials/emotion-from-data.md` | excluded | end-user tutorial or example |
| `docs/tutorials/explore-docs-world.md` | excluded | end-user tutorial or example |
| `docs/tutorials/find-a-better-exit-policy.md` | excluded | end-user tutorial or example |
| `docs/tutorials/first-agent.md` | excluded | end-user tutorial or example |
| `docs/tutorials/first-prompt-to-3d.md` | excluded | end-user tutorial or example |
| `docs/tutorials/generate-3d-api.md` | excluded | end-user tutorial or example |
| `docs/tutorials/getting-started.md` | excluded | end-user tutorial or example |
| `docs/tutorials/greeting-and-first-speech.md` | excluded | end-user tutorial or example |
| `docs/tutorials/grok-bot-recipes.md` | excluded | end-user tutorial or example |
| `docs/tutorials/image-to-3d.md` | excluded | end-user tutorial or example |
| `docs/tutorials/import-avatar-url.md` | excluded | end-user tutorial or example |
| `docs/tutorials/js-api-events.md` | excluded | end-user tutorial or example |
| `docs/tutorials/mcp-server-for-your-agent.md` | excluded | end-user tutorial or example |
| `docs/tutorials/mine-vanity-address.md` | excluded | end-user tutorial or example |
| `docs/tutorials/mint-pumpfun-token.md` | excluded | end-user tutorial or example |
| `docs/tutorials/monetize-mcp-server.md` | excluded | end-user tutorial or example |
| `docs/tutorials/multi-agent-coordination.md` | excluded | end-user tutorial or example |
| `docs/tutorials/nvidia-3d-free.md` | excluded | end-user tutorial or example |
| `docs/tutorials/nvidia-nim-self-host.md` | excluded | end-user tutorial or example |
| `docs/tutorials/paid-x402-endpoint.md` | excluded | end-user tutorial or example |
| `docs/tutorials/pay-for-x402-service.md` | excluded | end-user tutorial or example |
| `docs/tutorials/personal-ai-site.md` | excluded | end-user tutorial or example |
| `docs/tutorials/place-agent-irl.md` | excluded | end-user tutorial or example |
| `docs/tutorials/prompts-for-3d.md` | excluded | end-user tutorial or example |
| `docs/tutorials/read-the-trading-fleet.md` | excluded | end-user tutorial or example |
| `docs/tutorials/register-onchain.md` | excluded | end-user tutorial or example |
| `docs/tutorials/render-avatar-images.md` | excluded | end-user tutorial or example |
| `docs/tutorials/self-host-agent-backend.md` | excluded | end-user tutorial or example |
| `docs/tutorials/selfie-to-avatar.md` | excluded | end-user tutorial or example |
| `docs/tutorials/sell-a-skill-with-a-trial.md` | excluded | end-user tutorial or example |
| `docs/tutorials/share-your-agent.md` | excluded | end-user tutorial or example |
| `docs/tutorials/ship-an-avatar-manifest.md` | excluded | end-user tutorial or example |
| `docs/tutorials/shopify-shopping-assistant.md` | excluded | end-user tutorial or example |
| `docs/tutorials/shopify-store-guide-advanced.md` | excluded | end-user tutorial or example |
| `docs/tutorials/shopify-store-guide.md` | excluded | end-user tutorial or example |
| `docs/tutorials/sign-with-your-avatar.md` | excluded | end-user tutorial or example |
| `docs/tutorials/skill-with-database-auth.md` | excluded | end-user tutorial or example |
| `docs/tutorials/solana-agent-reputation.md` | excluded | end-user tutorial or example |
| `docs/tutorials/sperax-tour.md` | excluded | end-user tutorial or example |
| `docs/tutorials/swap-avatar-in-studio.md` | excluded | end-user tutorial or example |
| `docs/tutorials/text-to-3d.md` | excluded | end-user tutorial or example |
| `docs/tutorials/trigger-from-page-events.md` | excluded | end-user tutorial or example |
| `docs/tutorials/upload-custom-glb.md` | excluded | end-user tutorial or example |
| `docs/tutorials/view-in-ar.md` | excluded | end-user tutorial or example |
| `docs/tutorials/voice-and-lipsync.md` | excluded | end-user tutorial or example |
| `docs/tutorials/walk-companion.md` | excluded | end-user tutorial or example |
| `docs/tutorials/wallet-sign-in.md` | excluded | end-user tutorial or example |
| `docs/tutorials/web-component-end-to-end.md` | excluded | end-user tutorial or example |
| `docs/tutorials/write-a-guard.md` | excluded | end-user tutorial or example |
| `docs/tutorials/x402-server-sdk.md` | excluded | end-user tutorial or example |
| `docs/ui-juice.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/ui-lint.md` | order | [789](../789-plan-tooling-ui-lint-policy-tuning.md). policy untuned to design tokens, only two pages triaged |
| `docs/uniswap-v4-hooks.md` | shipped | contracts/v4-hooks (AgentTierHook, SkinHook) built; ABI drift fixed in src/erc8004/abi.js; catalog in 549; deploys are on-chain gated |
| `docs/upstream/home-assistant-js-websocket-resubscribe-rejection.md` | owner-only | upstream filing to the Home Assistant project is an external post by the owner |
| `docs/user-wallet.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/ux-flows/01-onboarding-creation.md` | no-open-work | /start 401 handling shipped in src/start.js |
| `docs/ux-flows/02-forge-text-to-3d.md` | no-open-work | flow documented, no outstanding items |
| `docs/ux-flows/03-3d-editing-viewer.md` | no-open-work | Traced reference of shipped flows; no unfixed findings. Route drift is covered by the 12-home order. |
| `docs/ux-flows/04-embed-widget-studio.md` | no-open-work | Traced reference of shipped flows; no unfixed findings. |
| `docs/ux-flows/05-discovery-social.md` | no-open-work | Traced reference of shipped flows; no unfixed findings. |
| `docs/ux-flows/06-marketplace-skills.md` | no-open-work | Traced reference of shipped flows; no unfixed findings. |
| `docs/ux-flows/07-crypto-trading-analytics.md` | order | [781](../781-plan-docs-ux-flows-atlas-route-coverage.md). Reference only; cited routes feed the drift check and coverage order. |
| `docs/ux-flows/08-coin-launch-wallets.md` | no-open-work | Traced reference of shipped flows; no unfixed findings. |
| `docs/ux-flows/09-x402-agent-commerce.md` | order | [781](../781-plan-docs-ux-flows-atlas-route-coverage.md). Reference only; cited routes feed the drift check and coverage order. |
| `docs/ux-flows/10-chat-brain-labs.md` | no-open-work | Traced reference of shipped flows; no unfixed findings. |
| `docs/ux-flows/11-account-dashboard.md` | no-open-work | Only finding (CSRF on profile save and revokes) was fixed 2026-08-06 per the doc. |
| `docs/ux-flows/12-home-and-content.md` | order | [781](../781-plan-docs-ux-flows-atlas-route-coverage.md). Reference only; 232 of 1014 pages covered, stale cited routes found. |
| `docs/validation.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/vanity.md` | no-open-work | shipped feature doc, referenced files exist, no open work |
| `docs/vaults.md` | no-open-work | reference for shipped USDC vaults; api and spend-scope exist |
| `docs/vendored-design-libraries.md` | no-open-work | guide to vendored third_party trees; nothing outstanding |
| `docs/viability.md` | no-open-work | describes shipped /viability page (pages/viability.html, src/viability.js) |
| `docs/video-to-motion.md` | no-open-work | shipped page and worker model-video2motion |
| `docs/viewer.md` | no-open-work | viewer reference; unsupported formats are stated limits not tasks |
| `docs/voice-framework-integrations.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/voice-lab.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/vroid-hub-import.md` | covered-by-existing:092-partners-09-vroid-hub-import.md | code shipped (api/vroid); remaining step is owner app registration tracked in 092 |
| `docs/vscode.md` | owner-only | extension built (packages/vscode-3d, PUBLISHING.md); Marketplace publish needs owner publisher account |
| `docs/walk-leaderboard.md` | no-open-work | shipped page and /api/walk/leaderboard |
| `docs/web-component.md` | order | [769](../769-plan-agent-skill-trust-allowlist-attributes.md). skill-trust=whitelist cannot admit anything because element has no allowlist attributes |
| `docs/webgpu-renderer.md` | covered-by-existing:074-best3d-08-webgpu-tsl-path.md | Not ported section (viewer CinematicPipeline to TSL) is the existing order |
| `docs/widget-api.md` | no-open-work | JSON-RPC widget API reference |
| `docs/widget-studio.md` | no-open-work | user guide for shipped /studio; next steps are links |
| `docs/widgets.md` | no-open-work | widget reference; xr-spatial-tracking row is a note not a task |
| `docs/witness.md` | no-open-work | feature doc for shipped witness bug-report tool |
| `docs/wordpress-embed.md` | covered-by-existing:094-partners-11-site-builder-embeds.md | plugin built and checked; WordPress.org submission is owner action tracked in 094 |
| `docs/workbench.md` | no-open-work | shipped /workbench reference |
| `docs/world-lines.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `docs/x-account-appeal.md` | owner-only | appeal must be filed by the account owner |
| `docs/x-accounts.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-archive.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-archive/trythreews-articles-readers.md` | excluded | published or archived content |
| `docs/x-archive/trythreews-engagement.md` | excluded | published or archived content |
| `docs/x-article-author-brief.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-content-pipeline.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-memory-seeding.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-mention-avatar.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-mention-bot.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-mention-image3d.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-partner-series.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-posts/3d-ar-studio-launch.md` | excluded | published or archived content |
| `docs/x-posts/3d-ar-studio-video-script.md` | excluded | published or archived content |
| `docs/x-posts/android-app-launch.md` | excluded | published or archived content |
| `docs/x-posts/ar-quick-look-fix-x-post.md` | excluded | published or archived content |
| `docs/x-posts/claims-ledger-thread.md` | excluded | published or archived content |
| `docs/x-posts/event-x-posts.md` | excluded | published or archived content |
| `docs/x-posts/fomo-verified-x-post.md` | excluded | published or archived content |
| `docs/x-posts/github-100-stars.md` | excluded | published or archived content |
| `docs/x-posts/ibm-skillsbuild-x-post.md` | excluded | published or archived content |
| `docs/x-posts/immutable-embed-releases-thread.md` | excluded | published or archived content |
| `docs/x-posts/mcp-registry-fleet-x-post.md` | excluded | published or archived content |
| `docs/x-posts/metaplex-agent-deployer-video-script.md` | excluded | published or archived content |
| `docs/x-posts/metaplex-agent-deployer-x-post.md` | excluded | published or archived content |
| `docs/x-posts/metaplex-agent-mcp-launch.md` | excluded | published or archived content |
| `docs/x-posts/metaplex-agent-mcp-veo-script.md` | excluded | published or archived content |
| `docs/x-posts/metaplex-agent-mcp-x-post.md` | excluded | published or archived content |
| `docs/x-posts/news-archive-x-post.md` | excluded | published or archived content |
| `docs/x-posts/nvidia-forum-audio2face-x-post.md` | excluded | published or archived content |
| `docs/x-posts/onchain-agent-wallets-x-post.md` | excluded | published or archived content |
| `docs/x-posts/open-source-ecosystem.md` | excluded | published or archived content |
| `docs/x-posts/open-weight-3d-forge-thread.md` | excluded | published or archived content |
| `docs/x-posts/oracle-trading-mcp-x-post.md` | excluded | published or archived content |
| `docs/x-posts/osf-issue-reply.md` | excluded | published or archived content |
| `docs/x-posts/proof-of-life-x-post.md` | excluded | published or archived content |
| `docs/x-posts/pumpfun-article-x-post.md` | excluded | published or archived content |
| `docs/x-posts/README.md` | excluded | published or archived content |
| `docs/x-posts/sperax-staking-in-chat-x-post.md` | excluded | published or archived content |
| `docs/x-posts/the-first-19-weeks.md` | excluded | published or archived content |
| `docs/x-posts/threews-avatar-launch.md` | excluded | published or archived content |
| `docs/x-posts/threews-avatar-video-script.md` | excluded | published or archived content |
| `docs/x-posts/universal-retargeting-thread.md` | excluded | published or archived content |
| `docs/x-posts/x-meetup-posts.md` | excluded | published or archived content |
| `docs/x-reply-playbook.md` | not-a-plan | X content/playbook doc, no unbuilt feature |
| `docs/x-story-author-brief.md` | not-a-plan | author guide for X story posts, process and voice rules |
| `docs/x-story-authoring.md` | not-a-plan | author guide for X story posts, process and voice rules |
| `docs/x-video.md` | no-open-work | describes the shipped X post reader and /x-video tool |
| `docs/x402-buyer.md` | no-open-work | shipped buyer client reference, no open items verified in code |
| `docs/x402-dev-tools.md` | no-open-work | shipped dev tools reference, no open items verified in code |
| `docs/x402-distribution.md` | order | [281](../281-plan-x402-clean-challenge-no-zero-amount-accepts.md). live agent-reputation challenge still carries amount-0 accepts that validators reject |
| `docs/x402-endpoints.md` | no-open-work | shipped paid endpoint catalog reference, no open items verified in code |
| `docs/x402-fresh-workers.md` | no-open-work | shipped fresh-wallet worker reference, no open items verified in code |
| `docs/x402-preflight.md` | no-open-work | shipped preflight tool reference, no open items verified in code |
| `docs/x402-ring-economy.md` | no-open-work | shipped ring economy reference and alarms, no open items verified in code |
| `docs/x402-settlement-pending.md` | no-open-work | shipped pending-settlement behavior reference, no open items verified in code |
| `docs/x402-solana-july-roundup-response.md` | not-a-plan | published social copy responding to a roundup post |
| `docs/x402-studio.md` | no-open-work | shipped merchant console reference, no open items verified in code |
| `docs/x402-upto.md` | order | [750](../750-plan-x402-batch-settlement-durable-vouchers.md). batch-settlement finding: no durable voucher store, worker or hooks exist |
| `docs/x402-vscode.md` | no-open-work | shipped VS Code extension reference, no open items verified in code |
| `docs/x402.md` | order | [284](../284-plan-x402-skill-invoke-idempotent-replay.md). invoke Idempotency-Key documented as not enforced; consumed intent re-402s |
| `docs/zauth/database.md` | not-a-plan | third-party provider reference docs |
| `docs/zauth/index.md` | not-a-plan | third-party provider reference docs |
| `docs/zauth/provider-hub.md` | not-a-plan | third-party provider reference docs |
| `docs/zauth/reposcan.md` | not-a-plan | third-party provider reference docs |
| `docs/zauth/vector.md` | not-a-plan | third-party provider reference docs |
| `examples/agenc-task-roundtrip/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/agent-native-3d/README.md` | retired-by-owner | demo of the retired roadmap campaign (order 10) |
| `examples/coach-leo/instructions.md` | not-a-plan | agent instruction file |
| `examples/coach-leo/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/coach-leo/SKILL.md` | not-a-plan | skill file |
| `examples/google-adk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/grok-remote-mcp/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/metamask-agent-wallet/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/monicas-apartment/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/paid-mcp-server/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/pump-fun-agent/instructions.md` | not-a-plan | agent instruction file |
| `examples/pump-fun-agent/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/skills/pump-fun-compose/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/skills/pump-fun-strategy/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/skills/pump-fun-trade/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/skills/pump-fun/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/skills/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/skills/solana-wallet/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/skills/wave/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `examples/three-concierge/instructions.md` | not-a-plan | agent instruction file |
| `examples/three-concierge/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `examples/three-concierge/SKILL.md` | not-a-plan | skill file |
| `examples/wallet-sign-in/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `extensions/checkout-companion/PERMISSIONS.md` | no-open-work | permission justifications |
| `extensions/checkout-companion/PRIVACY.md` | no-open-work | privacy statement |
| `extensions/checkout-companion/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `extensions/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `extensions/walk-avatar/PERMISSIONS.md` | no-open-work | store permission justifications |
| `extensions/walk-avatar/PRIVACY.md` | no-open-work | served at /extension/privacy (200) |
| `extensions/walk-avatar/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `extensions/walk-avatar/RELEASE.md` | owner-only | Chrome Web Store release checklist; assets and privacy/terms pages exist (200), submission is owner action |
| `extensions/walk-avatar/TERMS.md` | no-open-work | served at /extension/terms (200) |
| `herald-sdk/examples/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `herald-sdk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `home-assistant-integration/info.md` | covered-by-existing:095-partners-12-home-assistant-hacs.md | HACS info page |
| `home-assistant-integration/README.md` | covered-by-existing:095-partners-12-home-assistant-hacs.md | HACS default store submission |
| `hubs/awesome-agent-data-apis/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-agent-data-apis/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-agent-data-apis/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-agent-data-apis/README.md` | excluded | published curated list |
| `hubs/awesome-agent-identity/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-agent-identity/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-agent-identity/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-agent-identity/README.md` | excluded | published curated list |
| `hubs/awesome-agent-payments/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-agent-payments/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-agent-payments/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-agent-payments/README.md` | excluded | published curated list |
| `hubs/awesome-agent-protocols/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-agent-protocols/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-agent-protocols/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-agent-protocols/README.md` | excluded | published curated list |
| `hubs/awesome-agent-skills/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-agent-skills/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-agent-skills/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-agent-skills/README.md` | excluded | published curated list |
| `hubs/awesome-agent-wallets/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-agent-wallets/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-agent-wallets/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-agent-wallets/README.md` | excluded | published curated list |
| `hubs/awesome-browser-agents/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-browser-agents/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-browser-agents/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-browser-agents/README.md` | excluded | published curated list |
| `hubs/awesome-embodied-agents/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-embodied-agents/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-embodied-agents/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-embodied-agents/README.md` | excluded | published curated list |
| `hubs/awesome-generative-3d/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-generative-3d/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-generative-3d/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-generative-3d/README.md` | excluded | published curated list |
| `hubs/awesome-robinhood-crypto/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-robinhood-crypto/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-robinhood-crypto/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-robinhood-crypto/README.md` | excluded | published curated list |
| `hubs/awesome-solana-agents/.github/ISSUE_TEMPLATE/add-project.md` | excluded | published curated list |
| `hubs/awesome-solana-agents/.github/PULL_REQUEST_TEMPLATE.md` | excluded | published curated list |
| `hubs/awesome-solana-agents/CONTRIBUTING.md` | excluded | published curated list |
| `hubs/awesome-solana-agents/README.md` | excluded | published curated list |
| `hubs/README.md` | excluded | published curated list |
| `infra/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/_pyclient/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/blender/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/blender/SUBMITTING.md` | owner-only | Blender Extensions submission; package validated, needs owner Blender ID |
| `integrations/comfyui/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/comfyui/SUBMITTING.md` | owner-only | Comfy Registry publish needs owner publisher account |
| `integrations/framer/README.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | Framer marketplace submission under owner account |
| `integrations/livekit/livekit-plugins-threews/README.md` | covered-by-existing:087-partners-04-livekit-pipecat-avatar.md | LiveKit avatar plugin package |
| `integrations/modly/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/modly/SUBMITTING.md` | owner-only | owner-approved GitHub publish and trust PR to Modly registry |
| `integrations/modly/three-ws-publish/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/pipecat/pipecat-threews/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `integrations/pipecat/pipecat-threews/docs-submission/docs-json-navigation.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | Pipecat docs PR text, sent by owner |
| `integrations/pipecat/pipecat-threews/docs-submission/supported-services-row.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | Pipecat docs PR text, sent by owner |
| `integrations/pipecat/pipecat-threews/README.md` | covered-by-existing:087-partners-04-livekit-pipecat-avatar.md | Pipecat avatar service package |
| `integrations/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `integrations/webflow/README.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | Webflow Apps submission is part of the site-builders send step |
| `integrations/wordpress/three-ws-agent/README.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | WordPress directory submission is part of the site-builders send step |
| `ios/docs/ASSETS.md` | owner-only | listing screenshots must be captured on a real device |
| `ios/docs/CARPLAY.md` | owner-only | CarPlay entitlement request is an Apple owner action; code already built |
| `ios/docs/REVIEW-RISK.md` | order | [264](../264-plan-auth-purge-deleted-accounts-after-30-days.md). privacy policy promises 30 day purge, no job performs it |
| `ios/docs/SUBMISSION.md` | owner-only | Apple Developer enrollment, Team ID, APPLE_TEAM_ID, APNs key, TestFlight; AASA returns 503 until owner sets APPLE_TEAM_ID |
| `ios/native/App/CapApp-SPM/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `ios/publish/listing.md` | owner-only | App Store Connect listing copy; submission is owner action |
| `ios/README.md` | owner-only | "What is not wired yet" needs an Apple Developer account (APPLE_TEAM_ID, APNs key, signing, screenshots) |
| `maintenance/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `marketing/android-launch/kit/cmc-article.md` | not-a-plan | published marketing content |
| `marketing/android-launch/kit/IMAGE-ORDER.md` | not-a-plan | asset ordering for a marketing kit |
| `marketing/android-launch/kit/post.md` | not-a-plan | published marketing content |
| `marketing/android-launch/README.md` | not-a-plan | marketing kit readme |
| `marketing/brand/README.md` | not-a-plan | brand reference |
| `marketing/dextools/README.md` | not-a-plan | announcement graphics for a shipped chart source |
| `marketing/growth/applications/creator-grant-proposal.md` | owner-only | grant application; submission and signatures are owner actions |
| `marketing/growth/applications/digitalocean-startups-memo.md` | owner-only | startup program memo; owner submits |
| `marketing/growth/applications/elevenlabs-startup-grants.md` | owner-only | grant application; owner submits |
| `marketing/growth/applications/gated/coinbase-founders-fuel.md` | owner-only | program application; owner submits and commit gated |
| `marketing/growth/applications/gated/solana-foundation-grant.md` | order | [700](../700-plan-x402-self-hostable-solana-facilitator.md). engineering scope M1-M4 is agent-doable; submission is owner-only |
| `marketing/growth/applications/google-cloud-ai-agents.md` | order | [729](../729-plan-a2a-agent-card-compliance-marketplace.md). agent card still non-compliant; billing hold and submission are owner actions |
| `marketing/growth/applications/hacktoberfest-2026-fest.md` | owner-only | event registration by the owner |
| `marketing/growth/applications/mongodb-for-startups-memo.md` | owner-only | startup program memo; owner submits |
| `marketing/growth/applications/README.md` | not-a-plan | index of application packages |
| `marketing/growth/channel-audit.md` | not-a-plan | channel audit report |
| `marketing/growth/events/ibm-event-two.md` | owner-only | event kit; speakers, scheduling and posting are owner actions |
| `marketing/growth/events/open-source-friday-menu.md` | order | [285](../285-plan-avatar-humanik-sanitized-bone-names.md). menu of good first issues; only item 1 is still open, the rest shipped |
| `marketing/growth/events/osf-issues/01-rig-humanik-sanitized-names.md` | order | [285](../285-plan-avatar-humanik-sanitized-bone-names.md). probe on main still returns null for Character1Hips |
| `marketing/growth/events/osf-issues/02-rig-biped-finger-chains.md` | shipped | src/glb-canonicalize.js biped finger chains; GitHub issue may be stale (owner closes) |
| `marketing/growth/events/osf-issues/03-rig-source-engine-valvebiped.md` | shipped | src/glb-canonicalize.js ValveBiped mapping; GitHub issue may be stale (owner closes) |
| `marketing/growth/events/osf-issues/04-glb-magic-declared-length.md` | shipped | src/shared/glb-magic.js declared length check; GitHub issue may be stale (owner closes) |
| `marketing/growth/events/osf-issues/05-tests-url-scheme-guards.md` | shipped | URL scheme guard tests present; GitHub issue may be stale (owner closes) |
| `marketing/growth/events/osf-issues/06-tests-model-url-allowlist.md` | shipped | model URL allowlist tests present; GitHub issue may be stale (owner closes) |
| `marketing/growth/events/osf-issues/07-pulse-format-unit-rollover.md` | shipped | src/shared/pulse-format.js unit rollover; GitHub issue may be stale (owner closes) |
| `marketing/growth/events/README.md` | not-a-plan | events index |
| `marketing/growth/events/three-world-session.md` | not-a-plan | event template and run-of-show copy, owner-run |
| `marketing/growth/github-growth-surfaces.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | GitHub repo settings and listing steps are owner/external; prepared text only |
| `marketing/growth/kits/MKT-2026-09-IBM-EVENT.md` | not-a-plan | campaign kit copy for an IBM event |
| `marketing/growth/kits/MKT-2026-09-OPENAI-STUDIO.md` | not-a-plan | campaign kit copy |
| `marketing/growth/kits/MKT-2026-09-OSF.md` | not-a-plan | Open Source Friday campaign kit copy |
| `marketing/growth/kits/MKT-2026-10-AWS-MARKET.md` | not-a-plan | campaign kit copy |
| `marketing/growth/kits/MKT-2026-10-ELEVEN-BODY.md` | not-a-plan | campaign kit copy |
| `marketing/growth/kits/MKT-2026-10-NVIDIA-DH.md` | not-a-plan | campaign kit copy |
| `marketing/growth/kits/MKT-2026-11-GCP-AGENT.md` | order | [729](../729-plan-a2a-agent-card-compliance-marketplace.md). kit depends on the agent card being a valid A2A/Marketplace card |
| `marketing/growth/kits/MKT-2026-11-HF-LOOP.md` | not-a-plan | campaign kit copy |
| `marketing/growth/kits/MKT-2026-11-QUICKNODE.md` | order | [788](../788-plan-growth-kits-stale-claims-refresh.md). kit flags a stale sentence and quotes dated measurements |
| `marketing/growth/measurement.md` | order | [765](../765-plan-growth-campaign-attribution-ledger.md). UTM/campaign conventions exist but no first-party attribution; PostHog is home-only |
| `marketing/growth/opportunities.md` | order | [762](../762-plan-growth-zed-raycast-gradio-poe-listing-packages.md). registries needing a package first: Zed, n8n; rest is owner submission (938) |
| `marketing/growth/proof/README.md` | not-a-plan | generated proof-asset regeneration notes |
| `marketing/growth/README.md` | no-open-work | program index and rules, no outstanding engineering |
| `marketing/growth/submissions/adobe-mixamo-permission.md` | covered-by-existing:085-partners-02-animation-library-license.md | permission request text for animation library licensing |
| `marketing/growth/submissions/agent-registries/cursor-directory.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | agent framework registry entry prepared as text |
| `marketing/growth/submissions/agent-registries/dify.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | agent framework registry entry prepared as text |
| `marketing/growth/submissions/agent-registries/hermes-agent.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | agent framework registry entry prepared as text |
| `marketing/growth/submissions/agent-registries/kilo-code.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | agent framework registry entry prepared as text |
| `marketing/growth/submissions/agent-registries/opencode.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | agent framework registry entry prepared as text |
| `marketing/growth/submissions/agent-registries/openhands.md` | covered-by-existing:093-partners-10-agent-tool-packages.md | agent framework registry entry prepared as text |
| `marketing/growth/submissions/awesome-blender.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-generative-ai.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-mcp-servers.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-remote-mcp-servers-jaw9c.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-remote-mcp-servers-punkpeye.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-text-to-3d.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-threejs.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-web-components.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/awesome-webxr.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/discord-activity.md` | covered-by-existing:088-partners-05-discord-activity.md | Discord Activity submission |
| `marketing/growth/submissions/e2b-awesome-ai-agents.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/home-assistant.md` | covered-by-existing:095-partners-12-home-assistant-hacs.md | HACS submission |
| `marketing/growth/submissions/khronos-gltf-project-explorer.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/livekit-avatar-plugin.md` | covered-by-existing:087-partners-04-livekit-pipecat-avatar.md | LiveKit avatar plugin submission |
| `marketing/growth/submissions/mcpservers-org.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/pipecat-integration.md` | covered-by-existing:087-partners-04-livekit-pipecat-avatar.md | Pipecat integration submission |
| `marketing/growth/submissions/programs/avaturn-partner.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/cloudflare-for-startups.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/composio-toolkit.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/deepgram-startup-program.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/discord-app-verification.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/elevenlabs-startup-grant.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/github-technology-partner.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/jetbrains-ai-partner.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/livekit-startups.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/meshy-partner.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/README.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/rokoko-partner.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/shopify-partner-app-store.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/uthana-partner.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/programs/vroid-hub-approval.md` | covered-by-existing:939-partners-16-program-applications.md | partner/startup program application |
| `marketing/growth/submissions/README.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/shopify-app.md` | covered-by-existing:091-partners-08-shopify-product-media.md | Shopify app submission |
| `marketing/growth/submissions/site-builders.md` | covered-by-existing:094-partners-11-site-builder-embeds.md | WordPress/Framer/Webflow embeds and listings |
| `marketing/growth/submissions/slicer-trusted-hosts.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | prepared listing/PR text, owner sends |
| `marketing/growth/submissions/tripo-launch-post.md` | covered-by-existing:936-partners-13-tripo-reply-and-house-key.md | Tripo launch post and reply |
| `marketing/growth/submissions/vroid-hub-app.md` | covered-by-existing:092-partners-09-vroid-hub-import.md | VRoid Hub app submission |
| `marketing/growth/sweep-2026-09-18.md` | order | [772](../772-plan-growth-credibility-files-translations-credits.md), [762](../762-plan-growth-zed-raycast-gradio-poe-listing-packages.md), [729](../729-plan-a2a-agent-card-compliance-marketplace.md). code-change rows X2/X3, credibility files, locale gaps, unbuilt store packages; OpenRouter attribution and CITATION.cff already shipped |
| `marketing/growth/templates.md` | not-a-plan | outreach message templates |
| `marketing/huggingface-article/post.md` | not-a-plan | published article copy |
| `marketing/ibm-partner-plus/agent-connect-listing.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/ibm-partner-plus/badge-usage.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/ibm-partner-plus/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/ibm-partner-plus/social-copy.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/imessage-video/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/mobile-launch/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/motion-studio/brief.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/motion-studio/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/motion-studio/shotlist.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/motion-studio/style-guide.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/nvidia-inception/README.md` | owner-only | portal badge-package retrieval checklist needs the owner NVIDIA login |
| `marketing/nvidia-inception/social-copy.md` | not-a-plan | social copy |
| `marketing/open-source-ecosystem/kit/IMAGE-ORDER.md` | not-a-plan | image order list for a campaign kit |
| `marketing/openai-select-partner/badge-usage.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/openai-select-partner/openai-approval-request.md` | owner-only | approval request to OpenAI, owner sends |
| `marketing/openai-select-partner/partnership-and-gpt-briefing.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/openai-select-partner/press-launch-plan.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/openai-select-partner/press-release.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/openai-select-partner/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/openai-select-partner/social-copy.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/openai-select-partner/source-assets/README.md` | no-open-work | asset folder note |
| `marketing/OPERATING-PLAN.md` | order | [765](../765-plan-growth-campaign-attribution-ledger.md). plan needs per-campaign measurement that does not exist; rest is cadence and copy |
| `marketing/partner-packets/anthropic.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | MCP registry, plugin marketplace and connectors directory dispatch (owner steps); see also 530 for registry cleanup |
| `marketing/partner-packets/elevenlabs-startup-grants.md` | covered-by-existing:939-partners-16-program-applications.md | ElevenLabs startup grant application |
| `marketing/partner-packets/google-cloud-ai-agents.md` | order | [729](../729-plan-a2a-agent-card-compliance-marketplace.md). card gaps are engineering; Vertex billing hold is a remaining owner item |
| `marketing/partner-packets/ibm-champions-nomination.md` | owner-only | nomination submitted by the owner |
| `marketing/partner-packets/ibm-g2-review.md` | owner-only | review request sent by the owner |
| `marketing/partner-packets/openai-share-your-story.md` | owner-only | story submission sent by the owner |
| `marketing/partner-packets/quicknode-rpc-failover-field-note.md` | order | [788](../788-plan-growth-kits-stale-claims-refresh.md). contains a stale "not yet deployed" sentence and a dated evidence table |
| `marketing/partner-packets/quicknode-spotlight-ask.md` | owner-only | ask sent by the owner |
| `marketing/partner-packets/README.md` | not-a-plan | packet index |
| `marketing/product-demo/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/pumpfun-verified/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/README.md` | not-a-plan | marketing index |
| `marketing/seeker-launch/post.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/seeker-launch/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/seeker-launch/video-launch.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/the-first-19-weeks/kit/IMAGE-ORDER.md` | not-a-plan | image order list for a campaign kit |
| `marketing/the-first-19-weeks/kit/POSTING-CHECKLIST.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/the-first-19-weeks/README.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/three-utility-season/01-access-tiers.md` | order | [715](../715-plan-three-hold-activate-worlds-private.md), [728](../728-plan-three-hold-activate-early-drops-and-name-dibs.md). private worlds and early drops are PLANNED; enforced:false in api/_lib/three-access.js |
| `marketing/three-utility-season/02-holder-free-quota.md` | order | [282](../282-plan-wallet-token2022-checkout-rails-honest-config.md). plan checkout returns 503 not_configured; pricing page must say so |
| `marketing/three-utility-season/03-gated-embed-mcp.md` | order | [282](../282-plan-wallet-token2022-checkout-rails-honest-config.md). gasless purchase builder uses legacy token program for a Token-2022 mint |
| `marketing/three-utility-season/04-forge-max-holder.md` | not-a-plan | substituted edition copy; original needs LABOR_ESCROW_SECRET_BASE58 (owner env var) |
| `marketing/three-utility-season/05-gated-embed-create.md` | order | [753](../753-plan-embed-widget-studio-holder-gate-control.md). gate-create API and MCP live; no creation control in /studio |
| `marketing/three-utility-season/06-deploy-fee-waiver.md` | owner-only | browser deployer charges no fee though a 2026-08-19 changelog line says it does; owner decides fee vs correcting copy |
| `marketing/three-utility-season/07-holder-scene-unlock.md` | owner-only | needs GAME_TOKEN_TREASURY and PLAY_GATE_MINT set on three-ws-multiplayer |
| `marketing/three-utility-season/08-tier-api-for-agents.md` | order | [282](../282-plan-wallet-token2022-checkout-rails-honest-config.md). x402 self-facilitator Token-2022 rejection is fixed; tier API live; remaining Token-2022 gaps are the purchase builders |
| `marketing/three-utility-season/09-buyback-ledger.md` | not-a-plan | edition copy; buyback.enabled is false by owner config, reads zero |
| `marketing/three-utility-season/10-gameready-holder.md` | order | [282](../282-plan-wallet-token2022-checkout-rails-honest-config.md). premium pass quote builder uses legacy token program |
| `marketing/three-utility-season/11-built-in-public.md` | not-a-plan | edition copy |
| `marketing/three-utility-season/12-quarter-recap.md` | not-a-plan | edition copy, figures read on posting day |
| `marketing/three-utility-season/README.md` | order | [282](../282-plan-wallet-token2022-checkout-rails-honest-config.md), [715](../715-plan-three-hold-activate-worlds-private.md), [728](../728-plan-three-hold-activate-early-drops-and-name-dibs.md). findings table is the source for the Token-2022 and perk-wiring orders |
| `marketing/x402-milestone/README.md` | shipped | duplicate-signature fix landed 2026-07-29, see docs/x402-ring-economy.md; rest is video render notes |
| `marketing/x402-three/coinmarketcap-article.md` | not-a-plan | campaign copy, press or asset notes |
| `marketing/x402-three/x-article.md` | not-a-plan | campaign copy, press or asset notes |
| `marketplace/plugins/three-ws-3d/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `marketplace/plugins/three-ws-3d/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `marketplace/plugins/three-ws-3d/skills/auto-rig/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `marketplace/plugins/three-ws-3d/skills/forge-3d/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `marketplace/plugins/three-ws-3d/skills/mesh-forge/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `marketplace/plugins/three-ws-3d/skills/text-to-avatar/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `marketplace/plugins/three-ws-3d/SUBMISSION.md` | owner-only | Claude community marketplace submission is external posting |
| `marketplace/plugins/three-ws-developer/commands/scaffold-agent.md` | not-a-plan | plugin command prompt |
| `marketplace/plugins/three-ws-developer/commands/setup-mcp.md` | not-a-plan | plugin command prompt |
| `marketplace/plugins/three-ws-developer/commands/use-tools.md` | not-a-plan | plugin command prompt |
| `marketplace/plugins/three-ws-developer/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `marketplace/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `mcp-bridge/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `mcp-server/examples/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `mcp-server/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `multiplayer/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `packages/activity-mcp/README.md` | no-open-work | package README, no open work |
| `packages/agenc-mcp/README.md` | no-open-work | package README, no open work |
| `packages/agenc/README.md` | no-open-work | package README, no open work |
| `packages/agent-cli/README.md` | order | [272](../272-plan-agent-cli-tui-slash-commands-and-entrypoints.md). bin, src/index.js, src/cli.js, TUI and tests missing; README status confirms |
| `packages/agent-glance/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agent-guards/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agent-memory/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agent-runtime/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agent-sniper/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agent-sniper/runbooks/00-overview.md` | not-a-plan | July 2026 funded-wallet recording campaign runbook/log; real SOL spend, no open product feature |
| `packages/agent-sniper/runbooks/01-onchain-truth.md` | not-a-plan | July 2026 funded-wallet recording campaign runbook/log; real SOL spend, no open product feature |
| `packages/agent-sniper/runbooks/02-platform-native.md` | not-a-plan | July 2026 funded-wallet recording campaign runbook/log; real SOL spend, no open product feature |
| `packages/agent-sniper/runbooks/03-agent-screen-caster.md` | not-a-plan | July 2026 funded-wallet recording campaign runbook/log; real SOL spend, no open product feature |
| `packages/agent-sniper/runbooks/LOG.md` | not-a-plan | July 2026 funded-wallet recording campaign runbook/log; real SOL spend, no open product feature |
| `packages/agent-sniper/runbooks/PLAN.md` | not-a-plan | July 2026 funded-wallet recording campaign runbook/log; real SOL spend, no open product feature |
| `packages/agent-vitals/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agentcore-payments-mcp/examples/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agentcore-payments-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/agents-sdk/README.md` | order | [278](../278-plan-agents-sdk-route-parity-and-release-readiness.md). SDK methods hit unmounted /api/v1 routes (intel, me/*, wallet, swap); no tests dir; README status stale |
| `packages/agora-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ai-sdk/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/alerts-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/alibaba-cloud-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ar-studio/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `packages/ar-studio/CODE_OF_CONDUCT.md` | excluded | license, changelog or repository boilerplate |
| `packages/ar-studio/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `packages/ar-studio/mcp-package/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ar-studio/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ar-studio/SECURITY.md` | excluded | license, changelog or repository boilerplate |
| `packages/ar-studio/templates/react/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ar-studio/templates/static/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ar-studio/templates/vite/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/assets-cli/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/assistant-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/audio-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/autopilot-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/avatar-agent-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/avatar-cli/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/avatar-schema/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/avatar-stream/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/billing-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/blender-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/brain-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/brownout/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/clash-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/companion-sdk/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/concierge-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/copy-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/create-agent/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/defi-utils/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/forge/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/glb-diff/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/glb-tools/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/godot-bridge/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/guardian/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/herald-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/home-bridge/README.md` | no-open-work | shipped; upstream resubscribe issue doc exists at docs/upstream, workaround in place |
| `packages/home-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/hood-portfolios-sdk/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ibm-watsonx-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ibm-x402-mcp/CATALOG.md` | not-a-plan | IBM catalog listing field text; version fields match server.json at submission |
| `packages/ibm-x402-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/ibm-x402-mcp/SUPPORT.md` | not-a-plan | support policy document |
| `packages/intel-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/intel/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/irl/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/knock-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/knock-sdk/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/kol-mcp/examples/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/kol-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/langchain/INTEGRATION_ISSUE.md` | covered-by-existing:938-partners-15-listings-prs-and-sends.md | issue text for owner to file after npm publish; also 093-partners-10-agent-tool-packages.md |
| `packages/langchain/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/loom-mcp/examples/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/loom-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/marketplace-mcp/examples/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/marketplace-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/mcp-policy/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/metaplex-agent-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/mocap/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/motion/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/names/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/naming-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/node-operator/README.md` | no-open-work | shipped in-repo; npm publish is the owner step covered by 938 |
| `packages/notifications-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/onchain-agent-wallets/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/oracle-model/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/portal/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/portfolio-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/pose/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/provenance-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/pumpfun-mcp/examples/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/pumpfun-mcp/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/pumpfun-skills/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/react/README.md` | no-open-work | reference README; relative links and /api routes verified, bin/main files present |
| `packages/readme-3d/.claude/skills/3d-in-readme/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `packages/readme-3d/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `packages/readme-3d/docs/index.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/docs/tutorials/01-hello-3d-markdown.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/docs/tutorials/02-convert-a-glb.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/docs/tutorials/03-text-to-3d-avatar.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/docs/tutorials/04-size-budgets.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/docs/tutorials/05-issues-prs-discussions.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/examples/avatar.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/examples/cube.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/examples/README.md` | no-open-work | tutorial/example for a shipped package |
| `packages/readme-3d/examples/torus.md` | not-a-plan | generated STL example output |
| `packages/readme-3d/prompts/add-3d-to-readme.md` | not-a-plan | user-facing copy-paste prompt |
| `packages/readme-3d/prompts/generate-mascot-avatar.md` | not-a-plan | user-facing copy-paste prompt |
| `packages/readme-3d/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/readme-3d/skills/3d-in-readme/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `packages/README.md` | order | [785](../785-plan-docs-packages-index-complete-and-checked.md). 18 of 110 packages missing from the index table |
| `packages/render/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/reputation/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/retarget/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/scene-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/see/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/shipfeed/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/sign-language/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/signals-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/skill-import/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/skill-license/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/solana-memo-media-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/spatial-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/strategies/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/three-token-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/three-ws-cli/README.md` | no-open-work | shipped reference; publish step covered by existing parity-09 order |
| `packages/three-ws/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/threews-avatar-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/tool-sdk/README.md` | order | [752](../752-plan-mcp-naming-publish-without-private-dependency.md). naming-mcp has file: dep on private tool-sdk, next publish breaks |
| `packages/tty-3d/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/tty-avatar/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/tutor-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/unity-bridge/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/unreal-bridge/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vanity-mcp/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vanity-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vanity/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/viewer-presets/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vision-mcp/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vision-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/voice/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/voice/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vscode-3d/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `packages/vscode-3d/PUBLISHING.md` | order | [983](../983-plan-vscode-3d-marketplace-publish-ready.md). extension not on Marketplace; owner tokens only missing piece |
| `packages/vscode-3d/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/vscode-x402/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `packages/vscode-x402/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/wallet-linkage/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/witness/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-fetch/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-fetch/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-mcp/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-mcp/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-preflight/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-server/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `packages/x402-server/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `page-agent-sdk/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `page-agent-sdk/docs/api-reference.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/getting-started.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/guide-building-blocks.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/guide-custom-avatars.md` | no-open-work | user-facing authoring checklist, not outstanding work |
| `page-agent-sdk/docs/guide-frameworks.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/guide-narration.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/recipes.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/docs/troubleshooting.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/examples/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `page-agent-sdk/PUBLISHING.md` | owner-only | npm publish of @three-ws/page-agent is an owner action |
| `page-agent-sdk/README.md` | no-open-work | reference doc for shipped behavior; no open-work markers found |
| `pages/ibm/HOSTING.md` | no-open-work | reference doc, no outstanding work found |
| `pages/README.md` | no-open-work | reference doc, no outstanding work found |
| `prompts/finish/_context/00-RETIRED-BY-OWNER.md` | not-a-plan | retirement record, rules |
| `prompts/finish/_context/backlog-00-INDEX.md` | owner-only | each row blocked on an owner action |
| `prompts/finish/_context/backlog-PROGRESS.md` | no-open-work | lane ledger, items tracked in owner rows |
| `prompts/finish/_context/beat-00-CONTEXT.md` | shipped | beat lane done |
| `prompts/finish/_context/beat-PROGRESS.md` | shipped | beat lane done |
| `prompts/finish/_context/best3d-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/best3d-PROGRESS.md` | order | [263](../263-plan-ops-gpu-worker-images-redeploy-and-drift-check.md), [751](../751-plan-forge-quality-bench-fleet-ceilings-remeasure.md). remaining items are undeployed GPU lanes and stale quality numbers |
| `prompts/finish/_context/elevate-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/event-00-CONTEXT.md` | not-a-plan | event context |
| `prompts/finish/_context/event-PROGRESS.md` | no-open-work | event copy, nothing agent-doable open |
| `prompts/finish/_context/event-README.md` | not-a-plan | event pack readme |
| `prompts/finish/_context/fix-queue-00-INDEX.md` | no-open-work | queue index |
| `prompts/finish/_context/fix-queue-PROGRESS.md` | no-open-work | fixes shipped |
| `prompts/finish/_context/gcp-credits-README.md` | not-a-plan | credits plan readme |
| `prompts/finish/_context/home-00-CONTEXT.md` | retired-by-owner | Home campaign |
| `prompts/finish/_context/home-PROGRESS.md` | retired-by-owner | Home campaign |
| `prompts/finish/_context/integrate-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/integrate-PROGRESS.md` | covered-by-existing:506-integrate-07-pump-claims-listener.md | open rows map to existing integrate orders |
| `prompts/finish/_context/materialize-PROGRESS.md` | no-open-work | done |
| `prompts/finish/_context/okx-ai-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/okx-ai-PROGRESS.md` | owner-only | remaining rows need funded wallets |
| `prompts/finish/_context/okx-ai-README.md` | no-open-work | readme |
| `prompts/finish/_context/okx-ai-RUNBOOK.md` | owner-only | funding runbook |
| `prompts/finish/_context/openai-pr-00-START-HERE.md` | owner-only | submission to OpenAI is an owner/third-party step |
| `prompts/finish/_context/parity-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/parity-PROGRESS.md` | no-open-work | done |
| `prompts/finish/_context/partners-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/partners-PROGRESS.md` | covered-by-existing:085-partners-02-animation-library-license.md | open partner items have existing orders |
| `prompts/finish/_context/production-100-00-INDEX.md` | order | [724](../724-plan-play-multiplayer-redis-scale-out.md). multiplayer single-instance row |
| `prompts/finish/_context/production-100-OWNER-ACTIONS.md` | order | [249](../249-plan-ops-db-storage-cap-archive-and-reclaim.md), [263](../263-plan-ops-gpu-worker-images-redeploy-and-drift-check.md), [271](../271-plan-ops-world-health-retired-state.md). rows 32, 31/38/46/67/69/71, 68; rest owner-only |
| `prompts/finish/_context/production-100-PROGRESS.md` | order | [262](../262-plan-i18n-restore-language-picker-manifest.md). untranslated locale keys; rest shipped |
| `prompts/finish/_context/quality-bar-_shared.md` | not-a-plan | shared rules |
| `prompts/finish/_context/quality-bar-README.md` | order | [733](../733-plan-web-mobile-core-vitals-remeasure-and-fix.md). stale mobile baseline |
| `prompts/finish/_context/roadmap-00-README.md` | order | [754](../754-plan-factcheck-benchmark-evidence-ranking-and-publish.md). fact-check benchmark rung |
| `prompts/finish/_context/roadmap-REUSE-MAP.md` | not-a-plan | reuse map |
| `prompts/finish/_context/swarm-100-README.md` | order | [275](../275-plan-site-console-resweep-and-fix.md). console sweep failures |
| `prompts/finish/_context/x-grok-00-CONTEXT.md` | no-open-work | context only |
| `prompts/finish/_context/x-grok-PROGRESS.md` | covered-by-existing:023-x-grok-01-connector-compat-probe.md | open items have existing x-grok orders |
| `prompts/finish/023-x-grok-01-connector-compat-probe.md` | excluded | already a work order in the queue |
| `prompts/finish/024-x-grok-02-cloud-agent-rate-limits.md` | excluded | already a work order in the queue |
| `prompts/finish/039-x-grok-17-xai-remote-mcp-e2e.md` | excluded | already a work order in the queue |
| `prompts/finish/067-best3d-01-trellis2-default-lane.md` | excluded | already a work order in the queue |
| `prompts/finish/068-best3d-02-pixal3d-multiview.md` | excluded | already a work order in the queue |
| `prompts/finish/069-best3d-03-rig-anything.md` | excluded | already a work order in the queue |
| `prompts/finish/070-best3d-04-editable-parts.md` | excluded | already a work order in the queue |
| `prompts/finish/074-best3d-08-webgpu-tsl-path.md` | excluded | already a work order in the queue |
| `prompts/finish/081-best3d-15-splat-parity.md` | excluded | already a work order in the queue |
| `prompts/finish/085-partners-02-animation-library-license.md` | excluded | already a work order in the queue |
| `prompts/finish/087-partners-04-livekit-pipecat-avatar.md` | excluded | already a work order in the queue |
| `prompts/finish/088-partners-05-discord-activity.md` | excluded | already a work order in the queue |
| `prompts/finish/091-partners-08-shopify-product-media.md` | excluded | already a work order in the queue |
| `prompts/finish/092-partners-09-vroid-hub-import.md` | excluded | already a work order in the queue |
| `prompts/finish/093-partners-10-agent-tool-packages.md` | excluded | already a work order in the queue |
| `prompts/finish/094-partners-11-site-builder-embeds.md` | excluded | already a work order in the queue |
| `prompts/finish/095-partners-12-home-assistant-hacs.md` | excluded | already a work order in the queue |
| `prompts/finish/401-auto-restore-green-vitest.md` | excluded | already a work order in the queue |
| `prompts/finish/403-auto-drain-docs-freshness.md` | excluded | already a work order in the queue |
| `prompts/finish/456-auto-mcp-tools-settings-page.md` | excluded | already a work order in the queue |
| `prompts/finish/458-auto-solana-agent-sdk-zod-cve.md` | excluded | already a work order in the queue |
| `prompts/finish/506-integrate-07-pump-claims-listener.md` | excluded | already a work order in the queue |
| `prompts/finish/512-integrate-13-anti-snipe-native-lane.md` | excluded | already a work order in the queue |
| `prompts/finish/530-integrate-31-mcp-registry-cleanup.md` | excluded | already a work order in the queue |
| `prompts/finish/536-integrate-37-three-post-impact.md` | excluded | already a work order in the queue |
| `prompts/finish/539-integrate-40-coin-intel-signals.md` | excluded | already a work order in the queue |
| `prompts/finish/540-integrate-41-memo-inscription-reader.md` | excluded | already a work order in the queue |
| `prompts/finish/544-integrate-45-chains-turnover.md` | excluded | already a work order in the queue |
| `prompts/finish/545-integrate-46-funder-graph-3d.md` | excluded | already a work order in the queue |
| `prompts/finish/548-integrate-49-robinhood-launch-venues.md` | excluded | already a work order in the queue |
| `prompts/finish/549-integrate-50-hookforge-catalog.md` | excluded | already a work order in the queue |
| `prompts/finish/605-beat-05-onchain-allowance-budgets.md` | excluded | already a work order in the queue |
| `prompts/finish/606-beat-06-burner-wallet-with-owner-confirmation.md` | excluded | already a work order in the queue |
| `prompts/finish/610-beat-10-hire-escrow-evaluator-and-disputes.md` | excluded | already a work order in the queue |
| `prompts/finish/614-beat-14-deploy-orders-engine-with-ratcheting-exits.md` | excluded | already a work order in the queue |
| `prompts/finish/615-beat-15-perps-venues-jupiter-and-hyperliquid.md` | excluded | already a work order in the queue |
| `prompts/finish/616-beat-16-solana-prediction-markets-with-shadow-mode.md` | excluded | already a work order in the queue |
| `prompts/finish/619-beat-19-token-due-diligence-and-funding-graph.md` | excluded | already a work order in the queue |
| `prompts/finish/621-beat-21-agent-cli-automation-mode-and-html-reports.md` | excluded | already a work order in the queue |
| `prompts/finish/622-beat-22-solana-agent-registry-registration.md` | excluded | already a work order in the queue |
| `prompts/finish/623-beat-23-skill-supply-chain-scanner.md` | excluded | already a work order in the queue |
| `prompts/finish/626-beat-26-metered-openai-compatible-router.md` | excluded | already a work order in the queue |
| `prompts/finish/627-beat-27-launch-fee-and-holder-reward-features.md` | excluded | already a work order in the queue |
| `prompts/finish/902-backlog-01-x402-settle-runway.md` | excluded | already a work order in the queue |
| `prompts/finish/907-backlog-08-okx-chat-bot-always-on.md` | excluded | already a work order in the queue |
| `prompts/finish/911-okx-ai-08-forge-relisting.md` | excluded | already a work order in the queue |
| `prompts/finish/913-okx-ai-04-e2e-real-payment-test.md` | excluded | already a work order in the queue |
| `prompts/finish/914-okx-ai-07-final-audit-and-watch.md` | excluded | already a work order in the queue |
| `prompts/finish/917-roadmap-pumpfun-trading.md` | excluded | already a work order in the queue |
| `prompts/finish/918-roadmap-pumpfun-trading-arena.md` | excluded | already a work order in the queue |
| `prompts/finish/919-parity-09-ship-and-publish.md` | excluded | already a work order in the queue |
| `prompts/finish/920-parity-10-community-skill-registry.md` | excluded | already a work order in the queue |
| `prompts/finish/921-parity-11-directory-listings.md` | excluded | already a work order in the queue |
| `prompts/finish/922-parity-12-why-three-ws.md` | excluded | already a work order in the queue |
| `prompts/finish/923-parity-13-builder-competition.md` | excluded | already a work order in the queue |
| `prompts/finish/924-parity-14-pricing-levers.md` | excluded | already a work order in the queue |
| `prompts/finish/925-parity-15-mention-to-launch.md` | excluded | already a work order in the queue |
| `prompts/finish/926-x-grok-45-owner-x-api-tier.md` | excluded | already a work order in the queue |
| `prompts/finish/927-x-grok-46-owner-grok-api-key.md` | excluded | already a work order in the queue |
| `prompts/finish/928-x-grok-47-go-live-mention-bot.md` | excluded | already a work order in the queue |
| `prompts/finish/929-x-grok-48-connector-directory-listings.md` | excluded | already a work order in the queue |
| `prompts/finish/930-x-grok-49-launch-announcement.md` | excluded | already a work order in the queue |
| `prompts/finish/931-x-grok-50-player-card-approval.md` | excluded | already a work order in the queue |
| `prompts/finish/932-best3d-05-pricing-preview-pay-to-keep.md` | excluded | already a work order in the queue |
| `prompts/finish/933-best3d-06-sam-3d-objects.md` | excluded | already a work order in the queue |
| `prompts/finish/934-best3d-07-orphaned-avatar-campaign.md` | excluded | already a work order in the queue |
| `prompts/finish/935-best3d-08-engine-store-publishing.md` | excluded | already a work order in the queue |
| `prompts/finish/936-partners-13-tripo-reply-and-house-key.md` | excluded | already a work order in the queue |
| `prompts/finish/937-partners-14-sponsorships.md` | excluded | already a work order in the queue |
| `prompts/finish/938-partners-15-listings-prs-and-sends.md` | excluded | already a work order in the queue |
| `prompts/finish/939-partners-16-program-applications.md` | excluded | already a work order in the queue |
| `prompts/finish/940-partners-17-sketchfab-retag.md` | excluded | already a work order in the queue |
| `prompts/finish/954-oauth-connector-google.md` | excluded | already a work order in the queue |
| `prompts/finish/957-uniswap-lane-and-launch-status.md` | excluded | already a work order in the queue |
| `prompts/finish/958-creator-fee-payouts.md` | excluded | already a work order in the queue |
| `prompts/finish/961-desktop-agent-runtime.md` | excluded | already a work order in the queue |
| `prompts/finish/962-approvals-inbox-telegram.md` | excluded | already a work order in the queue |
| `prompts/finish/965-revenue-ledger-reinvest.md` | excluded | already a work order in the queue |
| `prompts/masters/01-the-architect.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/02-the-scout.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/03-the-builder.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/04-the-designer.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/05-the-integrator.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/06-the-adversary.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/07-the-storyteller.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/08-the-operator.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/09-the-frontier.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/masters/README.md` | excluded | reusable master prompt (takes a target, never retires) |
| `prompts/okx-ai/e2e-evidence/FUNDING-REQUEST.md` | owner-only | needs funded X Layer buyer wallet |
| `prompts/quality-bar/_generated/08/baseline.md` | excluded | machine-written evidence |
| `prompts/quality-bar/_generated/08/before-2026-09-08.md` | excluded | machine-written evidence |
| `prompts/quality-bar/_generated/08/touch-after-2026-09-08.md` | excluded | machine-written evidence |
| `prompts/quality-bar/_generated/08/touch-baseline.md` | excluded | machine-written evidence |
| `prompts/quality-bar/_generated/08/touch-before-2026-09-08.md` | excluded | machine-written evidence |
| `prompts/quality-bar/_generated/10/pass-2026-09-08/REPORT.md` | excluded | machine-written evidence |
| `prompts/README.md` | not-a-plan | queue meta |
| `prompts/robinhood-chain/_shared.md` | not-a-plan | shared rules |
| `prompts/robinhood-chain/00-INDEX.md` | order | [778](../778-plan-robinhood-standalone-repos-reverify.md). 17 standalone repos need re-verification |
| `prompts/robinhood-chain/PLAN.md` | order | [778](../778-plan-robinhood-standalone-repos-reverify.md). 17 standalone repos need re-verification |
| `prompts/RUN-ORDER.md` | not-a-plan | queue meta |
| `prompts/store-submissions/_generated/ar/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/claude-plugin-marketplace-e2e.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/claude-reviewer-guide.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/claude-submission.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/claude-tool-call-evidence.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/commerce/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/embodiment/EVIDENCE.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/gated/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/identity/EVIDENCE.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/iteration/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/listing-copy.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/mcp-directories/glama.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/mcp-directories/lobehub.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/mcp-directories/mcp-so.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/mcp-directories/pulsemcp.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/mcp-directories/smithery.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/openai-gpt-config.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/openai-portal-fields.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/openai-showcase-submission.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/openai-submission.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/provenance/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/spatial-mcp/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/tokenized/README.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/tool-inventory.md` | excluded | machine-written evidence |
| `prompts/store-submissions/_generated/TRACKER.md` | excluded | machine-written evidence |
| `public/.well-known/agent-skills/anatomy/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/authenticate-wallet/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/build-an-agent-skill/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/connect-three-ws-mcp/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/create-3d-avatar/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/create-a-three-ws-agent/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/embed-three-ws-avatar/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/find-3d-assets/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/fund/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/generate-3d-model/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/hire-an-agent/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/monetize-service/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/pay-for-service/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/query-onchain-data/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/rig-a-model/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/search-for-service/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/sell-an-agent-skill/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/send-usdc/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/trade/SKILL.md` | excluded | file served to users from public/ |
| `public/.well-known/agent-skills/x402/SKILL.md` | excluded | file served to users from public/ |
| `public/agents/README.md` | excluded | file served to users from public/ |
| `public/animations/LICENSES.md` | excluded | file served to users from public/ |
| `public/animations/README.md` | excluded | file served to users from public/ |
| `public/artifact/README.md` | excluded | file served to users from public/ |
| `public/avatars/mixamo/README.md` | excluded | file served to users from public/ |
| `public/campus/README.md` | excluded | file served to users from public/ |
| `public/club/assets/LICENSES.md` | excluded | file served to users from public/ |
| `public/club/audio/LICENSES.md` | excluded | file served to users from public/ |
| `public/club/venue/LICENSES.md` | excluded | file served to users from public/ |
| `public/cookbook/recipes/README.md` | excluded | file served to users from public/ |
| `public/cz/offline/README.md` | excluded | file served to users from public/ |
| `public/cz/README.md` | excluded | file served to users from public/ |
| `public/docs/mcp-intel.md` | excluded | file served to users from public/ |
| `public/docs/mcp-marketplace.md` | excluded | file served to users from public/ |
| `public/docs/mcp-naming.md` | excluded | file served to users from public/ |
| `public/docs/mcp-scenes.md` | excluded | file served to users from public/ |
| `public/docs/mcp-vanity.md` | excluded | file served to users from public/ |
| `public/docs/mcp-x402.md` | excluded | file served to users from public/ |
| `public/environments/LICENSES.md` | excluded | file served to users from public/ |
| `public/examples/coach-leo/instructions.md` | excluded | file served to users from public/ |
| `public/examples/coach-leo/SKILL.md` | excluded | file served to users from public/ |
| `public/examples/skills/wave/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/grok-skill.md` | excluded | file served to users from public/ |
| `public/install.md` | excluded | file served to users from public/ |
| `public/lobehub/README.md` | excluded | file served to users from public/ |
| `public/objects/README.md` | excluded | file served to users from public/ |
| `public/README.md` | excluded | file served to users from public/ |
| `public/scene-studio/basis/README.md` | excluded | file served to users from public/ |
| `public/skill.md` | excluded | file served to users from public/ |
| `public/skills/3d-studio/anatomy/reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/anatomy/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/create-3d-avatar/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/embed-three-ws-avatar/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/find-3d-assets/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/generate-3d-model/reference.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/generate-3d-model/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/3d-studio/rig-a-model/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/crypto-price/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/dca/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/pump-fun/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/subscription/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/tip-jar/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/skills/tip-jar/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `public/sperax/README.md` | excluded | file served to users from public/ |
| `public/validation/REPORT_FORMAT.md` | excluded | file served to users from public/ |
| `pump-fun-skills/coin-fees/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/coin-fees/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/create-coin/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/create-coin/references/METADATA.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/create-coin/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/reactive/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/reactive/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/swap/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/swap/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/tokenized-agents/README.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/tokenized-agents/references/SCENARIOS.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/tokenized-agents/references/WALLET_INTEGRATION.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/tokenized-agents/SCENARIOS.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/tokenized-agents/SKILL.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `pump-fun-skills/tokenized-agents/WALLET_INTEGRATION.md` | excluded | agent skill bundle (instructions an agent loads, not a plan) |
| `README.md` | order | [780](../780-plan-docs-roadmap-phase-status-truth-pass.md). Roadmap section duplicates stale Phase 2 row |
| `ROADMAP.md` | order | [780](../780-plan-docs-roadmap-phase-status-truth-pass.md). invalid UTF-8 and stale Phase 2 row |
| `robinhood/erc8056/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-alerts/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-api/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-api/vendor/zod-v3/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-cli/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-connect/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-js/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-js/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-launcher/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-launcher/README.md` | owner-only | testnet faucet needs browser session (Turnstile); mainnet-only rails |
| `robinhood/hood-mcp/README.md` | owner-only | registry submissions (mcp registry, Smithery) are one-way owner actions; metadata already prepared |
| `robinhood/hood-pay/contracts/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-pay/examples/shop/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-pay/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-status/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-tokenlist/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood-traders/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood402/facilitator/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hood402/INTEGRATION.md` | order | [756](../756-plan-robinhood-hood402-x402-payment-rail.md). plan never executed; no hood402 usage in api/ |
| `robinhood/hood402/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hoodkit/examples/react-demo/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/hoodkit/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/learn-robinhood-chain/content/01-what-is-robinhood-chain.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/02-connect-and-read.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/03-stock-tokens-explained.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/04-live-price-ticker.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/05-portfolio-tracker.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/06-swapping-on-chain.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/07-streaming-the-chain.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/08-sell-your-api-for-usdg.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/09-ai-agent-chain-access.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/10-autonomous-trading-agent.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/11-launch-a-coin.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/content/12-ship-it.md` | excluded | end-user tutorial or example |
| `robinhood/learn-robinhood-chain/README.md` | excluded | end-user tutorial or example |
| `robinhood/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/robinhood-chain-examples/examples/01-read-stock-price/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/02-stock-price-sdk/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/03-portfolio-valuation/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/04-swap-memecoin/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/05-watch-launches/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/06-firehose/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/07-live-price-webpage/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/08-portfolio-dashboard/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/09-x402-paid-api-call/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/10-x402-sell-your-api/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/11-mcp-agent-session/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/12-telegram-price-bot/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/13-launch-a-coin-testnet/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/examples/14-agent-paper-trader/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-examples/README.md` | excluded | end-user tutorial or example |
| `robinhood/robinhood-chain-sdk/examples/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `robinhood/robinhood-chain-sdk/README.md` | no-open-work | reference README for shipped package, no open-work markers |
| `satellites/agent-starter/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `satellites/agent-starter/LEARN.md` | no-open-work | reference doc, no outstanding work found |
| `satellites/agent-starter/README.md` | no-open-work | reference doc, no outstanding work found |
| `satellites/glb-quality-gate/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `satellites/glb-quality-gate/README.md` | no-open-work | reference doc, no outstanding work found |
| `satellites/glb-quality-gate/RELEASE.md` | owner-only | Marketplace publication is an owner action on GitHub |
| `satellites/oracle-desk/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `satellites/oracle-desk/README.md` | no-open-work | reference doc, no outstanding work found |
| `satellites/README.md` | no-open-work | reference doc, no outstanding work found |
| `scripts/agent-wallet-demo/README.md` | no-open-work | reference doc, no outstanding work found |
| `scripts/agent-x402-demo/README.md` | no-open-work | reference doc, no outstanding work found |
| `scripts/notebooklm-prompt.md` | not-a-plan | prompt text for an external tool |
| `scripts/README.md` | no-open-work | reference doc, no outstanding work found |
| `scripts/resilience/README.md` | no-open-work | reference doc, no outstanding work found |
| `sdk/agent-sdk/README.md` | no-open-work | reference doc, no outstanding work found |
| `sdk/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `sdk/README.md` | no-open-work | reference doc, no outstanding work found |
| `server/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/agent-screen-caster/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/autopilot/prompt.md` | order | [971](../971-plan-ops-autopilot-write-units-and-provision-vm.md). prompt for the autopilot Claude session; shipped with the unprovisioned service |
| `services/autopilot/README.md` | order | [971](../971-plan-ops-autopilot-write-units-and-provision-vm.md). status block says written not provisioned; units and provision.sh missing, no VM/bucket/secret |
| `services/fleet-console/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/home-relay/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/home-satellite/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/liquidation-collector/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/pulse/AGENTS.md` | no-open-work | reference doc, no outstanding work found |
| `services/pulse/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `services/pulse/CODE_OF_CONDUCT.md` | excluded | license, changelog or repository boilerplate |
| `services/pulse/CONTRIBUTING.md` | excluded | license, changelog or repository boilerplate |
| `services/pulse/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/pulse/SECURITY.md` | excluded | license, changelog or repository boilerplate |
| `services/pump-claims/README.md` | covered-by-existing:506-integrate-07-pump-claims-listener.md | claims listener service is that order |
| `services/pump-graduations/README.md` | no-open-work | reference doc, no outstanding work found |
| `services/README.md` | no-open-work | reference doc, no outstanding work found |
| `solana-agent-sdk/README.md` | no-open-work | reference doc, no outstanding work found |
| `solana-agent-sdk/tasks/add-custom-errors.md` | order | [764](../764-plan-solana-sdk-typed-errors-and-test-coverage.md). errors.ts shipped but 3 classes never thrown and generic Errors remain |
| `solana-agent-sdk/tasks/add-decimal-fetch-onchain.md` | shipped | solana-agent-sdk/src/utils/format.ts and token-program.ts |
| `solana-agent-sdk/tasks/add-memo-support.md` | shipped | solana-agent-sdk/src/utils/memo.ts |
| `solana-agent-sdk/tasks/add-staking-actions.md` | shipped | solana-agent-sdk/src/actions/stake.ts |
| `solana-agent-sdk/tasks/add-tests-actions.md` | order | [764](../764-plan-solana-sdk-typed-errors-and-test-coverage.md). swap/ata/transfer tests exist; stake, balance, accounts, guard, fees untested |
| `solana-agent-sdk/tasks/add-tests-wallet-providers.md` | order | [764](../764-plan-solana-sdk-typed-errors-and-test-coverage.md). keypair and browser tests exist; wallet-adapter untested |
| `solana-agent-sdk/tasks/add-token-balance-methods.md` | shipped | solana-agent-sdk/src/actions/get-token-balance.ts and get-token-accounts.ts; tests tracked in solana-sdk-typed-errors-and-test-coverage |
| `solana-agent-sdk/tasks/add-token22-support.md` | shipped | solana-agent-sdk/src/utils/token-program.ts |
| `solana-agent-sdk/tasks/add-versioned-tx-buildandsend.md` | shipped | solana-agent-sdk/src/tx/build.ts |
| `solana-agent-sdk/tasks/add-wallet-adapter-provider.md` | shipped | solana-agent-sdk/src/wallet/wallet-adapter.ts |
| `solana-agent-sdk/tasks/fix-bigint-precision-swap.md` | shipped | solana-agent-sdk/src/actions/swap.ts and utils/format.ts |
| `solana-agent-sdk/tasks/fix-cu-fallback.md` | shipped | solana-agent-sdk/src/tx/fees.ts |
| `solana-agent-sdk/tasks/fix-duplicate-pendingtx.md` | shipped | single PendingTx definition in solana-agent-sdk/src/wallet/types.ts |
| `solana-agent-sdk/tasks/fix-missing-exports.md` | shipped | solana-agent-sdk/src/index.ts exports errors and actions |
| `solana-agent-sdk/tasks/fix-onconfirmed-callback.md` | shipped | solana-agent-sdk/src/tx/build.ts |
| `solana-agent-sdk/tasks/fix-sender-ata-missing.md` | shipped | MissingTokenAccountError thrown in solana-agent-sdk/src/actions/transfer-spl.ts |
| `solana-mobile/android-overlay/README.md` | no-open-work | reference doc, no outstanding work found |
| `solana-mobile/docs/ANDROID-AUTO.md` | no-open-work | reference doc, no outstanding work found |
| `solana-mobile/docs/ASSETS.md` | no-open-work | reference doc, no outstanding work found |
| `solana-mobile/docs/CHECKLIST.md` | order | [979](../979-plan-mobile-seeker-v1-1-widget-release-prep.md). 29 unticked items; agent-verifiable ones walked by the order, device and portal items stay with owner |
| `solana-mobile/docs/INTEGRATION.md` | no-open-work | reference doc, no outstanding work found |
| `solana-mobile/publish-play/account-experience.md` | owner-only | Play account and device verification steps are owner actions |
| `solana-mobile/publish-play/listing/content-rating.md` | owner-only | questionnaire answers the owner submits in Play Console |
| `solana-mobile/publish-play/listing/data-safety.md` | order | [979](../979-plan-mobile-seeker-v1-1-widget-release-prep.md). needs widget token and card fetch disclosure check |
| `solana-mobile/publish-play/listing/financial-features.md` | owner-only | declaration the owner submits in Play Console |
| `solana-mobile/publish-play/README.md` | order | [979](../979-plan-mobile-seeker-v1-1-widget-release-prep.md). Play Console steps feed the owner release runbook; account choice is owner action |
| `solana-mobile/publish/listing/description.md` | no-open-work | reference doc, no outstanding work found |
| `solana-mobile/publish/listing/saga-features.md` | no-open-work | reference doc, no outstanding work found |
| `solana-mobile/README.md` | order | [979](../979-plan-mobile-seeker-v1-1-widget-release-prep.md). line 5 says widget ships once API lane deployed; lane is live |
| `specs/3D_AGENT_CARD.md` | no-open-work | shipped spec reference, no open markers |
| `specs/AGENT_MANIFEST.md` | no-open-work | shipped spec reference, no open markers |
| `specs/AVATAR_PARAMETERS.md` | no-open-work | status partial but only reserved keys (layers, animation, base) with no committed plan |
| `specs/AVATAR_STREAM.md` | shipped | packages/avatar-stream and /api/avatar-stream implement A3S |
| `specs/CLAUDE_ARTIFACT.md` | no-open-work | shipped spec reference, no open markers |
| `specs/ECONOMY_CONTRACT_INVARIANTS.md` | no-open-work | invariant reference for audit |
| `specs/ECONOMY_CONTRACT_THREAT_MODEL.md` | no-open-work | audit reference; accepted risks documented, no tasks |
| `specs/EDITOR_SPEC.md` | order | [743](../743-plan-avatar-editor-attribute-and-export-fidelity.md). five pre-1.0 rough edges verified still open in src/editor and src/element.js |
| `specs/EMBED_HOST_PROTOCOL.md` | no-open-work | shipped spec reference, no open markers |
| `specs/EMBED_SPEC.md` | order | [743](../743-plan-avatar-editor-attribute-and-export-fidelity.md). editor attribute documented but not wired; rest is shipped reference |
| `specs/ENGINE_BRIDGE.md` | no-open-work | shipped spec reference, no open markers |
| `specs/ENS_AGENT_CLAIM.md` | order | [779](../779-plan-agent-ens-dns-claim-verification.md). resolver does not verify claims; schema lacks claims |
| `specs/GARMENT_MANIFEST.md` | no-open-work | shipped spec reference, no open markers |
| `specs/GLANCE_CARD.md` | no-open-work | shipped spec reference, no open markers |
| `specs/inference-nodes.md` | shipped | status live: api/nodes/register.js and packages/node-operator |
| `specs/inference-receipts.md` | shipped | status live on /api/x402/llm-proxy behind INFERENCE_SIGNING_KEY |
| `specs/KNOCK_PROTOCOL.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/MEMORY_SPEC.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/okx-agent-payments.md` | covered-by-existing:914-okx-ai-07-final-audit-and-watch.md | OKX seller contract shipped (api/_lib/x402-xlayer-okx.js); closure tracked by OKX orders |
| `specs/OPEN_INFERENCE_PROTOCOL.md` | no-open-work | v0.1 out-of-scope list is deliberate, no committed work |
| `specs/PARAMETRIC_AVATAR.md` | order | [720](../720-plan-avatar-parametric-garment-morph-conform.md), [745](../745-plan-avatar-parametric-texture-layers.md), [761](../761-plan-avatar-parametric-identity-morph-fold.md), [775](../775-plan-avatar-animation-identity.md). Reserved table: conform, layers, identity-morph fold, animation identity |
| `specs/PERMISSIONS_SPEC.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/PORTAL_WORLD.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/PRINT_PIPELINE.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/PROVENANCE_3D.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/README.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/REPUTATION_STAKING_MARKET.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/schema/README.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/SECURITY.md` | excluded | license, changelog or repository boilerplate |
| `specs/SERVICE_CATALOG.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/SIM_READINESS.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/SKILL_REGISTRY_MANIFEST.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/SKILL_ROYALTY_SPLIT.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/SKILL_SPEC.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/SPATIAL_MCP.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/STAGE_SPEC.md` | order | [787](../787-plan-stage-agent-speaking-queue.md). per-stage speaking queue is a listed follow-up, not built |
| `specs/VALIDATORS.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/vault-manifest.md` | no-open-work | shipped spec or reference, no open work found |
| `specs/x402-mpp-bridge.md` | no-open-work | documented permit2/BNB gaps are minor design notes, no committed work |
| `specs/x402-preflight.md` | no-open-work | shipped spec or reference, no open work found |
| `src/agora/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/assembly/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/auth/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/desktop/assistant/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/desktop/os/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/desktop/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/desktop/widgets/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/diorama/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/dissolve/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/erc7710/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/feature-tour/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/field/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/onchain/README.md` | order | [777](../777-plan-onchain-deploy-wallet-flow-e2e.md). README TODO: Playwright coverage for wallet I/O not written |
| `src/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/render/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/scene-studio/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/scene-studio/vendor/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/solana/vanity/wasm/README.md` | no-open-work | reference doc, no outstanding work found |
| `src/voice/README.md` | no-open-work | reference doc, no outstanding work found |
| `STRUCTURE.md` | order | [283](../283-plan-capture-video2scene-worker-live.md), [742](../742-plan-agent-screen-pool-deploy-and-verify.md), [271](../271-plan-ops-world-health-retired-state.md), [977](../977-plan-avatar-longcat-gpu-host-bringup.md). status rows show undeployed workers and retired world |
| `SUPPORT.md` | no-open-work | reference doc, verified against code, no outstanding items |
| `tests/e2e/README.md` | no-open-work | reference doc, no outstanding work found |
| `tests/fixtures/skill-import/hostile/SKILL.md` | not-a-plan | hostile test fixture, intentionally adversarial text |
| `tests/fixtures/x-mentions/README.md` | no-open-work | reference doc, no outstanding work found |
| `tests/README.md` | no-open-work | reference doc, no outstanding work found |
| `third_party/designcode-agent-skills/agent-skills/codex/article-prompts-to-skills/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/article-prompts-to-skills/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/article-prompts-to-skills/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/article-prompts-to-skills/references/example-packages.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/article-prompts-to-skills/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/audit-reference-originality/references/audit-rubric.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/audit-reference-originality/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/audit-verify-explain-grade-5/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/audit-verify-explain-grade-5/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/audit-verify-explain-grade-5/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/audit-verify-explain-grade-5/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/browser-video-recording/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/browser-video-recording/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/browser-video-recording/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/browser-video-recording/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/build-daily-inspiration-sites/references/thread-brief-contract.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/build-daily-inspiration-sites/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/daily-ui-inspiration-capture/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/daily-ui-inspiration-capture/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/daily-ui-inspiration-capture/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/daily-ui-inspiration-capture/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/elevenlabs-tts/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/elevenlabs-tts/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/elevenlabs-tts/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/elevenlabs-tts/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/generate-reference-inspired-brand-worlds/references/example-prompts.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/generate-reference-inspired-brand-worlds/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/html-to-interaction-prompts/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/html-to-interaction-prompts/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/html-to-interaction-prompts/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/html-to-interaction-prompts/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/implement-fog-of-war/references/mechanics.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/implement-fog-of-war/references/validation.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/implement-fog-of-war/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/iterate-until-verified/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/iterate-until-verified/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/optimize-web-animations/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/optimize-web-animations/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/optimize-web-animations/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/optimize-web-animations/references/browser-profiling.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/optimize-web-animations/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/references/energy-diagnostics.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/references/launch-optimization.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/references/memory-profiling.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/references/time-profiler.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/performance-profiling/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/publish-project-to-github/assets/README-template.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/publish-project-to-github/references/github-pages.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/publish-project-to-github/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/stitched-full-page-capture/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/stitched-full-page-capture/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/stitched-full-page-capture/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/stitched-full-page-capture/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/video-to-superprompt/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/video-to-superprompt/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/video-to-superprompt/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/video-to-superprompt/references/superprompt-template.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/video-to-superprompt/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/web-technique-to-skill/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/web-technique-to-skill/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/web-technique-to-skill/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/web-technique-to-skill/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/write-like-meng-on-x/references/content-source-map.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/write-like-meng-on-x/references/voice-profile.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/write-like-meng-on-x/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/x-bookmark-quote-posts/demo/expected-output.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/x-bookmark-quote-posts/demo/input.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/x-bookmark-quote-posts/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/codex/x-bookmark-quote-posts/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/author-game-levels/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-audio-feedback/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-camera-controls/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-changelog/references/reference-architecture.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-changelog/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-inventory/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-map-editor/references/vesperfall-implementation.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-map-editor/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-monster-system/references/monster-contract.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-game-monster-system/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-hybrid-game-assets/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-isometric-arpg/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-mobile-threejs-games/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-rigged-game-assets/references/catalog-and-testing.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-rigged-game-assets/references/requirements.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-rigged-game-assets/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-threejs-enemy-systems/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-vesperfall-review-assets/references/catalog-contract.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/build-vesperfall-review-assets/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/create-game-vfx/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/design-action-combat/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/design-game-encounters/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/optimize-threejs-games/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/README.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/ship-web-games/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/test-playable-web-games/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/game-development/tune-enemy-ai/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/media/aura-asset-images/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/media/aura-asset-images/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/media/unsplash-asset-images/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/media/unsplash-asset-images/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/audit-ai-design-slop/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/audit-ai-design-slop/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/design-first-ui-prompting/ARTICLE.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/design-first-ui-prompting/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/design-first-ui-prompting/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/design-first-ui-prompting/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/no-ai-design-slop/ARTICLE.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/no-ai-design-slop/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/ui/no-ai-design-slop/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/add-mouse-driven-orbit/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/add-mouse-driven-orbit/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/add-shader-cursor-trail/references/implementation.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/add-shader-cursor-trail/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/agency-grid-layout-minimal/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/agency-grid-layout-minimal/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/ambient-section-particles/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/ambient-section-particles/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/ambient-section-particles/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/animation-on-scroll/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/animation-on-scroll/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/animation-systems/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/animation-systems/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/atmosphere-background/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/atmosphere-background/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/background-grid-webgl/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/background-grid-webgl/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/beam-glow-states/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/beam-glow-states/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/beautiful-shadows/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/beautiful-shadows/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/blue-cloudy-clean-modern/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/blue-cloudy-clean-modern/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/blue-laser-clean-glass-layout/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/blue-laser-clean-glass-layout/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/book-serif-index/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/book-serif-index/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/bright-green-tech-system-webgl/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/bright-green-tech-system-webgl/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-awwwards-quality-sites/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-interactive-particle-trail/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-interactive-particle-trail/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-threejs-scroll-worlds/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-threejs-scroll-worlds/references/kage-anatomy.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-threejs-scroll-worlds/references/quality-and-qa.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-threejs-scroll-worlds/references/realtime-architecture.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-threejs-scroll-worlds/references/world-bible.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-threejs-scroll-worlds/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-wireframe-scan-reveal/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/build-wireframe-scan-reveal/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cinematic-gsap-lenis-motion-system/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cinematic-gsap-lenis-motion-system/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cinematic-gsap-lenis-motion-system/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cinematic-scroll-storytelling/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cinematic-scroll-storytelling/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cinematic-scroll-storytelling/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/clean-minimal-beige-light-mode/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/clean-minimal-beige-light-mode/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cobejs/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cobejs/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/cobejs/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/company-logos/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/company-logos/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/container-lines/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/container-lines/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/corner-diagonals/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/corner-diagonals/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/corner-lasers/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/corner-lasers/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/css-alpha-masking/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/css-alpha-masking/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/css-border-gradient/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/css-border-gradient/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dark-blue-contrasting-clean/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dark-blue-contrasting-clean/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dark-glass-clean-layout/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dark-glass-clean-layout/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dither-background/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dither-background/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dither-laser-dark-mode/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/dither-laser-dark-mode/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/documentary-brutalist-agency/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/documentary-brutalist-agency/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/documentary-brutalist-agency/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-portfolio-chapters/ARTICLE.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-portfolio-chapters/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-portfolio-chapters/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-portfolio-chapters/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-service-booking/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-service-booking/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-service-booking/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-tech/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/editorial-tech/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/falling-leaves/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/falling-leaves/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/framed-grid-layout/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/framed-grid-layout/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/framed-tech-dark-border-gradient/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/framed-tech-dark-border-gradient/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/funky-purple-container-tech/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/funky-purple-container-tech/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/glass-dark-mode-clock/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/glass-dark-mode-clock/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/glass-dark-ui/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/glass-dark-ui/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/globe-gl/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/globe-gl/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/globe-particles/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/globe-particles/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gooey-blob-system/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gooey-blob-system/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gsap-scrolltrigger-storytelling/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gsap-scrolltrigger-storytelling/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gsap/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gsap/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/gsap/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/high-contrast-skeuomorphic-clean/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/high-contrast-skeuomorphic-clean/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/image-first-grid-layout/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/image-first-grid-layout/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/landing-page/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/landing-page/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/landing-page/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/light-mode-paper-technical/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/light-mode-paper-technical/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/liquid-metal-border/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/liquid-metal-border/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/marquee-loop/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/marquee-loop/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/masked-reveal/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/masked-reveal/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/matterjs/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/matterjs/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/mesh-gradient-dark-blue-clean/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/mesh-gradient-dark-blue-clean/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/nested-container-clean-agency/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/nested-container-clean-agency/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/nested-container-frames/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/nested-container-frames/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/number-details/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/number-details/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/operational-enterprise-ai/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/operational-enterprise-ai/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/operational-enterprise-ai/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/orange-clean-paper-saas/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/orange-clean-paper-saas/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/pointer-trail-emitter/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/pointer-trail-emitter/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/pricing-page/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/pricing-page/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/pricing-page/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/product-proof-saas/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/product-proof-saas/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/product-proof-saas/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/progressive-blur/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/progressive-blur/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/README.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/reveal-hover-effect/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/reveal-hover-effect/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/reveal-hover-effect/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-progress-timeline/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-progress-timeline/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-progress-timeline/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-scrubbed-visual-sequence/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-scrubbed-visual-sequence/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-scrubbed-visual-sequence/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-scrubbed-word-reveal/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-scrubbed-word-reveal/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-scrubbed-word-reveal/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/demo/html-data/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/demo/threejs/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/demo/video/assets/README.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/demo/video/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/scroll-world-storytelling/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/shaders-cursor-ripples/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/shaders-cursor-ripples/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/skeuomorphic-ui/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/skeuomorphic-ui/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/solar-duotone-bold/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/solar-duotone-bold/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/split-layout-technical/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/split-layout-technical/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/staggered-word-reveal/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/staggered-word-reveal/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/tailwindcss/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/tailwindcss/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/tailwindcss/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/tech-green-dark-mode-modern/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/tech-green-dark-mode-modern/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/technical-wireframe-info-layout/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/technical-wireframe-info-layout/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/thinking-orbs/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/thinking-orbs/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs-landscape/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs-landscape/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs-towers/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs-towers/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs-weather/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs-weather/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/threejs/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/unicorn-studio/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/unicorn-studio/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/unicorn-studio/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/vantajs/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/vantajs/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/vantajs/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/WEB-DESIGN-SKILLS.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-3d-object/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-3d-object/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-landing-steering/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-landing-steering/REFERENCES.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-landing-steering/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-laser/demo/PROMPT.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/agent-skills/web-design/webgl-laser/SKILL.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/CLAUDE.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/DEMOS.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/README.md` | excluded | vendored third-party source |
| `third_party/designcode-agent-skills/SCREENSHOTS.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/agents/image-blast-3d.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/agents/image-blast-image-edit.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/agents/image-blast-plate.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/agents/image-blast-sfx.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/agents/image-blast-wildcard.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/agents/image-blast-world.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/rules/project.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-3d/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-image-edit/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-plate/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-project/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-sfx/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-uncover/IMAGE-BLAST.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-uncover/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-wildcard/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/.claude/skills/image-blast-world/SKILL.md` | excluded | vendored third-party source |
| `third_party/image-blaster/CLAUDE.md` | excluded | vendored third-party source |
| `third_party/image-blaster/LICENSE.md` | excluded | vendored third-party source |
| `third_party/image-blaster/README.md` | excluded | vendored third-party source |
| `third_party/README.md` | excluded | vendored third-party source |
| `third_party/threeui/ASSET-LICENSES.md` | excluded | vendored third-party source |
| `third_party/threeui/FONT-LICENSES.md` | excluded | vendored third-party source |
| `third_party/threeui/packages/cli/README.md` | excluded | vendored third-party source |
| `third_party/threeui/README.md` | excluded | vendored third-party source |
| `third_party/threeui/THIRD_PARTY_NOTICES.md` | excluded | vendored third-party source |
| `tour-sdk/README.md` | no-open-work | reference doc, no outstanding work found |
| `vendor/three-draco/README.md` | excluded | vendored third-party source |
| `walk-sdk/README.md` | no-open-work | reference doc, no outstanding work found |
| `workers/agent-anchor/README.md` | no-open-work | reference README, no open work |
| `workers/agent-crawler/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). no Cloud Run service; needs verify build and tests |
| `workers/agent-forge/README.md` | no-open-work | reference README, no open work |
| `workers/agent-gateway/README.md` | order | [270](../270-plan-gateway-chat-worker-ship-readiness.md). built and tested, no Cloud Run service, no verify build or live round trip |
| `workers/agent-mm/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed; verify build and ship command |
| `workers/agent-orders/README.md` | covered-by-existing:614-beat-14-deploy-orders-engine-with-ratcheting-exits.md | order engine deploy is order 614 |
| `workers/agent-screen-pool/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). cloudbuild present, no service; verify build |
| `workers/agent-screen-worker/README.md` | no-open-work | owner-run by design, no Cloud Run deployment intended |
| `workers/agent-sniper/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/agora-citizens/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md), [770](../770-plan-agora-cartographer-profession-reactivation.md). deploy-ready but no service; cartographer profession deferred |
| `workers/agora-citizens/work/README.md` | order | [770](../770-plan-agora-cartographer-profession-reactivation.md). cartographer runner deferred pending in-budget compose |
| `workers/avatar-pipeline-controller/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). no Cloud Run service; verify build |
| `workers/avatar-reconstruction/eval/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/avatar-reconstruction/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/cad-forge/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed; verify build and tests |
| `workers/deploy/README.md` | no-open-work | avatar pipeline deploy runbook, accurate reference |
| `workers/garment-forge/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/granite-guardian/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed; verify build and tests |
| `workers/longcat/README.md` | order | [977](../977-plan-avatar-longcat-gpu-host-bringup.md). needs 80GB GPU (quota 0) and 44.8GB staged weights; GATED on quota |
| `workers/model-anigen/README.md` | covered-by-existing:069-best3d-03-rig-anything.md | AniGen lane in rig-anything order |
| `workers/model-asl-recognition/README.md` | order | [768](../768-plan-sign-asl-word-level-recognition.md). roadmap: word-level recognition via PopSign retrain |
| `workers/model-holopart/README.md` | covered-by-existing:070-best3d-04-editable-parts.md | HoloPart in editable parts order |
| `workers/model-hunyuan3d/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/model-lato2/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). no service; verify build |
| `workers/model-partcrafter/README.md` | covered-by-existing:070-best3d-04-editable-parts.md | PartCrafter in editable parts order |
| `workers/model-pixal3d/README.md` | covered-by-existing:068-best3d-02-pixal3d-multiview.md | Pixal3D lane order |
| `workers/model-sam3d-objects/README.md` | no-open-work | reference README, no open work |
| `workers/model-text2motion/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). MoMask backend never had an in-house production run; benchmark script and ship commands |
| `workers/model-trellis/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/model-trellis2/README.md` | covered-by-existing:067-best3d-01-trellis2-default-lane.md | TRELLIS.2 default lane order |
| `workers/model-triposg/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/model-triposplat/README.md` | covered-by-existing:081-best3d-15-splat-parity.md | TripoSplat in splat parity order |
| `workers/model-triposr/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/model-video2motion/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/model-video2scene/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed as its own service; verify build |
| `workers/modly/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). no model-modly service in the fleet list; verify build |
| `workers/okx-chat-bot/README.md` | covered-by-existing:907-backlog-08-okx-chat-bot-always-on.md | chat bot always-on tracked by 907; service exists |
| `workers/oracle/README.md` | no-open-work | runs as api/cron/oracle-score.js, no worker service needed |
| `workers/pump-fun-mcp/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed; verify build |
| `workers/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). worker index with hand-kept status; replaced by generated fleet doc |
| `workers/rembg/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/remesh/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/rig-nonhuman/README.md` | no-open-work | reference README, no open work |
| `workers/rig/README.md` | no-open-work | reference README, no open work |
| `workers/robinhood-feed/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed; verify build and tests |
| `workers/segment/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/signal-bridge/README.md` | order | [270](../270-plan-gateway-chat-worker-ship-readiness.md). Signal needs this bridge; no tests or verify config |
| `workers/stylize/README.md` | no-open-work | deployed worker reference (service live in gcloud run services list) |
| `workers/texture/README.md` | order | [734](../734-plan-workers-fleet-status-and-ship-readiness.md). not deployed; verify build and tests |
| `workers/vanity-grinder/README.md` | no-open-work | live tooling reference |
| `x402-modal-sdk/docs/BACKEND.md` | no-open-work | reference doc, no outstanding work found |
| `x402-modal-sdk/docs/CONFIGURATION.md` | no-open-work | reference doc, no outstanding work found |
| `x402-modal-sdk/docs/PROTOCOL.md` | no-open-work | reference doc, no outstanding work found |
| `x402-modal-sdk/README.md` | no-open-work | reference doc, no outstanding work found |
| `x402-modal-sdk/TUTORIAL.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/CHANGELOG.md` | excluded | license, changelog or repository boilerplate |
| `x402-payment-modal/docs/api-reference.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/docs/architecture.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/docs/server-setup.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/docs/siwx.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/docs/spending-caps.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/docs/theming.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/examples/react/README.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/examples/README.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/examples/solana-crypto-paywall/README.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/README.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/server/README.md` | no-open-work | reference doc, no outstanding work found |
| `x402-payment-modal/TUTORIAL.md` | no-open-work | reference doc, no outstanding work found |
