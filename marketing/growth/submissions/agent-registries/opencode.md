# OpenCode (anomalyco/opencode) MCP docs submission

**Status: submitted 2026-11-04, awaiting review.** PR: https://github.com/anomalyco/opencode/pull/61707
(branch `nirholas:docs-three-ws-mcp`, base `dev`).

Re-verified 2026-11-14: DRIFTED. PR #61707 is open but conflicting (mergeable state `dirty`) and its target no
longer exists. On `dev` the docs were rewritten and moved: `packages/web/src/content/docs/mcp-servers.mdx` is gone
(404); the page is now `services/site/src/docs/content/mcp-servers.mdx` and has no Examples section and no Grep by
Vercel entry (headings: Setup, Config, Local, Remote, OAuth, and so on). It documents
`opencode mcp add <name> --url <url>` for remote servers. `CONTRIBUTING.md` still exempts docs PRs from the linked
issue check and wants a `docs:` title. Repo not archived, MIT, default branch `dev`. No maintainer comments on the
PR. Owner action: do not wait on this PR; there is no longer a list of third-party servers to join, so recommend
closing it and dropping this target. The snippet described below is still valid config.

Target: `https://github.com/anomalyco/opencode` (renamed from `sst/opencode`), file
`packages/web/src/content/docs/mcp-servers.mdx`. The English docs moved out of the `docs/docs/` subfolder;
the per-language copies sit beside it (`ar/`, `de/`, ...) and are not edited by contributors.

## Mechanism (verified live 2026-11-04)

The page's Examples section says "You can submit a PR if you want to document other servers." OpenCode's
`CONTRIBUTING.md` exempts documentation PRs from the linked-issue check, requires a conventional title
(`docs: ...`) and the PR template, and warns that long AI-written descriptions get closed, so the PR body is
short and plain.

## What shipped

A new `### three.ws` example after Grep by Vercel, in the same shape: one sentence, an `opencode.json` snippet
with `"type": "remote"` and `"url": "https://three.ws/api/mcp-studio"`, and a `use three-ws` prompt.

## Verification

The snippet, saved as a fresh `opencode.json`, run through `npx opencode-ai@latest mcp list`:

```
●  ✓ three-ws connected
│      https://three.ws/api/mcp-studio
```

## Remaining

Maintainer review.
