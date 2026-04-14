# Scalability task prompts

Self-contained prompt files for the code-scalability tasks inspired by Google's [`<model-viewer>`](https://github.com/google/model-viewer). Each file is designed to be dropped into a fresh Claude Code agent prompt without extra context.

## Recommended execution order

1. [01-dispose.md](./01-dispose.md) — **delegate-ready.** Self-contained audit. Unblocks 04.
2. [02-render-on-demand.md](./02-render-on-demand.md) — **maintainer plans to handle personally.** Spec written for delegation fallback.
3. [03-module-split.md](./03-module-split.md) — **maintainer plans to handle personally.** Spec written for delegation fallback. Unblocks 05.
4. [04-web-component.md](./04-web-component.md) — **delegate-ready.** Depends on 01.
5. [05-shared-renderer.md](./05-shared-renderer.md) — **deferred.** Do not execute until multi-instance is a real requirement.

## Rules that apply to all tasks

- No new dependencies.
- No new docs files unless explicitly stated.
- `node --check` each modified JS file before reporting done.
- Run `npx vite build` and note whether the build breaks. The pre-existing `@avaturn/sdk` resolution error in `src/avatar-creator.js` is unrelated and should be ignored.
- If you discover an unrelated bug during your task, note it in the reporting section. Do not fix it in the same change.
