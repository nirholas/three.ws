# Task: Link the launched USDC pump.fun coin to an agent_identity

## Project overview

This is the **three.ws** workspace at `/workspaces/three.ws`. A separate task (`prompts/pumpfun-usdc-deploy.md`) launches a USDC-paired pump.fun coin via direct SDK call. Because that path bypasses the API/session-auth flow, the new coin lands on-chain but has no row in our `pump_agent_mints` DB table — which means it doesn't show up on any agent's profile page. This task patches that.

## Preconditions

```bash
# 1. The launch must have succeeded.
test -f ~/.claude/pump-deploy/launch-result.json || { echo "No launch result yet."; exit 1; }
node -e "const r=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude/pump-deploy/launch-result.json'));if(!r.ok){console.error('launch did not succeed:',r.reason);process.exit(1)}console.log('mint:',r.mint)"

# 2. DATABASE_URL must be set (Neon connection string for the three.ws DB).
test -n "$DATABASE_URL" || { echo "Export DATABASE_URL from your three.ws Vercel env."; exit 1; }
```

If `DATABASE_URL` isn't available locally, the user can run this same workflow from a Vercel function or a machine that has it. The script also works in the production environment.

## Execute

The script is in this repo at `scripts/pump-link-mint.mjs`. It reads `~/.claude/pump-deploy/launch-result.json` and upserts into `pump_agent_mints` (idempotent on `mint, network`).

### Step 1: pick an agent

```bash
cd /workspaces/three.ws
node scripts/pump-link-mint.mjs
```

With no `AGENT_ID` env var, the script lists up to 20 recent agent_identities and exits. Pick the one to link.

### Step 2: link

```bash
AGENT_ID=<uuid> node scripts/pump-link-mint.mjs
```

Optional env:
- `NETWORK=mainnet` (default) | `devnet`
- `BUYBACK_BPS=0` (default; set 0–10000 to enable buyback share)
- `USER_ID=<uuid>` override the user the link is recorded under (defaults to the agent's owner)

The script inserts into `pump_agent_mints` with `agent_authority` = the deploy wallet pubkey, `metadata_uri` = the IPFS URI from the launch, and the coin's name/symbol.

## Success criteria

- A row exists in `pump_agent_mints` with `mint = <launched mint>` and `agent_id = <chosen agent_id>`.
- Visiting `/agent/<agent_id>` on three.ws shows the coin in the agent's token section.

Verify by querying:

```bash
psql "$DATABASE_URL" -c "select id, name, symbol, mint, agent_id, created_at from pump_agent_mints where mint = '$(node -e "console.log(require(require('os').homedir()+'/.claude/pump-deploy/launch-result.json').mint)")';"
```

## On completion

When the row is confirmed in `pump_agent_mints`:

1. Print the agent page URL to the user (`https://three.ws/agent/<agent_id>`).
2. Delete this prompt: `rm /workspaces/three.ws/prompts/pumpfun-usdc-link-agent.md`
3. Commit the deletion as `nirholas <nirholas@users.noreply.github.com>`, push to both `origin` and `threews`.

## Notes

- This prompt is independent of `pumpfun-usdc-deploy.md` — they communicate only through `~/.claude/pump-deploy/launch-result.json` on disk. Either prompt can be re-run idempotently.
- If no agent exists yet, the user should create one first via the `/studio` UI on three.ws, then return here.
- For the inaugural USDC coin, the user wanted the agent named "USDC" too. If a matching agent doesn't already exist, ask the user to create one with name="USDC" before linking — but never auto-create on their behalf (that's a UI flow).
