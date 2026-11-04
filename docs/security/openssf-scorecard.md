# OpenSSF Scorecard (local run)

Run on 2026-11-04 with Scorecard v5.1.1 (`go install github.com/ossf/scorecard/v5@v5.1.1`, no GitHub Action) against a clean export of the tracked files, because a walk of the live worktree trips on `node_modules` churn:

```bash
git ls-files -z | grep -zv '^contracts/lib' | xargs -0 -I{} cp --parents -- "{}" /tmp/export/
cd /tmp/export && git init -q . && scorecard --local . --format json --show-details
```

Local mode scores only the checks that read files. The remaining checks need the GitHub API (branch protection, code review, CI tests, maintained, signed releases, vulnerabilities) and run from `scorecard --repo=github.com/nirholas/three.ws` with a `GITHUB_AUTH_TOKEN`.

| Check | Score | Result |
| --- | --- | --- |
| Security-Policy | 10 | `.github/SECURITY.md` detected |
| Dependency-Update-Tool | 10 | `.github/dependabot.yml` detected |
| Fuzzing | 10 | detected |
| License | 9 | `LICENSE` (Apache-2.0) detected |
| Binary-Artifacts | 3 | wasm and similar binaries are checked in (for example `character-studio/public/ktx2/libktx.wasm`) |
| Pinned-Dependencies | 1 | many Dockerfile base images (`apps/hq`, `deploy/world`, `multiplayer`, worker images) use tags, not `@sha256` digests |
| SAST | 0 | no CodeQL or similar tool; the repo has no GitHub Actions by policy |
| Dangerous-Workflow, Token-Permissions | n/a | no workflows exist, by policy |

Aggregate of the scored local checks: 6.0.

## What is fixable inside the repo, and what is not

- Security-Policy, License, Dependency-Update-Tool: already pass.
- Pinned-Dependencies: pinning needs each base image's current digest, resolved at build time against the registry, and a digest bump process (Dependabot's docker ecosystem can own it). Not done in this pass because blindly pinning dozens of images without building each one risks breaking deploys. Next step: enable the `docker` ecosystem in `.github/dependabot.yml` for each Dockerfile directory, then pin as those PRs land.
- Binary-Artifacts: the wasm decoders are vendored on purpose (`scripts/copy-three-decoders.mjs`), so the check cannot reach 10 without dropping local decoders.
- SAST: the project forbids GitHub Actions, so the CodeQL path Scorecard credits is unavailable. Owner decision if a hosted SAST app is acceptable.
