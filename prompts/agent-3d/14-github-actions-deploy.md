---
id: 14-github-actions-deploy
title: Add GitHub Actions CI/CD — auto-build and deploy agent-3d on every main push
area: devops
---

# Add GitHub Actions CI/CD for agent-3d

## Problem

There is no automated build-and-deploy pipeline for three.ws.
Someone must manually run `npm run build:all && vercel --local-config vercel.json --prod`.
When that step is forgotten or partially run, the CDN 404s (which is what happened).

The existing `.github/workflows/` contains only `contracts.yml` and `validate-agent-cards.yml`
— neither touches the web app or agent-3d.js.

## Goal

Create a GitHub Actions workflow that:

1. Triggers on push to `main` (and manual `workflow_dispatch`)
2. Runs `npm run build:all` (which includes `build:lib` + `publish:lib`)
3. Deploys to Vercel production using the Vercel CLI
4. Fails the deployment if the built `dist/agent-3d/latest/agent-3d.js` is missing

## Key files to understand first

- `package.json` scripts: `build:all`, `deploy`, `check:dist` (if prompt 12 was run)
- `scripts/publish-lib.mjs` — the step that creates `dist/agent-3d/`
- `vercel.json` — project config; `buildCommand` may or may not already be set
- `.github/workflows/contracts.yml` — reference for repo workflow conventions

## Required GitHub secrets

The workflow needs these secrets configured in the GitHub repo settings
(Settings → Secrets and variables → Actions):

| Secret name | Where to get it |
|-------------|----------------|
| `VERCEL_TOKEN` | Vercel dashboard → Account Settings → Tokens → Create |
| `VERCEL_ORG_ID` | Run `vercel whoami --token <token>` or check `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Check `.vercel/project.json` in the repo root, or Vercel dashboard → Project Settings |

Read `.vercel/project.json` if it exists in the repo to find the org and project IDs.
Document the expected variable names in the workflow file as comments.

## Tasks — all must be real, no placeholders

### Task 1 — Create the workflow file

Create `.github/workflows/deploy.yml` with the following behaviour (implement it fully):

**Triggers:**
- `push` to branch `main`
- `workflow_dispatch` (manual trigger with no inputs required)

**Concurrency:** Only one deploy at a time; cancel in-progress runs on new push.

**Job: `build-and-deploy`**

Steps in order:

1. `actions/checkout@v4` — full clone (`fetch-depth: 0`)
2. `actions/setup-node@v4` — Node 22, enable npm cache
3. `npm ci` — install all dependencies
4. `npm run build:all` — full build pipeline including publish:lib
5. **Validation step** — run `node scripts/check-dist.mjs` if it exists;
   otherwise inline check: `test -f dist/agent-3d/latest/agent-3d.js || (echo "dist/agent-3d/latest/agent-3d.js missing" && exit 1)`
6. Deploy with Vercel CLI:
   ```
   npx vercel --prod --token ${{ secrets.VERCEL_TOKEN }} \
     --yes \
     --local-config vercel.json
   ```
   Set env vars `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` from secrets.

**Environment variables available to build steps** (add to the job's `env:`):
- Any vars needed for `npm run build:all` — check `vite.config.js` and `package.json` for required env vars. If none are required beyond Node itself, leave `env:` minimal.

### Task 2 — Add a job summary

In the workflow, after a successful deploy, add a step that writes a GitHub Actions
job summary (`$GITHUB_STEP_SUMMARY`) with:

```
## Deployed ✅
- **Version:** $(node -p "require('./package.json').version")
- **CDN URL:** https://three.ws/agent-3d/latest/agent-3d.js
- **Vercel env:** production
```

Use a `run:` shell step with `echo "..." >> $GITHUB_STEP_SUMMARY`.

### Task 3 — Read .vercel/project.json and document IDs

Check if `.vercel/project.json` exists in the repo. If it does, read it and note
the `orgId` and `projectId` values. Add a comment block near the top of the workflow
file that tells future maintainers exactly where to find these values:

```yaml
# Required GitHub secrets:
#   VERCEL_TOKEN     — Vercel account token (Account Settings → Tokens)
#   VERCEL_ORG_ID    — from .vercel/project.json → "orgId"
#   VERCEL_PROJECT_ID — from .vercel/project.json → "projectId"
```

If `.vercel/project.json` does not exist, note that in the comment and instruct
maintainers to run `vercel link` locally first.

### Task 4 — Validate the workflow YAML is syntactically correct

Run:
```
npx js-yaml .github/workflows/deploy.yml > /dev/null && echo "YAML OK"
```

Or if `actionlint` is available:
```
actionlint .github/workflows/deploy.yml
```

Fix any errors before marking done.

## Success criteria

- [ ] `.github/workflows/deploy.yml` exists and passes YAML syntax check
- [ ] Workflow triggers on push to `main` and on `workflow_dispatch`
- [ ] Concurrency group set so only one deploy runs at a time
- [ ] `npm run build:all` step runs before the Vercel deploy step
- [ ] Validation step (`check-dist` or inline `test -f`) runs between build and deploy
- [ ] Vercel deploy step uses `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secrets
- [ ] Job summary is written to `$GITHUB_STEP_SUMMARY` after success
- [ ] No placeholder `YOUR_TOKEN_HERE` strings — all references are to `${{ secrets.* }}` variables
- [ ] Workflow file passes `npx js-yaml` or `actionlint`

## Do not

- Do not add a step that commits or pushes built artifacts back to the repo
- Do not use a third-party Vercel action (e.g. `amondnet/vercel-action`) — use the Vercel CLI directly via `npx vercel`
- Do not run `npm test` or any test suite in this workflow — that is a separate concern
- Do not hardcode any Vercel token or ID values in the workflow file
- Do not set `fetch-depth: 1` — full clone is needed for version tagging to work correctly
