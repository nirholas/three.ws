# 33. Account surfaces: X connect and posting policy per agent, Google sign-in linking, account status and dashboard URLs

Read `docs/prompts/README.md` first.

## The problem

X posting exists as crons and configuration spread across the announcement lanes; there is no per-agent "connect X, set what it may post and how often" surface a developer or tool can drive. There is no Google sign-in link for an existing account, no single account-status object (verification, limits, linked accounts, wallets), and no tool that returns the dashboard URLs a model should hand a user.

## Build

- **X per agent:** OAuth connect stored per agent, a posting policy (allowed kinds: launches, trades, runs, replies; cadence caps; review-before-post toggle; tone rules), and a queue with approval where the policy demands it. Tools `connect_twitter`, `configure_twitter_posting`, `post_to_x` (write tier, honors the policy), `list_scheduled_posts`. Reuse the existing X posting code paths.
- **Google linking:** `link_google_account` starts an OAuth link so an account can sign in with Google as well as its current method; unlink with re-authentication. Any other identity provider already supported gets the same shape.
- **Account status:** `GET /me/status` and tool `get_account_status`: plan, verification, limits and remaining, linked accounts, agents count, wallets summary, open approvals, and any actions the user must take.
- **Dashboard URLs:** tool `get_dashboard_urls` returning the canonical pages for the account and each agent (wallet, chat, runs, skills, keys, connections), so models link correctly.
- Page `/settings/connections` (shared with prompt 13) shows all of it. Every state designed.
- Docs: `docs/authentication.md` and `docs/api-reference.md` updated; changelog entry tagged `feature`.

## Acceptance

- Connect X to the QA agent with a review-before-post policy; a run's post lands in the approval queue, not on X.
- Link Google, sign out, sign in with Google.
- `npm test` green.
